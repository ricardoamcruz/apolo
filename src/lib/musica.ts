/**
 * A música do bom dia (RF-55, docs/adr/0026): continuar a playlist no YouTube Music.
 */

/** O endereço da faixa na playlist dela, a partir de onde parou. */
export function enderecoNoYoutube(m: { id: string; playlist?: string; posicao: number }) {
  const url = new URL('https://music.youtube.com/watch')
  url.searchParams.set('v', m.id)
  if (m.playlist) url.searchParams.set('list', m.playlist)
  url.searchParams.set('t', `${Math.max(0, Math.floor(m.posicao))}s`)
  return url.href
}

/**
 * Abre numa aba nova. Pedido por voz não conta como clique para o Chrome, então a
 * aba pode ser bloqueada (ADR 0012): devolve se abriu, e o tocador oferece o botão.
 */
export function abrirNoYoutube(m: { id: string; playlist?: string; posicao: number }) {
  return Boolean(window.open(enderecoNoYoutube(m), '_blank', 'noopener'))
}
