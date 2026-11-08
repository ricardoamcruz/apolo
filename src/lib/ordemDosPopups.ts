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
