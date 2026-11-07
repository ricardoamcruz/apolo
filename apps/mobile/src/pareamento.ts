export type Pareamento = {
  /** Endereço completo do canal, já em wss://. */
  url: string
  token: string
}

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

/**
 * Lê o código que o `npm run celular` copia: `https://mac.tailnet.ts.net#token`.
 *
 * Sem criptografia, só o loopback passa, que é onde o simulador encontra o Mac.
 * Numa rede de verdade, o token não pode viajar às claras.
 *
 * Por expressão regular porque o `URL` do React Native não é completo.
 */
export function lerCodigo(codigo: string): Pareamento | null {
  const limpo = codigo.trim()
  const corte = limpo.indexOf('#')
  if (corte === -1) return null
  const token = limpo.slice(corte + 1)
  const partes = /^(https|wss|http|ws):\/\/([^/?#\s]+)\/?$/.exec(limpo.slice(0, corte))
  if (!partes || token.length < 32) return null
  const [, esquema, host] = partes
  const seguro = esquema === 'https' || esquema === 'wss'
  if (!seguro && !LOOPBACK.test(host)) return null
  return { url: `${seguro ? 'wss' : 'ws'}://${host}/canal`, token }
}
