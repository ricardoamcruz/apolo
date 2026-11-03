/**
 * Configuração do A.P.O.L.O. no navegador.
 *
 * Quase tudo agora mora na ponte local (bridge/), que guarda as chaves e
 * configura a sessão de voz. Aqui fica só o endereço dela. Veja .env.example.
 */

/** Vite troca um valor vazio do .env por "", não por undefined. */
function str(raw: unknown): string | undefined {
  const value = typeof raw === 'string' ? raw.trim() : ''
  return value === '' ? undefined : value
}

/** Onde a ponte escuta. Mudar a porta é uma edição só. */
export const BRIDGE_WS_URL = str(import.meta.env.VITE_BRIDGE_URL) ?? 'ws://localhost:8787'
export const BRIDGE_HTTP_URL = BRIDGE_WS_URL.replace(/^ws/, 'http')
