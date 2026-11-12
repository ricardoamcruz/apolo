/**
 * O canal da F.Ê.N.I.X.: WebSocket com token, em `/fenix` (docs/adr/0025).
 *
 * É por aqui, e só por aqui, que o projeto fala com a Fênix — da mesma máquina ou
 * de outra. Mensagem é JSON com `type`; um pedido com `id` recebe uma resposta com
 * `resposta: id`. Avisos (o resultado de uma troca, uma queda) vão para todos os
 * conectados e, se não houver ninguém, esperam numa fila: o projeto costuma estar
 * justamente reiniciando quando eles acontecem.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { WebSocketServer } from 'ws'

export const CAMINHO = '/fenix'
export const TOKEN_MINIMO = 32
const FILA_MAX = 50
const PULSO_MS = 20_000

const resumo = (texto) => createHash('sha256').update(String(texto)).digest()

export function tokenConfere(cabecalho, token) {
  if (typeof cabecalho !== 'string' || !token) return false
  const [esquema, recebido] = cabecalho.split(' ')
  if (esquema !== 'Bearer' || !recebido) return false
  return timingSafeEqual(resumo(recebido), resumo(token))
}

/**
 * @param atender      recebe a mensagem e devolve a resposta (ou nada)
 * @param aoConectar   recebe uma função de envio para o cliente novo
 */
export function criarCanal({ token, host = '127.0.0.1', porta = 8790, tls, atender, aoConectar = () => {}, log = console.log }) {
  if (!token || token.length < TOKEN_MINIMO) {
    throw new Error(`o token da Fênix precisa de pelo menos ${TOKEN_MINIMO} caracteres`)
  }
  const responder404 = (_req, res) => {
    res.writeHead(404)
    res.end()
  }
  const servidor = tls ? createHttpsServer(tls, responder404) : createServer(responder404)
  const clientes = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })
  const fila = []

  const recusar = (socket, status, texto) => {
    socket.write(`HTTP/1.1 ${status} ${texto}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
    socket.destroy()
  }

  servidor.on('upgrade', (req, socket, cabeca) => {
    if ((req.url ?? '').split('?')[0] !== CAMINHO) return recusar(socket, 404, 'Not Found')
    if (!tokenConfere(req.headers.authorization, token)) {
      log('[fenix] conexão recusada: token inválido')
      return recusar(socket, 401, 'Unauthorized')
    }
    clientes.handleUpgrade(req, socket, cabeca, (ws) => {
      ws.vivo = true
      ws.avulso = req.headers['x-fenix-cliente'] === 'avulso'
      ws.on('pong', () => (ws.vivo = true))
      const enviar = (msg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg))
      ws.on('message', async (bruto) => {
        let msg
        try {
          msg = JSON.parse(bruto.toString())
        } catch {
          return
        }
        if (!msg || typeof msg.type !== 'string') return
        let r
        try {
          r = await atender(msg)
        } catch (err) {
          r = { ok: false, mensagem: err.message }
        }
        if (r !== undefined && msg.id !== undefined) enviar({ type: `${msg.type}:resposta`, resposta: msg.id, ...r })
      })
      // Um cliente avulso (a linha de comando) só faz o próprio pedido: a fila e o
      // retrato inicial são de quem é o projeto.
      if (ws.avulso) return
      for (const aviso of fila.splice(0)) enviar(aviso)
      aoConectar(enviar)
    })
  })

  const pulso = setInterval(() => {
    for (const ws of clientes.clients) {
      if (!ws.vivo) {
        ws.terminate()
        continue
      }
      ws.vivo = false
      ws.ping()
    }
  }, PULSO_MS)
  pulso.unref()

  /** Os avisos e o estado são do projeto: o cliente avulso não conta. */
  const abertos = () => [...clientes.clients].filter((ws) => ws.readyState === ws.OPEN && !ws.avulso)

  return {
    conectados: () => abertos().length,
    /** Para todos; se não houver ninguém, guarda para o próximo que chegar. */
    avisar(msg) {
      const lista = abertos()
      if (!lista.length) {
        fila.push(msg)
        if (fila.length > FILA_MAX) fila.shift()
        return
      }
      for (const ws of lista) ws.send(JSON.stringify(msg))
    },
    /** Para quem estiver conectado agora; o que é só estado não precisa esperar. */
    transmitir(msg) {
      for (const ws of abertos()) ws.send(JSON.stringify(msg))
    },
    ligar: () =>
      new Promise((resolve, reject) => {
        servidor.once('error', reject)
        servidor.listen(porta, host, () => {
          servidor.off('error', reject)
          resolve(servidor.address().port)
        })
      }),
    fechar: () =>
      new Promise((resolve) => {
        clearInterval(pulso)
        for (const ws of clientes.clients) ws.terminate()
        servidor.close(() => resolve())
      }),
  }
}
