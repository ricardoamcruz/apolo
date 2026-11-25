import type { Blade, Exibicao, Panel } from '../store'
import { BRIDGE_WS_URL } from '../config'
import type { AutodevEstado } from './autodev'
import type { ResumoDoBomDia } from './bomDia'
import type { Servidor } from './sistemas'
import type { BrowserReply, BrowserRequest } from './navegador'

/** O que um pedido ao agente de tarefas recebe enquanto ele trabalha. */
export type AskHandlers = {
  onText: (delta: string) => void
  /** `bruto` é o nome real da ferramenta, para saber o que ela faz. */
  onTool: (name: string, bruto: string) => void
}

/**
 * Client for the local bridge (see bridge/server.mjs).
 *
 * Same `ask()` shape as the browser-direct path, so App.tsx doesn't care which
 * brain is behind it. The difference is what's reachable: this one runs on your
 * machine, so every MCP server in your Claude Code config is in play.
 *
 * The socket is the session. The bridge holds one Claude Agent SDK query per
 * connection and the whole conversation lives inside it, so a dropped socket
 * silently wipes JARVIS's memory of the exchange while the transcript on screen
 * still shows it. That is why the reconnect below is loud rather than
 * invisible: `watchConnection` exists so the HUD can say so.
 */

/** Anything the bridge sends. Deliberately loose — a frame from a future
 *  bridge build should be ignored, not crash the turn. */
type Frame = {
  dona?: string | null
  lista?: unknown[]
  extensao?: string
  dados?: unknown
  type?: string
  delta?: string
  name?: string
  text?: string
  message?: string
  panel?: Panel
  blade?: Blade
  op?: string
  args?: unknown
  id?: string
  ask?: string
  reason?: string
  mode?: string
  seconds?: number
  when?: string
  servers?: Array<string | { name?: string; status?: string; motivo?: string }>
  estado?: AutodevEstado
  valores?: Exibicao
  resposta?: string
  ok?: boolean
  mensagem?: string
  saida?: string
  proposta?: PropostaDaFenix
  action?: string
  url?: string
  as?: string
  width?: number
  height?: number
  /** Qual janela aberta pelo A.P.O.L.O. — não confundir com o `id` do pedido. */
  windowId?: string
}

/** Every question gets an id so its answer can be told from anyone else's. */
let askSeq = 0

let socket: WebSocket | null = null
let connecting: Promise<WebSocket> | null = null

/** Server names reported by the bridge, for the HUD readout. */
let servers: Servidor[] = []
export const bridgeServers = () => servers

/** The list arrives twice — once from config, once with live status — so the
 *  HUD subscribes rather than reading it a single time at boot. */
let onServers: ((s: Servidor[]) => void) | null = null
export function watchServers(fn: (s: Servidor[]) => void) {
  onServers = fn
}

/** Panels arrive out of band — they're pushed while a turn is in flight,
 *  not returned by it. */
let onPanel: ((panel: Panel) => void) | null = null
export function watchPanels(fn: (panel: Panel) => void) {
  onPanel = fn
}

/**
 * The one request the bridge makes of us rather than the other way round.
 *
 * Everything else on this socket is pushed at the browser and needs no answer.
 * A camera frame has to travel back, so this handler is registered by the app
 * and its result is returned against the request's id.
 */
export type CaptureRequest = {
  /** 'look' for a single frame, 'watch' for a grid over time. */
  mode: 'look' | 'watch'
  reason: string
  seconds: number
  /** 'now' records forward; 'past' reads the rolling buffer. */
  when: 'now' | 'past'
}
export type CaptureResult = { data?: string; mimeType?: string; error?: string }

let onCapture: ((req: CaptureRequest) => Promise<CaptureResult>) | null = null
export function watchCapture(fn: (req: CaptureRequest) => Promise<CaptureResult>) {
  onCapture = fn
}

/**
 * O outro pedido que a ponte faz à interface: o navegador (RF-19).
 *
 * Mesmo motivo da câmera. Em que navegador e em que sistema isto está aberto é
 * uma pergunta que só a página responde, e abrir uma aba no navegador da pessoa
 * só a página faz — então a resposta tem que voltar por aqui, contra o id do
 * pedido. O que cada ação significa está em `./navegador`.
 */
let onBrowser: ((req: BrowserRequest) => Promise<BrowserReply>) | null = null
export function watchBrowser(fn: (req: BrowserRequest) => Promise<BrowserReply>) {
  onBrowser = fn
}

/** Blades arrive the same way panels do — pushed mid-turn, so the article is
 *  already open as he starts the sentence about it. */
let onBlade: ((blade: Blade) => void) | null = null
export function watchBlades(fn: (blade: Blade) => void) {
  onBlade = fn
}

/** Commands that redress the interface — theme, reactor, orbits, effects. Same
 *  out-of-band route as panels: JARVIS issues them while he is still mid-answer
 *  so the change is on screen as he says it, which means they cannot ride back
 *  on the turn's result. The op/args pair stays untyped here on purpose — this
 *  module is a transport, and the store is where the shape is decided. */
let onUi: ((op: string, args: any) => void) | null = null
export function watchUi(fn: (op: string, args: any) => void) {
  onUi = fn
}

/** O que ele lembra entre execuções. Vem da ponte ao conectar e a cada mudança. */
let onPreferencias: ((valores: Exibicao) => void) | null = null
export function watchPreferencias(fn: (valores: Exibicao) => void) {
  onPreferencias = fn
}
export async function salvarPreferencias(valores: Partial<Exibicao>) {
  const ws = await connect()
  ws.send(JSON.stringify({ type: 'preferencias', valores }))
}

/** O andamento do autodesenvolvimento. O estado vem ao conectar e a cada mudança. */
let onAutodev: ((estado: AutodevEstado) => void) | null = null
export function watchAutodev(fn: (estado: AutodevEstado) => void) {
  onAutodev = fn
}

export type AutodevResposta = { ok: boolean; mensagem: string }
const respostas = new Map<string, (r: AutodevResposta) => void>()

/**
 * Uma ação do autodesenvolvimento: backlog, propor (com o pedido ou o número de uma
 * tarefa do backlog), confirmar, cancelar, aprovar, reverter, estado.
 */
export async function autodev(
  acao: string,
  extra?: { pedido?: string; tarefa?: string; titulo?: string; detalhe?: string },
): Promise<AutodevResposta> {
  const ws = await connect()
  const id = `d${++askSeq}`
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      respostas.delete(id)
      resolve({ ok: false, mensagem: 'A ponte não respondeu.' })
    }, 15000)
    respostas.set(id, (r) => {
      clearTimeout(timer)
      resolve(r)
    })
    ws.send(JSON.stringify({ type: 'autodev', acao, id, ...extra }))
  })
}

/** A faixa do bom dia (RF-55): o player oficial do YouTube, em volume baixo. */
export type MusicaDoBomDia = {
  id: string
  titulo: string
  canal?: string
  inicio: number
  trechoSegundos: number
  volume: number
  /** A playlist de onde ela veio, para continuar no YouTube Music. */
  playlist?: string
}
/** O mesmo resumo que a voz do celular recebe pelo core, com a faixa para o tocador. */
export type BomDiaResposta = ResumoDoBomDia & { musica?: MusicaDoBomDia | null }
const respostasDaAurora = new Map<string, (r: BomDiaResposta) => void>()

/** Pede o bom dia à A.U.R.O.R.A., pela ponte. */
export async function bomDia(): Promise<BomDiaResposta> {
  const ws = await connect()
  const id = `a${++askSeq}`
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      respostasDaAurora.delete(id)
      resolve({ ok: false, mensagem: 'A ponte não respondeu a tempo.' })
    }, 30_000)
    respostasDaAurora.set(id, (r) => {
      clearTimeout(timer)
      resolve(r)
    })
    ws.send(JSON.stringify({ type: 'aurora', id }))
  })
}

/** Um script bash que a F.Ê.N.I.X. só roda com a confirmação do Ricardo (ADR 0025). */
export type PropostaDaFenix = { id: string; script: string; motivo: string }
export type EstadoDaFenix = { conectada: boolean; propostas: PropostaDaFenix[] }
export type FenixResposta = { ok: boolean; mensagem: string; saida?: string; proposta?: PropostaDaFenix }

let onFenix: ((estado: EstadoDaFenix) => void) | null = null
export function watchFenix(fn: (estado: EstadoDaFenix) => void) {
  onFenix = fn
}
const respostasDaFenix = new Map<string, (r: FenixResposta) => void>()

/** Um pedido à F.Ê.N.I.X., pela ponte: estado, rotina, comando, confirmar, cancelar. */
export async function fenix(
  acao: string,
  extra: Record<string, unknown> = {},
  prazoMs = 20_000,
): Promise<FenixResposta> {
  const ws = await connect()
  const id = `f${++askSeq}`
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      respostasDaFenix.delete(id)
      resolve({ ok: false, mensagem: 'A ponte não respondeu a tempo.' })
    }, prazoMs)
    respostasDaFenix.set(id, (r) => {
      clearTimeout(timer)
      resolve(r)
    })
    ws.send(JSON.stringify({ type: 'fenix', acao, id, ...extra }))
  })
}

/**
 * Connection state, for the UI.
 *
 *   'open'        — first connection of the page.
 *   'lost'        — the socket died. The agent session died with it, so
 *                   everything said so far is gone as far as JARVIS knows.
 *   'reconnected' — we're back, on a fresh session with no memory of the above.
 */
export type ConnectionState = 'open' | 'lost' | 'reconnected'
let onConnection: ((state: ConnectionState) => void) | null = null
export function watchConnection(fn: (state: ConnectionState) => void) {
  onConnection = fn
}

export function isConnected(): boolean {
  return socket?.readyState === WebSocket.OPEN
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** Resolved by the socket-level dispatcher on the first `ready` of the current
 *  connection. Re-armed per connection so a reconnect re-announces. */
let firstReady = deferred()

let everConnected = false

/**
 * A espera entre as tentativas de religar à ponte. Nunca desiste (bug crítico de
 * 18/11/2026): antes parava depois de ~24 s, achando que uma ponte fora por meio
 * minuto tinha sido parada de propósito e que o próximo ask() religaria. Mas a voz
 * não chama ask(): uma ponte que reiniciou devagar deixava a página órfã, e ele
 * ficava mudo. Depois da lista, tenta a cada 8 s para sempre.
 */
const RECONNECT_DELAYS = [500, 1000, 2000, 4000, 8000]
let attempt = 0
let reconnectTimer = 0

function scheduleReconnect() {
  const delay = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)]
  attempt += 1
  clearTimeout(reconnectTimer)
  reconnectTimer = window.setTimeout(() => {
    // Um discado que falha não abre socket, então o onclose não reagenda: sem
    // isto a página desistia na primeira tentativa, antes de a ponte voltar.
    void connect().catch(scheduleReconnect)
  }, delay)
}

/**
 * Voltou à frente, ou a rede voltou: tenta já, sem esperar a vez. Um Chrome em
 * segundo plano atrasa os temporizadores, e um Mac que dormiu volta com as conexões
 * mortas.
 */
function religarJa() {
  if (socket?.readyState === WebSocket.OPEN || connecting || !everConnected) return
  attempt = 0
  clearTimeout(reconnectTimer)
  void connect().catch(scheduleReconnect)
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', religarJa)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') religarJa()
  })
}

/**
 * One message listener per socket, owning everything that isn't part of a
 * turn. It used to live inside warmBridge, bound to that one socket: after any
 * reconnect the SYSTEM rail froze for the life of the page, and every extra
 * warmBridge() call leaked another listener onto the same socket.
 */
function dispatch(ws: WebSocket) {
  ws.addEventListener('message', (e: MessageEvent) => {
    let msg: Frame
    try {
      msg = JSON.parse(e.data as string)
    } catch {
      return
    }

    /** A resposta a um pedido da ponte, marcada com o id dele. */
    const responder = (id: string, payload: Record<string, unknown>) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'reply', id, ...payload }))
      }
    }

    if (msg.type === 'ready') {
      // The bridge announces immediately on connect from Claude Code's config,
      // then again with live status once the agent initialises. Keep listening
      // so the later, more accurate list wins.
      servers = (msg.servers ?? [])
        .map((s) => (typeof s === 'string' ? { nome: s } : { nome: s.name ?? '', estado: s.status, motivo: s.motivo }))
        .filter((s) => s.nome)
      onServers?.(servers)
      firstReady.resolve()
    } else if (msg.type === 'panel' && msg.panel) {
      onPanel?.(msg.panel)
    } else if (msg.type === 'blade' && msg.blade) {
      onBlade?.(msg.blade)
    } else if (msg.type === 'capture' && msg.id) {
      const id = msg.id
      const reply = (payload: Record<string, unknown>) => responder(id, payload)
      if (!onCapture) {
        reply({ error: 'A interface não tem acesso à câmera.' })
      } else {
        // Always answers, even on failure: the bridge is holding a turn open
        // waiting for this, and a rejection that never arrives is a turn that
        // hangs until the idle timer notices.
        onCapture({
          mode: msg.mode === 'watch' ? 'watch' : 'look',
          reason: msg.reason ?? '',
          seconds: Math.max(2, Math.min(15, Number(msg.seconds) || 6)),
          when: msg.when === 'past' ? 'past' : 'now',
        })
          .then(reply)
          .catch((err) => reply({ error: String(err?.message ?? err) }))
      }
    } else if (msg.type === 'browser' && msg.id) {
      const id = msg.id
      if (!onBrowser) {
        responder(id, { error: 'A interface não está pronta para mexer no navegador.' })
      } else {
        // Sempre responde, mesmo falhando: a ponte está com um turno parado
        // esperando por isto.
        onBrowser({
          action: (msg.action ?? 'environment') as BrowserRequest['action'],
          url: msg.url,
          id: msg.windowId,
          as: msg.as === 'popup' ? 'popup' : 'tab',
          width: msg.width,
          height: msg.height,
        })
          .then((payload) => responder(id, payload))
          .catch((err) => responder(id, { error: String(err?.message ?? err) }))
      }
    } else if (msg.type === 'preferencias' && msg.valores) {
      onPreferencias?.(msg.valores)
    } else if (msg.type === 'autodev') {
      if (msg.estado) onAutodev?.(msg.estado)
      if (msg.resposta) {
        respostas.get(msg.resposta)?.({ ok: msg.ok === true, mensagem: msg.mensagem ?? '' })
        respostas.delete(msg.resposta)
      }
    } else if (msg.type === 'aurora' && msg.resposta) {
      respostasDaAurora.get(msg.resposta)?.(msg as unknown as BomDiaResposta)
      respostasDaAurora.delete(msg.resposta)
    } else if (msg.type === 'fenix') {
      if (msg.estado) onFenix?.(msg.estado as unknown as EstadoDaFenix)
      if (msg.resposta) {
        respostasDaFenix.get(msg.resposta)?.({
          ok: msg.ok === true,
          mensagem: msg.mensagem ?? '',
          saida: msg.saida,
          proposta: msg.proposta,
        })
        respostasDaFenix.delete(msg.resposta)
      }
    } else if (msg.type === 'voz_dona') {
      onDona?.(msg.dona === JANELA)
    } else if (msg.type === 'recarregar') {
      onRecarregar?.()
    } else if (msg.type === 'extensoes' && Array.isArray(msg.lista)) {
      onExtensoes?.(msg.lista)
    } else if (msg.type === 'extensao' && msg.extensao) {
      ouvintesDeExtensao.get(msg.extensao)?.(msg.dados)
    } else if (msg.type === 'ui' && msg.op) {
      // A `ui` frame with no args is normal — reset and clear take none — so an
      // absent args object is an empty one, not a reason to drop the command.
      onUi?.(msg.op, (msg.args ?? {}) as Record<string, unknown>)
    }
  })
}

/** As extensões plugáveis (docs/adr/0033): a lista vem ao conectar e a cada mudança na pasta. */
let onExtensoes: ((lista: unknown[]) => void) | null = null
export function watchExtensoes(fn: (lista: unknown[]) => void) {
  onExtensoes = fn
}

/** Ponto de extensão entre dispositivos (docs/adr/0022). Nada usa ainda. */
const ouvintesDeExtensao = new Map<string, (dados: unknown) => void>()

export function ouvirExtensao(extensao: string, ouvir: (dados: unknown) => void) {
  ouvintesDeExtensao.set(extensao, ouvir)
  return () => void ouvintesDeExtensao.delete(extensao)
}

/**
 * Um passo da conexão de voz para o log da ponte. Guarda os últimos enquanto a
 * ponte não está conectada: a voz liga junto com ela, na partida.
 */
const vozPendente: string[] = []
export function registrarVoz(texto: string) {
  vozPendente.push(texto.slice(0, 300))
  if (vozPendente.length > 40) vozPendente.shift()
  if (socket?.readyState !== WebSocket.OPEN) return
  for (const t of vozPendente.splice(0)) socket.send(JSON.stringify({ type: 'voz_log', texto: t }))
}

/**
 * Uma janela com voz por vez (docs/adr/0035). `desde` é quando esta assumiu: ao abrir,
 * ou quando ele a acorda. Religar à ponte manda o mesmo valor, e não rouba a voz.
 */
const JANELA = crypto.randomUUID()
let assumiuEm = Date.now()
let onDona: ((minha: boolean) => void) | null = null
let onRecarregar: (() => void) | null = null
export function watchDona(fn: (minha: boolean) => void) {
  onDona = fn
}
export function watchRecarregar(fn: () => void) {
  onRecarregar = fn
}
const contarQueAssumiu = () => {
  if (socket?.readyState !== WebSocket.OPEN) return
  socket.send(JSON.stringify({ type: 'voz_assumir', janela: JANELA, desde: assumiuEm }))
}
export function assumirVoz() {
  assumiuEm = Date.now()
  contarQueAssumiu()
}
if (typeof window !== 'undefined') {
  // Fechar a janela não é queda: a Fênix não deve reabri-la.
  window.addEventListener('pagehide', () => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'adeus' }))
  })
}

export function enviarExtensao(extensao: string, dados: unknown) {
  if (socket?.readyState !== WebSocket.OPEN) return false
  socket.send(JSON.stringify({ type: 'extensao', extensao, dados }))
  return true
}

function connect(): Promise<WebSocket> {
  if (socket?.readyState === WebSocket.OPEN) return Promise.resolve(socket)
  if (connecting) return connecting

  firstReady = deferred()

  connecting = new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(BRIDGE_WS_URL)
    let settled = false

    /**
     * Every terminal path runs through here, and clearing `connecting` is the
     * whole point. The timeout used to reject without clearing it, which
     * bricked the client: the fast path above hands that same dead promise to
     * every later caller, so one slow start cost you a page reload.
     */
    const settle = (err: Error | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      connecting = null
      if (err) reject(err)
      else resolve(ws)
    }

    const timer = setTimeout(() => {
      ws.close()
      settle(new Error('A ponte não responde — ela está rodando? Use npm start.'))
    }, 6000)

    ws.onopen = () => {
      socket = ws
      attempt = 0
      dispatch(ws)
      contarQueAssumiu()
      settle(null)
      onConnection?.(everConnected ? 'reconnected' : 'open')
      everConnected = true
      // Depois de assumir: a ponte só conta o relato da janela que tem a voz.
      if (vozPendente.length) registrarVoz(vozPendente.pop() as string)
    }
    ws.onerror = () => {
      /**
       * The browser will not tell us why.
       *
       * A refused handshake and a rejected Origin arrive here identically — no
       * status, no reason, just `error` — and the two have completely different
       * fixes. The old message named only one of them, and confidently: it said
       * to start the bridge. When the real cause was the page being served on a
       * port outside the range the bridge trusts, that advice sent everyone to
       * inspect a process that was running perfectly the whole time.
       *
       * So say both, and put the actual port in front of them, since that is
       * the fact that distinguishes the two cases at a glance.
       */
      settle(
        new Error(
          `Não consegui falar com a ponte em ${BRIDGE_WS_URL}. Ou ela não está ` +
            'rodando (inicie com npm start), ou esta página está numa porta que ' +
            'ela recusa — aceita localhost:5173-5199 e 4173-4199, e esta página ' +
            `está na ${location.port || '80'}.`,
        ),
      )
    }
    ws.onclose = () => {
      // A close before open is just a failed dial; after open it's a lost
      // session, and the two want different handling.
      settle(new Error('A ponte encerrou a conexão.'))
      if (socket === ws) {
        socket = null
        // A resposta de um pedido à Fênix vinha por esta ponte e não vem mais. Numa
        // atualização ou num reinício é o esperado; esperar o prazo (até 50 min)
        // deixava a voz presa na ferramenta, sem responder.
        for (const [id, responder] of respostasDaFenix) {
          respostasDaFenix.delete(id)
          responder({
            ok: false,
            mensagem:
              'A ponte reiniciou antes de responder. Numa atualização ou num reinício, isso é o ' +
              'esperado: a Fênix avisa o resultado pela central de notificações. Diga ao Ricardo, ' +
              'em uma frase, que você está reiniciando e já volta.',
          })
        }
        onConnection?.('lost')
        scheduleReconnect()
      }
    }
  })

  return connecting
}

/** Open the socket early so the first "Hey Jarvis" isn't waiting on a handshake. */
export async function warmBridge(): Promise<void> {
  await connect()
  // Don't block startup if the bridge never announces — the dispatcher fills
  // the rail in whenever the list does turn up.
  await Promise.race([
    firstReady.promise,
    new Promise<void>((resolve) => setTimeout(resolve, 2500)),
  ])
}

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------

/**
 * No frame of any kind for two minutes means the turn is never coming back.
 * Generous on purpose: a long agent run can sit silent through a slow tool,
 * and cutting a real answer off is worse than waiting. What this catches is
 * the case that used to hang forever — the bridge alive but the turn lost.
 */
const IDLE_TIMEOUT_MS = 120_000

/** The turn in flight, so a barge-in can settle it locally. */
let pending: { finish: (fallback?: string) => void } | null = null

export async function ask(
  prompt: string,
  handlers: AskHandlers,
): Promise<{ text: string; tools: string[] }> {
  /**
   * A new question supersedes the one in flight.
   *
   * Two concurrent turns genuinely would corrupt each other — both listeners
   * see every delta, and the first 'done' resolves both with the other's text —
   * but refusing the new one was the wrong way to prevent that. It surfaced as
   * "JARVIS is already answering", which is a sentence about this module's
   * bookkeeping rather than about anything the user did, and it contradicts the
   * premise the whole app is built on: say something and it becomes the turn.
   *
   * It fired far more than it looked like it should, because the only thing
   * that cleared the slot was a barge-in — and a barge-in only fires in guard
   * mode. A transcript can arrive well after the speech that produced it: the
   * segment queue means several can be waiting, and their onsets happened while
   * the machine was still listening, when nothing interrupts. So the second
   * utterance of a normal sentence could land on a turn that was already
   * running and simply be refused.
   *
   * Cancelling settles the old promise synchronously, so by the time the code
   * below claims the slot there is nothing left to collide with. The abandoned
   * turn's caller sees its own `stale()` check and stands down quietly.
   */
  if (pending) cancel()

  // Claim the slot in this same tick. connect() below awaits, and two calls
  // made before it settles would otherwise both sail past the check above.
  let cancelledWhileDialling = false
  pending = {
    finish: () => {
      cancelledWhileDialling = true
    },
  }

  let ws: WebSocket
  try {
    ws = await connect()
  } catch (err) {
    pending = null
    throw err
  }

  // Barged in on before the socket was even up. Nothing was ever asked.
  if (cancelledWhileDialling) {
    pending = null
    return { text: '', tools: [] }
  }

  const id = `a${++askSeq}`
  const tools: string[] = []
  let text = ''

  return new Promise((resolve, reject) => {
    let done = false
    let timer = 0

    const cleanup = () => {
      done = true
      pending = null
      clearTimeout(timer)
      ws.removeEventListener('message', onMessage)
      ws.removeEventListener('close', onClose)
      ws.removeEventListener('error', onError)
    }

    const finish = (fallback = '') => {
      if (done) return
      cleanup()
      // Prefer the streamed text; fall back to the final result if this build
      // didn't emit deltas.
      resolve({ text: (text || fallback).trim(), tools })
    }

    const fail = (err: Error) => {
      if (done) return
      cleanup()
      reject(err)
    }

    const arm = () => {
      clearTimeout(timer)
      timer = window.setTimeout(() => {
        fail(new Error('A ponte parou de responder — a tarefa se perdeu.'))
      }, IDLE_TIMEOUT_MS)
    }

    const onMessage = (e: MessageEvent) => {
      // Any frame at all is proof of life, including ones this turn ignores.
      arm()

      let msg: Frame
      try {
        msg = JSON.parse(e.data as string)
      } catch {
        // A frame we can't read is not a reason to abandon the turn. It used
        // to be: the parse threw inside the listener, nothing settled the
        // promise, and App's `busy` flag stayed true for the life of the page.
        return
      }

      /**
       * Somebody else's answer.
       *
       * A superseded turn keeps streaming for a moment after it is abandoned,
       * and this listener is attached to the socket rather than to a turn — so
       * without this check the tail of the old answer is read as the beginning
       * of the new one. Measured before it existed: ask for ALPHA, barge in,
       * ask for BRAVO, and BRAVO's answer came back as "ALPHA".
       */
      if (msg.ask && msg.ask !== id) return

      try {
        switch (msg.type) {
          case 'text':
            text += msg.delta ?? ''
            handlers.onText(msg.delta ?? '')
            break

          case 'tool':
            if (!msg.name) break
            tools.push(msg.name)
            handlers.onTool(prettyToolName(msg.name), msg.name)
            break

          case 'done':
            finish(msg.text ?? '')
            break

          case 'error':
            fail(new Error(msg.message ?? 'A ponte informou um erro.'))
            break
        }
      } catch (err) {
        fail(err instanceof Error ? err : new Error(String(err)))
      }
    }

    const onClose = () => {
      fail(new Error('A ponte caiu no meio da tarefa.'))
    }
    const onError = () => {
      fail(new Error('A conexão com a ponte falhou.'))
    }

    pending = { finish }
    ws.addEventListener('message', onMessage)
    ws.addEventListener('close', onClose)
    ws.addEventListener('error', onError)
    arm()

    try {
      ws.send(JSON.stringify({ type: 'ask', text: prompt, id }))
    } catch (err) {
      // The socket can go into CLOSING between connect() resolving and here.
      fail(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

/**
 * Cut JARVIS off mid-answer.
 *
 * Tells the bridge to stop, then settles the in-flight turn here rather than
 * waiting for a 'done' that a barge-in may never produce. Whatever he had
 * already said is returned, so the caller's await always comes back and the
 * transcript keeps the half-sentence the user actually heard.
 */
export function cancel(): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'interrupt' }))
  }
  pending?.finish()
}

/** The older name for `cancel()`. */
export function interrupt(): void {
  cancel()
}

/** `mcp__higgsfield__generate_image` -> `higgsfield · generate image` */
function prettyToolName(raw: string): string {
  if (!raw.startsWith('mcp__')) return raw
  const [, server, ...rest] = raw.split('__')
  return `${server} · ${rest.join(' ').replace(/_/g, ' ')}`
}
