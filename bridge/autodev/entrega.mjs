/**
 * O que sai de um trabalho aprovado: a branch `fase-x.x/nome` e o commit com
 * título de verdade (docs/adr/0015). Só texto, sem Git: testável sem repositório.
 */

const FASE = process.env.APOLO_AUTODEV_FASE?.trim() || '2.2'
const NOME = /^fase-\d+(\.\d+)*\/[a-z0-9]+(-[a-z0-9]+)*$/

export const branchValida = (nome) => NOME.test(String(nome ?? ''))

const semAcento = (texto) => texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

function apelido(texto) {
  const palavras = semAcento(texto).match(/[a-z0-9]+/g) ?? []
  return palavras.slice(0, 5).join('-') || 'alteracao'
}

/** Separa do texto do agente o resumo falado, a branch e o título do commit. */
export function lerEntrega(texto, pedido) {
  const bruto = String(texto ?? '')
  const branch = bruto.match(/^BRANCH:\s*(\S+)\s*$/im)?.[1]
  const titulo = bruto.match(/^COMMIT:\s*(.+?)\s*$/im)?.[1]
  return {
    resumo: bruto.replace(/^(BRANCH|COMMIT):.*$/gim, '').trim(),
    branch: branchValida(branch) ? branch : `fase-${FASE}/${apelido(pedido)}`,
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
