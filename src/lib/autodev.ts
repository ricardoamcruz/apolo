/**
 * Autodesenvolvimento, do lado da interface (docs/adr/0011).
 *
 * A confirmação falada é conferida aqui, contra a transcrição do que a pessoa
 * disse, e não contra o que o modelo de voz afirma. O modelo pode ser enganado
 * por um texto que recebeu de uma ferramenta; a transcrição do microfone, não.
 */

export type AutodevEstado = {
  ligado: boolean
  fase: 'ocioso' | 'proposto' | 'trabalhando' | 'verificando' | 'aplicando'
  pedido?: string
  etapa?: string
  criadoEm?: number
  resultado?: {
    id: string
    tipo: 'concluido' | 'revertido' | 'revisao' | 'falhou' | 'cancelado' | 'recusado'
    mensagem: string
    branch?: string
  }
}

const NEGA = /\b(n[ãa]o|cancel\w*|espera|pare|para)\b/i
const CONFIRMA = /\b(confirm\w*|sim|pode|autoriz\w*|aprov\w*|manda|fa[çz]a)\b/i

export const pareceConfirmacao = (fala: string) => CONFIRMA.test(fala) && !NEGA.test(fala)

/**
 * A última fala da pessoa, e quando foi. A transcrição da OpenAI pode chegar
 * depois da chamada da ferramenta, por isso quem confere espera um instante.
 */
const ouvida = { texto: '', em: 0 }

export function registrarFala(texto: string) {
  ouvida.texto = texto
  ouvida.em = Date.now()
}

/** A pessoa disse "sim" depois de a proposta aparecer? */
export async function ouviuConfirmacao(desde: number, esperaMs = 2500): Promise<boolean> {
  const limite = Date.now() + esperaMs
  while (true) {
    if (ouvida.em > desde && pareceConfirmacao(ouvida.texto)) return true
    if (Date.now() > limite) return false
    await new Promise((ok) => setTimeout(ok, 150))
  }
}
