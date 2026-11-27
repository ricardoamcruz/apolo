/**
 * A A.U.R.O.R.A. avisando o Ricardo pela central de notificações (no A.P.O.L.O., o
 * H.E.R.M.E.S.; docs/adr/0027 e 0039).
 *
 * Ela não sabe quem é a central: só o endereço, o token e o protocolo de ida —
 * `POST /notificar`, com `{ titulo, texto, prioridade }` em JSON. Nada aqui é
 * essencial: um aviso que não sai vira uma linha no log e o bom dia segue igual.
 *
 * O texto é sempre uma frase escrita aqui, para gente. Mensagem de erro do Google,
 * do token ou da rede nunca sai daqui: isso fica no log da A.U.R.O.R.A.
 */
import { request as requestHttp } from 'node:http'
import { request } from 'node:https'

const TEXTO_MAX = 300
const PRAZO_MS = 10_000

/**
 * O aviso que a música do bom dia merece quando o acesso ao YouTube muda de estado,
 * ou null quando não mudou nada. Só a mudança avisa: conferido a cada dez minutos,
 * repetir o mesmo problema seria um alarme por hora (docs/adr/0029).
 *
 * @param antes  o problema de antes (string) ou null
 * @param agora  o problema de agora (string) ou null
 */
export function avisoDaMusica(antes, agora) {
  if ((antes ?? null) === (agora ?? null)) return null
  if (!agora) return { titulo: 'A.U.R.O.R.A.: a música voltou', texto: 'O bom dia já tem rock de novo.', prioridade: 'normal' }
  if (antes) return null // de um problema para outro: o primeiro aviso já contou
  const autorizacao = /autoriz|token|credencial|refresh|invalid_grant/i.test(agora)
  return {
    titulo: 'A.U.R.O.R.A.: bom dia sem música',
    texto: autorizacao
      ? 'A música do bom dia precisa de uma autorização nova do YouTube.'
      : 'O bom dia está sem música. O motivo ficou no log da Aurora.',
    prioridade: 'normal',
  }
}

/** Sem endereço ou sem token, `avisar` responde que não há central e nada mais. */
export function criarAvisos({ url, token, ca, log = console.log }) {
  if (!url || !token) {
    const sem = { ok: false, mensagem: 'não há central de notificações configurada' }
    return { avisar: () => Promise.resolve(sem), configurada: () => false }
  }
  const alvo = new URL(url)
  return {
    configurada: () => true,
    /** { ok, mensagem? }. Nunca rejeita. */
    avisar({ titulo, texto, prioridade = 'normal' }) {
      const corpo = JSON.stringify({
        titulo: String(titulo ?? '').slice(0, 80),
        texto: String(texto ?? '').replace(/\s+/g, ' ').trim().slice(0, TEXTO_MAX),
        prioridade,
      })
      return new Promise((resolve) => {
        const pedir = alvo.protocol === 'https:' ? request : requestHttp
        const pedido = pedir(
          alvo,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'content-length': Buffer.byteLength(corpo),
              authorization: `Bearer ${token}`,
            },
            ca,
            timeout: PRAZO_MS,
          },
          (r) => {
            r.resume()
            r.on('end', () => {
              if (r.statusCode !== 200) log(`[aurora] a central de notificações respondeu ${r.statusCode}`)
              resolve({ ok: r.statusCode === 200 })
            })
          },
        )
        pedido.on('timeout', () => pedido.destroy(new Error('a central de notificações não respondeu a tempo')))
        pedido.on('error', (err) => {
          log(`[aurora] aviso não entregue: ${err.message}`)
          resolve({ ok: false, mensagem: err.message })
        })
        pedido.end(corpo)
      })
    },
  }
}
