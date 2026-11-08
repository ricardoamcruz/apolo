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

/** `sim`: ele fala ou trabalha. `talvez`: alguém fala agora, ou a resposta está saindo. */
export type Ocupacao = 'sim' | 'talvez' | 'nao'

export function criarJanela(
  aoFechar: () => void,
  ocupado: () => Ocupacao,
  { janelaMs = JANELA_DA_CONVERSA_MS, prorrogacaoMs = PRORROGACAO_MS } = {},
) {
  let prazo: ReturnType<typeof setTimeout> | null = null
  let prorrogou = false

  const pausar = () => {
    if (prazo) clearTimeout(prazo)
    prazo = null
  }
  const vencer = () => {
    prazo = null
    const agora = ocupado()
    // Falando ou numa tarefa, o fim disso reabre a janela; isto só garante que ela volte.
    if (agora === 'sim') return void (prazo = setTimeout(vencer, prorrogacaoMs))
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
