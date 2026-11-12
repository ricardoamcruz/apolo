/**
 * Um cliente avulso do canal da F.Ê.N.I.X., para a linha de comando: conecta,
 * faz um pedido, espera a resposta e sai (`fenix rotina atualizar`, `fenix avisar`).
 *
 * Avulso quer dizer que ele não é o projeto: o canal não entrega a ele os avisos
 * guardados na fila, que continuam esperando a ponte voltar.
 */
import { randomUUID } from 'node:crypto'
import { WebSocket } from 'ws'

export const CABECALHO_AVULSO = 'x-fenix-cliente'

/** `{ ok, mensagem, ... }`. Nunca rejeita: sem Fênix ou sem resposta, `ok: false` e o motivo. */
export function pedirAFenix({ url, token, ca, msg, prazoMs = 15_000 }) {
  return new Promise((resolve) => {
    const id = randomUUID()
    let acabou = false
    const ws = new WebSocket(url, {
      headers: { Authorization: `Bearer ${token}`, [CABECALHO_AVULSO]: 'avulso' },
      ca: ca ?? undefined,
    })
    const fim = (r) => {
      if (acabou) return
      acabou = true
      clearTimeout(timer)
      ws.terminate()
      resolve(r)
    }
    const timer = setTimeout(() => fim({ ok: false, foraDoAr: false, mensagem: 'A Fênix não respondeu a tempo.' }), prazoMs)
    ws.on('open', () => ws.send(JSON.stringify({ ...msg, id })))
    ws.on('message', (bruto) => {
      try {
        const r = JSON.parse(bruto.toString())
        if (r.resposta !== id) return
        const { type: _t, resposta: _r, ...conteudo } = r
        fim(conteudo)
      } catch {
        /* ignora o que não é para este pedido */
      }
    })
    ws.on('unexpected-response', (_q, res) =>
      fim({ ok: false, foraDoAr: false, mensagem: `A Fênix recusou a conexão (${res.statusCode}); confira o token.` }),
    )
    ws.on('error', (err) =>
      fim({
        ok: false,
        foraDoAr: err.code === 'ECONNREFUSED',
        mensagem: err.code === 'ECONNREFUSED' ? `A Fênix não está no ar em ${url}.` : `Não consegui falar com a Fênix: ${err.message}`,
      }),
    )
  })
}
