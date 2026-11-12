/**
 * O que a voz do PC e a do celular fazem igual com a F.Ê.N.I.X. (docs/adr/0025 e 0030).
 */

/** O que a Fênix devolve a um pedido. */
export type RespostaDaFenix = { ok: boolean; mensagem: string; saida?: string }

/** "nivel=30, dias=2" vira { nivel: '30', dias: '2' }. A Fênix confere cada valor. */
export function lerParametros(texto: string): Record<string, string> {
  const valores: Record<string, string> = {}
  for (const par of texto.split(',')) {
    const [chave, ...resto] = par.split('=')
    if (chave?.trim() && resto.length) valores[chave.trim()] = resto.join('=').trim()
  }
  return valores
}

/** O que a voz recebe de volta: a mensagem e o fim da saída, onde fica o erro. */
export function textoDaFenix(r: RespostaDaFenix) {
  const saida = r.saida?.trim()
  return saida ? `${r.mensagem}\nSaída:\n${saida.slice(-1500)}` : r.mensagem
}
