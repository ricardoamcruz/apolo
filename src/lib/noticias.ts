/**
 * Os temas de notícia do bom dia, mudados por voz (docs/adr/0039).
 *
 * A ferramenta `noticias` chega com uma ação e, no máximo, um tema; aqui ela vira o
 * pedido que a ponte repassa à A.U.R.O.R.A. É a mesma tradução na web e no celular:
 * o bom dia é o mesmo nos dois, e a escolha dele também.
 */

export type PedidoDosTemas = {
  listar?: boolean
  tirar?: string
  incluir?: { nome: string; busca: string }
  porTema?: number
  restaurar?: boolean
}

/** O pedido, ou uma frase para a voz dizer quando falta o essencial. */
export function pedidoDosTemas(args: Record<string, unknown>): PedidoDosTemas | string {
  const acao = String(args.acao ?? '')
  const tema = String(args.tema ?? '').trim()
  switch (acao) {
    case 'listar':
      return { listar: true }
    case 'tirar':
      return tema ? { tirar: tema } : 'Diga qual tema ele quer tirar do bom dia.'
    case 'incluir':
      return tema
        ? { incluir: { nome: tema, busca: String(args.busca ?? '').trim() || tema } }
        : 'Diga qual tema ele quer incluir no bom dia.'
    case 'quantidade': {
      const n = Number(args.quantidade)
      return Number.isInteger(n) ? { porTema: n } : 'Diga quantas notícias por tema ele quer, de 1 a 5.'
    }
    case 'padrao':
      return { restaurar: true }
    default:
      return `Ação desconhecida: ${acao || 'nenhuma'}.`
  }
}
