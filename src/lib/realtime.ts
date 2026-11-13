import { BRIDGE_HTTP_URL } from '../config'
import { connectGemini } from './voz/gemini'
import { connectOpenAi } from './voz/openai'
import { diag, logVoz, type RealtimeHandlers, type RealtimeSession, type SessionGrant } from './voz/types'

/**
 * Voz em tempo real — speech-to-speech (docs/adr/0009 e 0010).
 *
 * Um único modelo ouve, pensa e responde em áudio. A ponte local escolhe o
 * provedor (Gemini Live, padrão e gratuito, ou OpenAI Realtime), guarda a chave
 * permanente e devolve uma credencial temporária por sessão. Este módulo só
 * pede essa credencial e entrega ao cliente do provedor certo.
 */

export type { RealtimeHandlers, RealtimeSession, ToolResult } from './voz/types'
export { diag } from './voz/types'

async function grant(): Promise<SessionGrant> {
  let res: Response
  try {
    res = await fetch(`${BRIDGE_HTTP_URL}/realtime/sessao`, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    throw new Error('Não consegui falar com a ponte local. Ela está rodando? Use npm start.')
  }
  if (res.status === 404) {
    throw new Error(
      'A ponte em execução é de uma versão antiga. Feche o npm start que está ' +
        'aberto e rode de novo.',
    )
  }
  if (!res.ok) throw new Error((await res.text()) || `erro ${res.status}`)
  return res.json()
}

export async function connectRealtime(h: RealtimeHandlers): Promise<RealtimeSession> {
  diag.state = 'conectando'
  diag.lastError = ''
  let g: SessionGrant
  const inicio = Date.now()
  logVoz('pedindo a sessão de voz à ponte')
  try {
    g = await grant()
  } catch (err) {
    diag.state = 'falhou'
    diag.lastError = err instanceof Error ? err.message : String(err)
    logVoz(`a ponte não entregou a sessão: ${diag.lastError}`)
    throw err
  }
  diag.provider = g.provider
  diag.model = g.model
  logVoz(`a ponte entregou a sessão em ${Date.now() - inicio} ms (${g.provider})`)
  return g.provider === 'gemini' ? connectGemini(g, grant, h) : connectOpenAi(g, h)
}
