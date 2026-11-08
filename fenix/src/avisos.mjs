/**
 * A F.Ê.N.I.X. avisando o Ricardo por uma central de notificações (no A.P.O.L.O.,
 * o H.E.R.M.E.S., docs/adr/0027). A Fênix não sabe quem é a central: só o
 * endereço e o token do fenix.config.json ("notificacoes"), e o protocolo:
 *
 *   → { type: 'notificar', id, titulo, texto, prioridade, botoes: [{ rotulo, acao }] }
 *   ← { type: 'notificacao:acao', notificacao, acao }   quando ele toca num botão
 *
 * Sem central configurada ou fora do ar, os avisos esperam numa fila curta e a
 * Fênix segue normalmente: um aviso nunca atrapalha a guarda.
 */
import { randomBytes } from 'node:crypto'
import { WebSocket } from 'ws'

const FILA_MAX = 20

export function criarAvisos({ url, token, ca, aoTocar = () => {}, log = console.log }) {
  if (!url || !token) return { avisar: () => {}, fechar: () => {} }
  let ws = null
  let aberto = false
  let fechado = false
  let espera = 1000
  const fila = []

  function conectar() {
    ws = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` }, ca: ca ?? undefined })
    ws.on('open', () => {
      aberto = true
      espera = 1000
      for (const m of fila.splice(0)) ws.send(m)
    })
    ws.on('message', (bruto) => {
      try {
        const msg = JSON.parse(bruto.toString())
        if (msg.type === 'notificacao:acao') aoTocar(msg.acao, msg.notificacao)
      } catch {
        /* ignora o que não entende */
      }
    })
    ws.on('unexpected-response', (_q, res) => {
      log(`[fenix] a central de notificações recusou a conexão (${res.statusCode})`)
      ws.terminate()
    })
    ws.on('error', () => {})
    ws.on('close', () => {
      aberto = false
      if (fechado) return
      setTimeout(conectar, espera).unref()
      espera = Math.min(espera * 2, 30_000)
    })
  }
  conectar()

  return {
    avisar({ titulo, texto, prioridade = 'normal', botoes = [] }) {
      const m = JSON.stringify({ type: 'notificar', id: randomBytes(6).toString('hex'), titulo, texto, prioridade, botoes })
      if (aberto) ws.send(m)
      else {
        fila.push(m)
        if (fila.length > FILA_MAX) fila.shift()
      }
    },
    fechar() {
      fechado = true
      ws?.close()
    },
  }
}
