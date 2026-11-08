/**
 * A porta do celular no H.E.R.M.E.S. (docs/adr/0019 e 0025).
 *
 * Uma porta só para o celular, separada da ponte, porque é o desenho que limita o
 * que sai da máquina: o Tailscale publica só esta porta, e aqui só existe o canal
 * de conversa e a leitura da mídia dos popups. Quem atende de verdade é o
 * A.P.O.L.O., do outro lado do relé (src/rele.mjs).
 *
 * A WebView dos popups não põe cabeçalho em <img> nem em <iframe>, então a mídia se
 * autentica por uma chave no caminho, derivada do token: vazá-la dá acesso a esses
 * quatro GETs, nunca ao agente.
 *
 * O Origin não serve aqui. O app nativo não tem origem de verdade, e o iOS manda
 * uma derivada da própria URL, então quem autentica é o token e mais nada.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { WebSocketServer } from 'ws'

export const CAMINHO = '/canal'
export const PORTA_PADRAO = 8788
/** 32 bytes em base64url dão 43 caracteres; menos que isso foi escrito à mão. */
export const TOKEN_MINIMO = 32
const PULSO_MS = 25_000
export const PING = '{"type":"ping"}'
const PONG = '{"type":"pong"}'
/** O que os popups carregam. Tudo leitura, e a ponte já limita cada rota. */
const ROTA_DE_MIDIA = /^\/m\/([\w-]+)(\/(?:img|media|file|page)\?.*)$/
/** O botão de uma notificação (src/notificacoes.mjs): o token de uso único decide. */
const ROTA_DE_ACAO = /^\/acao\/([\w-]{20,100})$/

export const chaveDeMidia = (token) =>
  createHmac('sha256', token).update('apolo.midia').digest('base64url')

const resumo = (texto) => createHash('sha256').update(texto).digest()

/** Compara os resumos, que têm tamanho fixo: o tempo não revela nada do segredo. */
const iguais = (a, b) => timingSafeEqual(resumo(a), resumo(b))

export function tokenConfere(cabecalho, token) {
  if (typeof cabecalho !== 'string' || !token) return false
  const [esquema, recebido] = cabecalho.split(' ')
  if (esquema !== 'Bearer' || !recebido) return false
  return iguais(recebido, token)
}

/**
 * @param {object} opcoes
 * @param {string} opcoes.token
 * @param {string} [opcoes.host] só loopback por padrão: o Tailscale entrega aqui
 * @param {number} [opcoes.porta]
 * @param {(socket: import('ws').WebSocket) => void} opcoes.atender
 * @param {(req: object, res: object, base: string) => void} [opcoes.servirMidia]
 *   recebe `base`, o endereço público da mídia, para reescrever links de páginas
 * @param {number} [opcoes.pulsoMs]
 * @param {{ cert: Buffer, key: Buffer }} [opcoes.tls] com isto, só aceita HTTPS
 * @param {(token: string) => boolean} [opcoes.responderAcao] o toque num botão de notificação
 */
export function criarGateway({
  token,
  host = '127.0.0.1',
  porta = PORTA_PADRAO,
  atender,
  servirMidia,
  pulsoMs = PULSO_MS,
  tls,
  responderAcao,
}) {
  if (!token || token.length < TOKEN_MINIMO) {
    throw new Error(`o token do gateway precisa de pelo menos ${TOKEN_MINIMO} caracteres`)
  }

  const chave = chaveDeMidia(token)

  const atenderHttp = (req, res) => {
    const acao = ROTA_DE_ACAO.exec(req.url ?? '')
    if (acao && responderAcao && (req.method === 'POST' || req.method === 'GET')) {
      const valeu = responderAcao(acao[1])
      res.writeHead(valeu ? 200 : 410, { 'content-type': 'text/plain; charset=utf-8' })
      return res.end(valeu ? 'Recebido.' : 'Este botão já foi usado ou expirou.')
    }
    const rota = ROTA_DE_MIDIA.exec(req.url ?? '')
    if (req.method !== 'GET' || !rota || !servirMidia || !iguais(rota[1], chave)) {
      res.writeHead(404)
      return res.end()
    }
    // A chave já decidiu. O Origin, que a ponte confere, seria o do Tailscale.
    delete req.headers.origin
    req.url = rota[2]
    const esquema = req.headers['x-forwarded-proto'] ?? 'http'
    const host = req.headers['x-forwarded-host'] ?? req.headers.host
    servirMidia(req, res, `${esquema}://${host}/m/${chave}`)
  }
  const servidor = tls ? createHttpsServer(tls, atenderHttp) : createServer(atenderHttp)
  const canais = new WebSocketServer({ noServer: true })

  const recusar = (socket, status, texto) => {
    socket.write(`HTTP/1.1 ${status} ${texto}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
    socket.destroy()
  }

  servidor.on('upgrade', (req, socket, cabeca) => {
    if ((req.url ?? '').split('?')[0] !== CAMINHO) return recusar(socket, 404, 'Not Found')
    if (!tokenConfere(req.headers.authorization, token)) {
      // Nunca o valor recebido: pode ser o token certo com um erro de digitação.
      console.warn('[hermes] celular recusado: token inválido')
      return recusar(socket, 401, 'Unauthorized')
    }
    canais.handleUpgrade(req, socket, cabeca, (ws) => {
      ws.vivo = true
      ws.on('pong', () => {
        ws.vivo = true
      })
      // É assim que o app sabe que o backend responde, e não só que o socket existe:
      // quem atende diz, por `ws.pronto`, se o outro lado está mesmo de pé.
      ws.on('message', (bruto) => {
        if (bruto.toString() === PING && (ws.pronto?.() ?? true)) ws.send(PONG)
      })
      ws.send(JSON.stringify({ type: 'midia', chave }))
      atender(ws)
    })
  })

  // O iOS suspende o app sem fechar nada. Sem isto, uma sessão do agente ficaria
  // presa para sempre a um socket que ninguém mais escuta.
  const pulso = setInterval(() => {
    for (const ws of canais.clients) {
      if (!ws.vivo) {
        ws.terminate()
        continue
      }
      ws.vivo = false
      ws.ping()
    }
  }, pulsoMs)
  pulso.unref()

  return {
    conectados: () => canais.clients.size,
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
        for (const ws of canais.clients) ws.terminate()
        servidor.close(() => resolve())
      }),
  }
}
