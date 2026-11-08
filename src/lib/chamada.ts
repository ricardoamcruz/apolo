/**
 * Ouvir o próprio nome durante a espera (RF-11, docs/adr/0017).
 *
 * Em espera, o microfone do modelo de voz fica fechado: nada chega a ele, e nada
 * é respondido. Só o reconhecedor do navegador escuta, e só para achar o nome.
 * "Estritamente pelo nome" vale ao pé da letra: falar do Apolo com outra pessoa
 * ("o Apolo travou") não é chamá-lo, por isso o nome tem de abrir ou fechar a frase.
 */

type Resultado = { isFinal: boolean; 0: { transcript: string } }
type Reconhecedor = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: { resultIndex: number; results: ArrayLike<Resultado> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}
type Construtor = new () => Reconhecedor

/** Depois do nome, estes verbos indicam que falam dele, e não com ele. */
const FALA_DELE = new Set(['e', 'era', 'foi', 'sao'])
const SAUDACAO = /^(?:(?:ei|oi|ola|hey|e ai|fala|bom dia|boa tarde|boa noite)\s+)+/
/** "o Apolo", "do Apolo", "pro Apolo": o nome no fim da frase, mas como assunto. */
const ASSUNTO = /(?:^|\s)(?:o|a|do|no|ao|pro|para o|com o|sobre o)$/

const normalizar = (fala: string) =>
  fala
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\bapollo\b/g, 'apolo')

/** Foi um chamado? Em `pedido`, o que veio junto com o nome, se veio. */
export function chamouPeloNome(fala: string): { chamou: boolean; pedido: string } {
  const nao = { chamou: false, pedido: '' }
  // "a polo" é como o reconhecedor às vezes separa o nome no início da frase.
  const texto = normalizar(fala).replace(/^a polo\b/, 'apolo').replace(SAUDACAO, '')
  if (texto === 'apolo') return { chamou: true, pedido: '' }
  if (texto.startsWith('apolo ')) {
    const pedido = texto.slice(6)
    return FALA_DELE.has(pedido.split(' ')[0]) ? nao : { chamou: true, pedido }
  }
  if (texto.endsWith(' apolo')) {
    const pedido = texto.slice(0, -6)
    return ASSUNTO.test(pedido) ? nao : { chamou: true, pedido }
  }
  return nao
}

/**
 * Quanto o nome sozinho precisa ficar sem continuação para valer. O Chrome só fecha a
 * frase depois de cerca de um segundo de silêncio; isto acorda antes, mas espera o
 * bastante para "Apolo é..." não ser tomado como chamado.
 */
export const NOME_ESTAVEL_MS = 400

/**
 * O que fazer com um trecho reconhecido. O nome sozinho, ainda provisório, acorda
 * depois de `NOME_ESTAVEL_MS`. Nome com pedido espera a frase fechar, para o pedido
 * chegar inteiro.
 */
export function decidirChamada(fala: string, final: boolean): 'agora' | 'se_parar' | 'nao' {
  const { chamou, pedido } = chamouPeloNome(fala)
  if (!chamou) return 'nao'
  if (final) return 'agora'
  return pedido ? 'nao' : 'se_parar'
}

const construtor = () => {
  if (typeof window === 'undefined') return undefined
  const w = window as unknown as { SpeechRecognition?: Construtor; webkitSpeechRecognition?: Construtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

export const chamadaDisponivel = () => construtor() !== undefined

/**
 * Escuta até `stop`. O Chrome encerra o reconhecimento sozinho de tempos em
 * tempos, então ele é religado enquanto a espera durar.
 */
export function ouvirNome(aoChamar: (fala: string, pedido: string) => void, aoFalhar: (motivo: string) => void) {
  const Construtor = construtor()
  if (!Construtor) return { stop() {} }
  let parado = false
  let religar: ReturnType<typeof setTimeout> | undefined
  let esperaMs = 300
  let nomeSozinho: ReturnType<typeof setTimeout> | undefined

  const rec = new Construtor()
  rec.lang = 'pt-BR'
  rec.continuous = true
  rec.interimResults = true
  const chamar = (fala: string) => {
    clearTimeout(nomeSozinho)
    if (parado) return
    parado = true
    rec.stop()
    aoChamar(fala, chamouPeloNome(fala).pedido)
  }
  rec.onresult = (e) => {
    esperaMs = 300
    // Qualquer trecho novo quer dizer que a fala continuou.
    clearTimeout(nomeSozinho)
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const resultado = e.results[i]
      const fala = resultado[0].transcript.trim()
      const decisao = decidirChamada(fala, resultado.isFinal)
      if (decisao === 'agora') return chamar(fala)
      if (decisao === 'se_parar') nomeSozinho = setTimeout(() => chamar(fala), NOME_ESTAVEL_MS)
    }
  }
  rec.onerror = ({ error }) => {
    if (error === 'not-allowed' || error === 'service-not-allowed') {
      parado = true
      aoFalhar('O navegador recusou o reconhecimento de fala. Use Espaço para me acordar.')
    } else if (error === 'network') {
      esperaMs = Math.min(esperaMs * 2, 30_000)
    }
  }
  rec.onend = () => {
    if (parado) return
    religar = setTimeout(() => {
      try {
        rec.start()
      } catch {
        /* já estava ligado */
      }
    }, esperaMs)
  }
  rec.start()

  return {
    stop() {
      parado = true
      clearTimeout(religar)
      clearTimeout(nomeSozinho)
      rec.stop()
    },
  }
}
