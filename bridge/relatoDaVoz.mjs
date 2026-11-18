/**
 * A voz do PC como a ponte a conhece: só a interface vê a conexão com o provedor, e
 * ela relata os passos (`voz_log`). Este é o retrato que vai no /health, e que a
 * F.Ê.N.I.X. lê e registra quando muda.
 *
 * Bug crítico de 18/11/2026: a página da interface morreu e o /health continuou
 * dizendo "voz ligada", porque era só o último relato que ela tinha mandado. Agora,
 * sem nenhuma interface ligada por `SEM_INTERFACE_MS`, o estado é "sem interface":
 * ninguém está ouvindo, e a Fênix avisa o Ricardo.
 */

/** Folga para a página recarregar (o Vite, um F5) sem virar alarme. */
export const SEM_INTERFACE_MS = 45_000

export function criarRelatoDaVoz({ agora = Date.now } = {}) {
  const voz = { estado: 'sem relato', falhas: 0, desde: agora(), ultimo: '' }
  // Uma tentativa vai do pedido da sessão à confirmação ou à primeira falha:
  // o tempo esgotado e o fechamento que vem depois dele contam uma vez só.
  let tentativaContada = false
  let interfaces = 0
  let saiuEm = null

  return {
    /** Um passo relatado pela interface. Só alguns mudam o estado. */
    registrar(texto) {
      const antes = voz.estado
      if (texto.startsWith('abrindo a conexão') || texto.startsWith('pedindo a sessão')) {
        tentativaContada = false
        return
      }
      if (texto.startsWith('sessão confirmada')) {
        voz.estado = 'ligada'
        voz.falhas = 0
        tentativaContada = true
      } else if (/^(o Google não confirmou|a ponte não entregou|conexão fechada)/.test(texto)) {
        if (tentativaContada) return
        tentativaContada = true
        voz.estado = 'falhando'
        voz.falhas++
      } else return
      voz.ultimo = texto
      if (voz.estado !== antes) voz.desde = agora()
    },

    interfaceEntrou() {
      interfaces++
      saiuEm = null
    },

    interfaceSaiu() {
      interfaces = Math.max(0, interfaces - 1)
      if (!interfaces) saiuEm = agora()
    },

    /** O retrato para o /health. Sem interface há tempo, o último relato não vale mais. */
    paraSaude() {
      if (!interfaces && saiuEm !== null && agora() - saiuEm >= SEM_INTERFACE_MS) {
        return { ...voz, estado: 'sem interface', desde: saiuEm, ultimo: 'nenhuma interface ligada à ponte' }
      }
      return { ...voz }
    },
  }
}
