/**
 * A central de notificações do H.E.R.M.E.S. (docs/adr/0027).
 *
 * Quem quer avisar o Ricardo (a F.Ê.N.I.X., o A.P.O.L.O., a A.U.R.O.R.A.) conecta
 * em `/notificacoes`, numa porta só local, com token, e manda `notificar`. A
 * central entrega na central de notificações do macOS e no iPhone pelo ntfy.
 *
 * Uma notificação pode ter botões. Cada botão vira um endereço de uso único, com
 * prazo, no endereço público do H.E.R.M.E.S. (pelo Tailscale): o toque no iPhone
 * chama esse endereço, e a resposta volta só para quem pediu a notificação.
 *
 * No sentido contrário, o que o Ricardo publicar no tópico de entrada do ntfy
 * aparece na central do macOS.
 */
import { execFile } from 'node:child_process'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { WebSocketServer } from 'ws'

export const CAMINHO_DAS_NOTIFICACOES = '/notificacoes'
const TITULO_MAX = 80
const TEXTO_MAX = 600
const BOTOES_MAX = 3
const PRAZO_DO_BOTAO_MS = 60 * 60_000
const PRIORIDADES = new Set(['baixa', 'normal', 'alta'])
const PARA_NTFY = { baixa: 2, normal: 3, alta: 4 }

const resumo = (t) => createHash('sha256').update(String(t)).digest()
export const tokenConfere = (cabecalho, token) => {
  const [esquema, recebido] = String(cabecalho ?? '').split(' ')
  return esquema === 'Bearer' && Boolean(recebido) && Boolean(token) && timingSafeEqual(resumo(recebido), resumo(token))
}

/** Na central do macOS. Título e texto vão como argumentos, nunca dentro do script. */
export function notificarNoMac({ titulo, texto }, rodar = execFile) {
  if (process.platform !== 'darwin') return Promise.resolve(false)
  return new Promise((resolve) => {
    rodar(
      'osascript',
      [
        '-e', 'on run argv',
        '-e', 'display notification (item 2 of argv) with title (item 1 of argv) sound name "Glass"',
        '-e', 'end run',
        titulo, texto,
      ],
      { timeout: 10_000 },
      (err) => resolve(!err),
    )
  })
}

/**
 * O ntfy: publica no tópico do Ricardo e escuta o tópico de entrada.
 * O nome do tópico é o segredo: quem o souber lê e publica nele.
 */
export function criarNtfy({ servidor = 'https://ntfy.sh', topico, fetcher = fetch, log = console.log }) {
  if (!topico) return null
  const base = servidor.replace(/\/$/, '')
  return {
    /** Publica em JSON, que leva acentos no título sem truque de cabeçalho. */
    async publicar({ titulo, texto, prioridade = 'normal', botoes = [] }) {
      const r = await fetcher(base, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          topic: topico,
          title: titulo,
          message: texto,
          priority: PARA_NTFY[prioridade] ?? 3,
          tags: ['robot'],
          actions: botoes.map((b) => ({ action: 'http', label: b.rotulo, url: b.url, method: 'POST', clear: true })),
        }),
        signal: AbortSignal.timeout(10_000),
      })
      return r.ok
    },
    /** Escuta o tópico de entrada, reconectando sozinho. Devolve uma função que para. */
    assinar(entrada, aoReceber) {
      let parado = false
      let controle
      const ciclo = async () => {
        let espera = 2000
        while (!parado) {
          try {
            controle = new AbortController()
            const r = await fetcher(`${base}/${entrada}/json`, { signal: controle.signal })
            if (!r.ok || !r.body) throw new Error(`o ntfy respondeu ${r.status}`)
            espera = 2000
            let resto = ''
            for await (const pedaco of r.body) {
              resto += Buffer.from(pedaco).toString('utf8')
              const linhas = resto.split('\n')
              resto = linhas.pop()
              for (const linha of linhas) {
                try {
                  const m = JSON.parse(linha)
                  if (m.event === 'message') aoReceber({ titulo: m.title ?? 'Do iPhone', texto: m.message ?? '' })
                } catch {
                  /* linha incompleta ou de controle */
                }
              }
            }
          } catch (err) {
            if (parado) return
            log(`[hermes] ntfy: ${err.message}; tento de novo em ${espera / 1000} s`)
          }
          await new Promise((r) => setTimeout(r, espera).unref())
          espera = Math.min(espera * 2, 60_000)
        }
      }
      void ciclo()
      return () => {
        parado = true
        controle?.abort()
      }
    },
  }
}

/**
 * @param entregar  { mac(notificacao), ntfy?(notificacao) }: os canais de saída
 * @param urlPublica o endereço do H.E.R.M.E.S. visto do iPhone; sem ele, sem botões
 */
export function criarCentral({ entregar, urlPublica, agora = Date.now, log = console.log }) {
  const botoes = new Map()

  const limpar = () => {
    for (const [token, b] of botoes) if (agora() > b.expira) botoes.delete(token)
  }

  /** Confere, entrega e devolve o id. `responder` recebe o toque num botão. */
  async function notificar(pedido, responder = () => {}) {
    const titulo = String(pedido.titulo ?? '').trim().slice(0, TITULO_MAX)
    const texto = String(pedido.texto ?? '').trim().slice(0, TEXTO_MAX)
    if (!titulo || !texto) return { ok: false, mensagem: 'notificação sem título ou sem texto' }
    const prioridade = PRIORIDADES.has(pedido.prioridade) ? pedido.prioridade : 'normal'
    const id = randomBytes(8).toString('hex')
    limpar()
    const comBotoes = urlPublica
      ? (Array.isArray(pedido.botoes) ? pedido.botoes : []).slice(0, BOTOES_MAX).flatMap((b) => {
          const acao = String(b?.acao ?? '')
          const rotulo = String(b?.rotulo ?? '').slice(0, 30)
          if (!/^[a-z_]{1,40}$/.test(acao) || !rotulo) return []
          const token = randomBytes(24).toString('base64url')
          botoes.set(token, { id, acao, responder, expira: agora() + PRAZO_DO_BOTAO_MS })
          return [{ rotulo, url: `${urlPublica.replace(/\/$/, '')}/acao/${token}` }]
        })
      : []
    const n = { id, titulo, texto, prioridade, botoes: comBotoes }
    const [mac, ntfy] = await Promise.all([
      entregar.mac(n).catch(() => false),
      entregar.ntfy ? entregar.ntfy(n).catch((err) => (log(`[hermes] ntfy: ${err.message}`), false)) : false,
    ])
    return { ok: mac || ntfy, id, mac, ntfy }
  }

  /** O toque num botão. Uso único: o mesmo endereço não vale duas vezes. */
  function responderAcao(token) {
    limpar()
    const b = botoes.get(token)
    if (!b) return false
    for (const [t, outro] of botoes) if (outro.id === b.id) botoes.delete(t)
    b.responder({ id: b.id, acao: b.acao })
    return true
  }

  return { notificar, responderAcao, botoesAbertos: () => botoes.size }
}

/**
 * A porta local dos serviços: WebSocket em /notificacoes, com token. Um pedido
 * `{ type: 'notificar', id, titulo, texto, prioridade?, botoes? }` recebe
 * `{ type: 'notificar:resposta', resposta: id, ok }`; um botão tocado chega como
 * `{ type: 'notificacao:acao', notificacao, acao }`, só para quem pediu.
 */
export function criarPortaDosServicos({ token, central, host = '127.0.0.1', porta = 8792, tls, log = console.log }) {
  if (!token || token.length < 32) throw new Error('o token das notificações precisa de pelo menos 32 caracteres')
  const http = (_q, res) => {
    res.writeHead(404)
    res.end()
  }
  const servidor = tls ? createHttpsServer(tls, http) : createServer(http)
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })
  servidor.on('upgrade', (req, socket, cabeca) => {
    const recusar = (status) => {
      socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
      socket.destroy()
    }
    if ((req.url ?? '').split('?')[0] !== CAMINHO_DAS_NOTIFICACOES) return recusar('404 Not Found')
    if (!tokenConfere(req.headers.authorization, token)) {
      log('[hermes] serviço recusado nas notificações: token inválido')
      return recusar('401 Unauthorized')
    }
    wss.handleUpgrade(req, socket, cabeca, (ws) => {
      const enviar = (m) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m))
      ws.on('message', async (bruto) => {
        let msg
        try {
          msg = JSON.parse(bruto.toString())
        } catch {
          return
        }
        if (msg?.type !== 'notificar') return
        const r = await central.notificar(msg, ({ id, acao }) => enviar({ type: 'notificacao:acao', notificacao: id, acao }))
        enviar({ ...r, type: 'notificar:resposta', resposta: msg.id })
      })
    })
  })
  return {
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
        for (const ws of wss.clients) ws.terminate()
        servidor.close(() => resolve())
      }),
  }
}
