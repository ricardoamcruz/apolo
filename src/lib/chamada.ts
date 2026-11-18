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
  onstart: (() => void) | null
  onaudiostart: (() => void) | null
  onresult: ((e: { resultIndex: number; results: ArrayLike<Resultado> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
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

/** "Bom dia, Apolo": a saudação some do pedido, mas o bom dia tem rotina própria (RF-55). */
export const deuBomDia = (fala: string) => /\bbom dia\b/.test(normalizar(fala))

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

/** A espera entre religamentos: curta, e com teto baixo, porque cada segundo parado é um chamado perdido. */
export const ESPERA_MIN_MS = 300
export const ESPERA_MAX_MS = 5000
/**
 * Sem nenhum sinal do reconhecedor (início, áudio, resultado, erro ou fim) por este
 * tempo, ele é dado como morto e recriado. O Chrome encerra uma escuta silenciosa bem
 * antes disto, então em funcionamento normal sempre há algum sinal.
 */
export const VIGIA_MS = 45_000

type Escuta = {
  parado: boolean
  esperaMs: number
  nomeSozinho?: ReturnType<typeof setTimeout>
  aoChamar: (fala: string, pedido: string) => void
  aoFalhar: (motivo: string) => void
  relatar: (texto: string) => void
}

/*
 * Um reconhecedor só para a página inteira (bug de 18/11/2026). Antes, cada entrada
 * na espera criava um novo, e numa troca rápida de fase o anterior ainda estava
 * encerrando: o Chrome só deixa um capturar por vez. Agora a escuta nova espera o fim
 * do anterior (`onend`) para começar, e quem recebe os resultados é sempre o dono da
 * sessão que está rodando.
 */
let rec: Reconhecedor | null = null
let ativo = false
let dono: Escuta | null = null
let donoDaSessao: Escuta | null = null
let religar: ReturnType<typeof setTimeout> | undefined
let vigia: ReturnType<typeof setInterval> | undefined
let ultimoSinal = 0

function criarReconhecedor(C: Construtor) {
  const r = new C()
  r.lang = 'pt-BR'
  r.continuous = true
  r.interimResults = true
  const sinal = () => {
    if (rec === r) ultimoSinal = Date.now()
  }
  r.onstart = () => {
    if (rec !== r) return
    sinal()
    ativo = true
    // Começou de verdade: a espera volta ao mínimo (antes, só uma fala reconhecida zerava).
    if (dono) dono.esperaMs = ESPERA_MIN_MS
  }
  r.onaudiostart = sinal
  r.onresult = (e) => {
    if (rec !== r) return
    sinal()
    const d = donoDaSessao
    if (!d || d.parado || d !== dono) return
    // Qualquer trecho novo quer dizer que a fala continuou.
    clearTimeout(d.nomeSozinho)
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const resultado = e.results[i]
      const fala = resultado[0].transcript.trim()
      const decisao = decidirChamada(fala, resultado.isFinal)
      if (decisao === 'agora') return chamar(d, fala)
      if (decisao === 'se_parar') d.nomeSozinho = setTimeout(() => chamar(d, fala), NOME_ESTAVEL_MS)
    }
  }
  r.onerror = ({ error }) => {
    if (rec !== r) return
    sinal()
    const d = dono
    if (!d) return
    if (error === 'not-allowed' || error === 'service-not-allowed') {
      d.parado = true
      d.relatar(`escuta da espera recusada pelo navegador (${error})`)
      d.aoFalhar('O navegador recusou o reconhecimento de fala. Use Espaço para me acordar.')
    } else if (error !== 'no-speech' && error !== 'aborted') {
      // Rede, microfone ocupado: espera um pouco mais, mas nunca mais que o teto.
      d.esperaMs = Math.min(d.esperaMs * 2, ESPERA_MAX_MS)
      d.relatar(`escuta da espera: erro ${error}; religo em ${d.esperaMs} ms`)
    }
  }
  r.onend = () => {
    if (rec !== r) return
    sinal()
    ativo = false
    donoDaSessao = null
    agendar()
  }
  return r
}

function agendar() {
  clearTimeout(religar)
  const d = dono
  if (!d || d.parado || ativo) return
  religar = setTimeout(iniciar, d.esperaMs)
}

function iniciar() {
  const d = dono
  if (!d || d.parado || ativo || !rec) return
  try {
    rec.start()
    ativo = true
    donoDaSessao = d
    ultimoSinal = Date.now()
  } catch (err) {
    if ((err as Error)?.name === 'InvalidStateError') {
      // Já estava ligado: segue, e o `onend` dele religa quando for a hora.
      ativo = true
      donoDaSessao = d
      return
    }
    // Antes, este erro era engolido e nada mais religava: a escuta morria calada.
    d.esperaMs = Math.min(d.esperaMs * 2, ESPERA_MAX_MS)
    d.relatar(`escuta da espera não religou (${(err as Error)?.message ?? err}); recrio em ${d.esperaMs} ms`)
    recriar()
    agendar()
  }
}

/** Joga fora o reconhecedor (que pode estar travado) e cria outro. */
function recriar() {
  const C = construtor()
  const velho = rec
  rec = C ? criarReconhecedor(C) : null
  ativo = false
  donoDaSessao = null
  try {
    velho?.abort()
  } catch {
    /* já parado */
  }
}

function chamar(d: Escuta, fala: string) {
  clearTimeout(d.nomeSozinho)
  if (d.parado) return
  d.parado = true
  try {
    rec?.stop()
  } catch {
    /* já parado */
  }
  d.aoChamar(fala, chamouPeloNome(fala).pedido)
}

/** Só para os testes: esquece o reconhecedor e a escuta, como numa página nova. */
export function reiniciarEscutaParaTestes() {
  clearTimeout(religar)
  clearInterval(vigia)
  rec = null
  ativo = false
  dono = null
  donoDaSessao = null
}

/**
 * Escuta até `stop`. O Chrome encerra o reconhecimento sozinho de tempos em tempos,
 * então ele é religado enquanto a espera durar; e, se o reconhecedor parar de dar
 * sinal, o vigia o recria. `relatar` leva ao log da ponte o que acontece com a escuta
 * (sem a fala), para uma falha não ficar invisível.
 */
export function ouvirNome(
  aoChamar: (fala: string, pedido: string) => void,
  aoFalhar: (motivo: string) => void,
  relatar: (texto: string) => void = () => {},
) {
  const C = construtor()
  if (!C) return { stop() {} }
  if (dono) dono.parado = true
  const d: Escuta = { parado: false, esperaMs: ESPERA_MIN_MS, aoChamar, aoFalhar, relatar }
  dono = d
  if (!rec) rec = criarReconhecedor(C)
  ultimoSinal = Date.now()
  clearInterval(vigia)
  vigia = setInterval(() => {
    if (dono !== d || d.parado) return
    if (Date.now() - ultimoSinal < VIGIA_MS) return
    d.relatar('escuta da espera sem sinal; recriando o reconhecedor')
    recriar()
    iniciar()
  }, 5000)
  // Se o anterior ainda está encerrando, o `onend` dele começa esta.
  if (!ativo) iniciar()

  return {
    stop() {
      d.parado = true
      clearTimeout(d.nomeSozinho)
      if (dono !== d) return
      dono = null
      clearTimeout(religar)
      clearInterval(vigia)
      try {
        rec?.stop()
      } catch {
        /* já parado */
      }
    },
  }
}
