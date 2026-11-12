/**
 * O que a fala do Ricardo decide sem passar pelo modelo de voz (docs/adr/0023).
 *
 * Com o Gemini, o modelo fica parado esperando a tarefa acabar, então não chamaria
 * uma ferramenta de cancelar a tempo. A transcrição continua chegando, e é ela que
 * manda. A câmera segue a mesma lógica da confirmação do autodesenvolvimento: o
 * modelo pode ser enganado por um texto que recebeu, a transcrição do microfone não.
 */

const normalizar = (fala: string) =>
  fala
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(ei |oi )?apol+o /, '')
    .replace(/ apol+o$/, '')
    .replace(/ por favor$/, '')

const ORDEM = '(cancela|cancele|cancelar|aborta|aborte|abortar|interrompe|interrompa|para|pare|parar|esquece|esqueca|deixa pra la|deixa para la)'
const ALVO = '(isso|isso ai|tudo|(a |essa |esta )?(tarefa|pesquisa|busca))'

/**
 * A frase inteira tem de ser a ordem: "cancela a reunião" é um pedido, e "para o
 * carro" não fala com ele.
 */
const CANCELA = new RegExp(`^(pode )?${ORDEM}( ${ALVO})?$`)

export const pedeCancelamento = (fala: string) => CANCELA.test(normalizar(fala))

/**
 * Um agradecimento que encerra a conversa: a frase inteira, porque "obrigado, e a
 * agenda de amanhã?" continua o assunto.
 */
const AGRADECE = /^(ok |beleza |perfeito |otimo |show |certo )?(muito )?(obrigad[oa]|brigad[oa]|valeu|grato|grata)( (mesmo|demais|viu|ta|pelo resumo|pelas noticias))?$/

export const agradece = (fala: string) => AGRADECE.test(normalizar(fala))

export const pedeModoMaos = (fala: string) => /\b(maos?|gestos?|camera)\b/.test(normalizar(fala))

/**
 * Cancela se a frase parar numa ordem. A espera existe porque a transcrição chega em
 * pedaços: "cancela" pode ser só o começo de "cancela a reunião".
 */
export function vigiarCancelamento(aoCancelar: () => void, esperaMs = 900) {
  let prazo: ReturnType<typeof setTimeout> | null = null
  const parar = () => {
    if (prazo) clearTimeout(prazo)
    prazo = null
  }
  return {
    ouvir(fala: string) {
      parar()
      if (!pedeCancelamento(fala)) return
      prazo = setTimeout(() => {
        prazo = null
        aoCancelar()
      }, esperaMs)
    },
    parar,
  }
}
