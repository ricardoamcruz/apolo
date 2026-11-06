/**
 * O que sai de um trabalho aprovado: o nome da branch e o commit com título de
 * verdade (docs/adr/0015). Só texto, sem Git: testável sem repositório. O número
 * da fase vem de bridge/branches.mjs (docs/adr/0016).
 */

const NOME = /^fase-\d+(\.\d+)*\/[a-z0-9]+(-[a-z0-9]+)*$/
const APELIDO = /^[a-z0-9]+(-[a-z0-9]+)*$/

export const branchValida = (nome) => NOME.test(String(nome ?? ''))

const semAcento = (texto) => texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

function apelido(texto) {
  const palavras = semAcento(texto).match(/[a-z0-9]+/g) ?? []
  return palavras.slice(0, 5).join('-') || 'alteracao'
}

/** Separa do texto do agente o resumo falado, a branch e o título do commit. */
export function lerEntrega(texto, pedido) {
  const bruto = String(texto ?? '')
  // Se o agente mandar o número mesmo assim, vale só o nome: quem conta é a ponte.
  const nome = bruto.match(/^BRANCH:\s*(\S+)\s*$/im)?.[1].replace(/^fase-[\d.]+\//, '')
  const titulo = bruto.match(/^COMMIT:\s*(.+?)\s*$/im)?.[1]
  return {
    resumo: bruto.replace(/^(BRANCH|COMMIT):.*$/gim, '').trim(),
    branch: APELIDO.test(nome ?? '') ? nome : apelido(pedido),
    titulo: titulo?.slice(0, 72) || pedido.slice(0, 72),
  }
}

/** O nome pedido ou, se já existir, o primeiro livre com sufixo numérico. */
export async function nomeLivre(nome, existe) {
  let candidato = nome
  for (let n = 2; await existe(candidato); n++) candidato = `${nome}-${n}`
  return candidato
}

const VAGOS = new Set([
  'aprovo', 'autorizo', 'confirma', 'confirmado', 'confirmar', 'confirmo', 'continua', 'continue',
  'de novo', 'faca', 'manda', 'novamente', 'ok', 'pode', 'pode fazer', 'pode seguir', 'sim',
  'tenta de novo', 'tenta novamente', 'tente de novo', 'tente novamente', 'tentar novamente', 'vai',
])

/**
 * A voz chegou a mandar "confirmo" e "tente novamente" como se fossem o pedido, e
 * o agente, sem saber o que fazer, escolheu sozinho o próximo item do roadmap.
 */
export const pedidoVago = (texto) =>
  VAGOS.has(semAcento(String(texto ?? '')).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim())
