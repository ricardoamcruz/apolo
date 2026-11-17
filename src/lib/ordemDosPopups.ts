type ComId = { id: string }

/** Mais novo primeiro, com o que ele trouxe para a frente no topo. */
export function ordenarPopups<T extends ComId>(abertos: readonly T[], focado: string | null): T[] {
  const novosPrimeiro = [...abertos].reverse()
  const achou = novosPrimeiro.findIndex((p) => p.id === focado)
  if (achou <= 0) return novosPrimeiro
  const [trazido] = novosPrimeiro.splice(achou, 1)
  return [trazido, ...novosPrimeiro]
}

/**
 * O vizinho na ordem de abertura, que não muda. Andar pela ordem da tela não serve:
 * cada passo traz um popup para o topo e reordena a lista, e aí "próximo" só alterna
 * entre dois e nunca chega aos outros.
 */
export function vizinhoDoPopup<T extends ComId>(
  abertos: readonly T[],
  atual: string | undefined,
  passo: number,
): T | null {
  if (abertos.length < 2) return null
  const lista = [...abertos].reverse()
  const aqui = Math.max(0, lista.findIndex((p) => p.id === atual))
  return lista[(aqui + passo + lista.length) % lista.length]
}

type Visivel = ComId & { title: string; minimized?: boolean }

/**
 * O que está na tela, para a voz: o modelo não vê a tela, e sem isto ele não sabia
 * que o popup que o agente abriu continuava lá.
 */
export function descreverTela(
  popups: readonly Visivel[],
  focado: string | null,
  paineis: readonly { title: string }[] = [],
): string {
  const titulos = (lista: readonly { title: string }[]) => lista.map((p) => `"${p.title}"`).join(', ')
  const abertos = ordenarPopups(
    popups.filter((p) => !p.minimized),
    focado,
  )
  const naBandeja = popups.filter((p) => p.minimized)
  const partes: string[] = []
  if (abertos.length) {
    partes.push(
      abertos.length === 1
        ? `Popup aberto: ${titulos(abertos)}.`
        : `Popups abertos: ${titulos(abertos)}; o da frente é "${abertos[0].title}".`,
    )
  }
  if (naBandeja.length) partes.push(`Minimizados na bandeja: ${titulos(naBandeja)}.`)
  if (paineis.length) partes.push(`Painéis: ${titulos(paineis)}.`)
  return partes.length ? `Na tela agora. ${partes.join(' ')}` : 'Não há nenhum popup na tela.'
}

/** O popup aberto cujo título contém o texto, sem diferenciar maiúsculas e acentos. */
export function acharPopup<T extends Visivel>(abertos: readonly T[], texto: string): T | undefined {
  const normal = (t: string) =>
    t
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
  const alvo = normal(texto)
  if (!alvo) return undefined
  // O mais novo primeiro: "o artigo" quer dizer o que acabou de abrir.
  return [...abertos].reverse().find((p) => normal(p.title).includes(alvo))
}
