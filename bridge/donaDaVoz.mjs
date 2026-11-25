/**
 * Uma interface de voz por vez (docs/adr/0035). Com duas janelas abertas, as duas
 * ouviriam e responderiam. A dona é a que assumiu por último: ao abrir, ou quando
 * o Ricardo a acorda. As outras seguem mostrando a tela, com a voz desligada.
 */
export function criarDonaDaVoz(avisar = () => {}) {
  const janelas = new Map()
  let dona = null

  const decidir = () => {
    let nova = null
    for (const [cliente, j] of janelas) if (!nova || j.desde > janelas.get(nova).desde) nova = cliente
    if (nova === dona) return false
    dona = nova
    return true
  }
  const contar = () => avisar(dona ? janelas.get(dona).id : null)

  return {
    /** `desde`: quando ela abriu ou foi acordada. Religar à ponte não muda quem é a dona. */
    assumir(cliente, id, desde) {
      janelas.set(cliente, { id, desde })
      decidir()
      // Sempre conta, mesmo sem mudar: quem acabou de chegar precisa saber.
      contar()
    },
    saiu(cliente) {
      if (janelas.delete(cliente) && decidir()) contar()
    },
    /** Sem dona conhecida (uma página antiga), todas falam. */
    ehDona: (cliente) => dona === null || dona === cliente,
  }
}
