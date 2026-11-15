/**
 * Conversa contínua depois do nome (docs/adr/0024).
 *
 * Depois que o Ricardo o chama, a conversa segue sem repetir o nome. Só o que é
 * dirigido a ele (uma resposta, uma tarefa) reabre a janela. A TV, outra pessoa ou
 * uma fala ignorada não reabrem, e é isso que o leva à espera com a TV ligada.
 */

/** Sem nada dirigido a ele por este tempo, ele volta à espera. */
export const JANELA_DA_CONVERSA_MS = 20_000
/** Se o prazo vence no meio de uma fala, ele espera mais isto, uma vez. */
export const PRORROGACAO_MS = 8_000
/**
 * Até quando, depois do prazo, ele espera o modelo decidir sobre uma fala que já
 * terminou. Fechar antes corta o microfone, e o Gemini, sem o silêncio do fim da
 * fala, nunca responde: ele só respondia quando o Ricardo apertava Espaço.
 */
export const ESPERA_DA_DECISAO_MS = 20_000

/**
 * `sim`: ele fala ou trabalha. `decidindo`: alguém falou, e o modelo ainda não
 * respondeu nem ignorou a fala. `talvez`: alguém fala agora.
 */
export type Ocupacao = 'sim' | 'decidindo' | 'talvez' | 'nao'

export function criarJanela(
  aoFechar: () => void,
  ocupado: () => Ocupacao,
  {
    janelaMs = JANELA_DA_CONVERSA_MS,
    prorrogacaoMs = PRORROGACAO_MS,
    esperaDaDecisaoMs = ESPERA_DA_DECISAO_MS,
  } = {},
) {
  let prazo: ReturnType<typeof setTimeout> | null = null
  let prorrogou = false
  /** Quando o prazo venceu com ele livre, desde a última abertura; 0 se ainda não. */
  let venceuEm = 0

  const pausar = () => {
    if (prazo) clearTimeout(prazo)
    prazo = null
  }
  const vencer = () => {
    prazo = null
    const agora = ocupado()
    // Falando ou numa tarefa, o fim disso reabre a janela; isto só garante que ela volte.
    if (agora === 'sim') return void (prazo = setTimeout(vencer, prorrogacaoMs))
    if (!venceuEm) venceuEm = Date.now()
    // A resposta ou o ignorar_fala resolvem; com teto, porque a TV fala uma frase atrás da outra.
    const resta = esperaDaDecisaoMs - (Date.now() - venceuEm)
    if (agora === 'decidindo' && resta > 0) {
      return void (prazo = setTimeout(vencer, Math.min(prorrogacaoMs, resta)))
    }
    // Uma vez só: com a TV falando sem parar, prorrogar sempre o deixaria acordado.
    if (agora === 'talvez' && !prorrogou) {
      prorrogou = true
      return void (prazo = setTimeout(vencer, prorrogacaoMs))
    }
    aoFechar()
  }

  return {
    /** Algo foi dirigido a ele: a janela recomeça inteira. */
    abrir() {
      pausar()
      prorrogou = false
      venceuEm = 0
      prazo = setTimeout(vencer, janelaMs)
    },
    /** Ele está falando ou trabalhando: nada conta até terminar. */
    pausar,
    /** Arma só se não houver prazo correndo, sem estender o que já corre. */
    garantir() {
      if (!prazo) prazo = setTimeout(vencer, janelaMs)
    },
  }
}
