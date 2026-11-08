/**
 * Autodesenvolvimento, do lado da interface (docs/adr/0011).
 *
 * A confirmação falada é conferida aqui, contra a transcrição do que a pessoa
 * disse, e não contra o que o modelo de voz afirma. O modelo pode ser enganado
 * por um texto que recebeu de uma ferramenta; a transcrição do microfone, não.
 */

export type AutodevEstado = {
  ligado: boolean
  fase: 'ocioso' | 'proposto' | 'trabalhando' | 'verificando' | 'aplicando' | 'testando'
  pedido?: string
  etapa?: string
  criadoEm?: number
  testeDesde?: number
  resumo?: string
  resultado?: {
    id: string
    tipo: 'aprovado' | 'revertido' | 'revisao' | 'falhou' | 'cancelado' | 'recusado'
    mensagem: string
    branch?: string
    /** O título do commit aprovado, que vira o título do pull request. */
    titulo?: string
    /** O endereço do pull request, depois de aberto. */
    pr?: string
  }
}

/** "para" só nega sozinho, no começo ou no fim: "manda para a branch" confirma. */
const NEGA = /\b(n[ãa]o|cancel\w*|espera|pare)\b|^\s*para\b|\bpara[\s.,!]*$/i
const CONFIRMA = /\b(confirm\w*|sim|pode|autoriz\w*|aprov\w*|manda|fa[çz]a|gostei)\b/i

export const pareceConfirmacao = (fala: string) => CONFIRMA.test(fala) && !NEGA.test(fala)

/**
 * Por que não há o que confirmar ou aprovar agora, ou nada se há.
 *
 * Vem antes de conferir a fala. Sem proposta, responder "não ouvi" faria o modelo
 * pedir de novo um "confirmo" que já foi ouvido, e um botão que não existe.
 */
export function foraDeHora(acao: 'confirmar' | 'aprovar', estado: AutodevEstado | null) {
  if (!estado?.ligado) {
    return 'O autodesenvolvimento está desligado: precisa iniciar com npm start -- --autodev. Nada foi feito.'
  }
  if (acao === 'aprovar') {
    return estado.fase === 'testando' ? null : 'Não há alteração em teste para aprovar. Nada foi feito.'
  }
  if (estado.fase === 'proposto') return null
  if (estado.fase === 'testando') {
    return 'Não há proposta: há uma alteração em teste. Se o Ricardo gostou dela, use "aprovar". Nada foi feito.'
  }
  if (estado.fase === 'ocioso') {
    return (
      'Não há proposta aguardando, então também não há botão na tela. Nada foi feito. Não peça ' +
      'confirmação de novo: se ele quer uma alteração, use "propor" com o pedido completo.'
    )
  }
  return 'Já há um trabalho em andamento. Nada foi feito.'
}

/**
 * A última fala da pessoa, e quando foi. A transcrição pode chegar depois da
 * chamada da ferramenta, por isso quem confere espera um instante.
 */
const ouvida = { texto: '', em: 0 }

export function registrarFala(texto: string) {
  ouvida.texto = texto
  ouvida.em = Date.now()
}

/** A pessoa disse "sim" depois de a proposta aparecer? */
export const ouviuConfirmacao = (desde: number, esperaMs = 5000) =>
  ouviuFala(pareceConfirmacao, desde, esperaMs)

/** A última fala depois de `desde` passa no teste? */
export async function ouviuFala(
  teste: (fala: string) => boolean,
  desde: number,
  esperaMs = 5000,
): Promise<boolean> {
  const limite = Date.now() + esperaMs
  while (true) {
    if (ouvida.em > desde && teste(ouvida.texto)) return true
    if (Date.now() > limite) return false
    await new Promise((ok) => setTimeout(ok, 150))
  }
}
