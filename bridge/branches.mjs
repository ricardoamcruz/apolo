/**
 * O número da próxima branch: `fase-x.y/nome` (docs/adr/0016).
 *
 * Cada branch nova soma 0.1 à maior já usada. Quem conta é o código, não o modelo:
 * contar exige ver todas as branches, inclusive as já apagadas depois do merge, e
 * por isso as mensagens de merge da `main` também entram na conta.
 */

const FASE_INICIAL = 2

/** A fase da próxima branch, a partir do texto das branches e dos merges. */
export function proximaFase(historico, minima = process.env.APOLO_AUTODEV_FASE) {
  let fase = 0
  let passo = 0
  for (const [, x, y = '0'] of String(historico ?? '').matchAll(/\bfase-(\d+)(?:\.(\d+))?\//g)) {
    const [a, b] = [Number(x), Number(y)]
    if (a > fase || (a === fase && b > passo)) [fase, passo] = [a, b]
  }
  // Mudar de fase é decisão do Ricardo: nenhuma contagem chega lá sozinha.
  const inicial = Number.parseInt(minima, 10) || FASE_INICIAL
  return fase < inicial ? String(inicial) : `${fase}.${passo + 1}`
}

/** @param rodar executa o git com a lista de argumentos e devolve a saída */
export async function historicoDeBranches(rodar, base) {
  const ler = (args) => rodar(args).catch(() => '')
  const refs = await ler(['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes/origin'])
  const merges = await ler(['log', '--merges', '--format=%s', base])
  return `${refs}\n${merges}`
}
