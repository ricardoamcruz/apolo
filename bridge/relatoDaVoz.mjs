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

/** Estados que só uma conexão nova pedida pela página, ou o provedor ouvindo, desfazem. */
const SURDEZ = new Set(['surda', 'por texto'])

export function criarRelatoDaVoz({ agora = Date.now } = {}) {
  const voz = { estado: 'sem relato', falhas: 0, desde: agora(), ultimo: '' }
  // Uma tentativa vai do pedido da sessão à confirmação ou à primeira falha:
  // o tempo esgotado e o fechamento que vem depois dele contam uma vez só.
  let tentativaContada = false
  let interfaces = 0
  let saiuEm = null
  /** A escuta do nome, na espera, não dá partida: chamá-lo não o acorda. */
  let escutaMudaDesde = null
  /** A página se despediu: a janela foi fechada ou recarregada, e não caiu. */
  let despediu = false

  return {
    /** Um passo relatado pela interface. Só alguns mudam o estado. */
    registrar(texto) {
      const antes = voz.estado
      if (texto.startsWith('abrindo a conexão') || texto.startsWith('pedindo a sessão')) {
        tentativaContada = false
        // Uma sessão nova: a surdez da anterior não vale para ela.
        if (texto.startsWith('pedindo') && SURDEZ.has(voz.estado)) voz.estado = 'sem relato'
        return
      }
      if (texto.startsWith('a escuta da espera não dá partida')) {
        escutaMudaDesde ??= agora()
        return
      }
      if (texto.startsWith('a escuta da espera voltou')) {
        escutaMudaDesde = null
        return
      }
      if (texto.startsWith('sessão confirmada')) {
        // Reabrir não cura a surdez: só o provedor voltar a ouvir.
        if (!SURDEZ.has(voz.estado)) voz.estado = 'ligada'
        voz.falhas = 0
        tentativaContada = true
      } else if (texto.startsWith('voz surda')) {
        voz.estado = 'surda'
      } else if (texto.startsWith('voz por texto')) {
        voz.estado = 'por texto'
      } else if (texto.startsWith('o Google voltou a ouvir')) {
        voz.estado = 'ligada'
      } else if (/^(o Google não confirmou|a ponte não entregou|conexão fechada|a interface não iniciou)/.test(texto)) {
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
      despediu = false
    },

    interfaceSaiu() {
      interfaces = Math.max(0, interfaces - 1)
      // A escuta é da página que saiu; a próxima relata a dela.
      if (!interfaces) {
        saiuEm = agora()
        escutaMudaDesde = null
      }
    },

    /** A última página avisou que ia fechar: ficar sem interface não é queda. */
    despedida() {
      despediu = true
    },

    /** O retrato para o /health. Sem interface há tempo, o último relato não vale mais. */
    paraSaude() {
      if (!interfaces && saiuEm !== null && agora() - saiuEm >= SEM_INTERFACE_MS) {
        if (despediu) return { ...voz, estado: 'fechada', desde: saiuEm, ultimo: 'a janela foi fechada' }
        return { ...voz, estado: 'sem interface', desde: saiuEm, ultimo: 'nenhuma interface ligada à ponte' }
      }
      if (escutaMudaDesde !== null && voz.estado === 'ligada') {
        return { ...voz, estado: 'escuta muda', desde: escutaMudaDesde, ultimo: 'a escuta do nome não dá partida' }
      }
      return { ...voz }
    },
  }
}
