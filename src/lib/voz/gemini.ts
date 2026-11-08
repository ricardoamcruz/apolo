import { getMic } from '../audio'
import {
  diag,
  type RealtimeHandlers,
  type RealtimeSession,
  type SessionGrant,
  type ToolResult,
} from './types'

/**
 * Provedor Gemini Live — speech-to-speech por WebSocket (docs/adr/0010).
 *
 * Diferente da OpenAI, aqui não há WebRTC: o áudio vai e volta como PCM em
 * base64 dentro de mensagens JSON. Então três coisas que o WebRTC fazia sozinho
 * ficam por nossa conta:
 *
 *   captura   — o microfone é lido por um AudioWorklet num AudioContext de
 *               16 kHz (o navegador reamostra) e sobe em blocos de 40 ms.
 *   reprodução — os blocos de 24 kHz que chegam são enfileirados sem emenda.
 *   eco       — o cancelamento de eco do Chrome não "ouve" o áudio tocado pelo
 *               Web Audio, então, enquanto ele fala, o microfone só sobe quando
 *               a sua voz fica claramente mais alta que a dele (falar por cima).
 *               Com fone de ouvido isso nem é necessário.
 *
 * A conexão do Gemini cai a cada poucos minutos por desenho. O servidor manda
 * um identificador de retomada; quando a conexão fecha, pedimos uma nova chave
 * à ponte e reconectamos com ele, sem perder a conversa.
 */

const WS_URL =
  'wss://generativelanguage.googleapis.com/ws/' +
  'google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained'

const IN_RATE = 16000
const OUT_RATE = 24000
/** 40 ms por bloco a 16 kHz. */
const CHUNK = 640

/** Volume (RMS, 0..1) a partir do qual a sua voz "fura" a fala dele. */
const BARGE_RMS = 0.05
/** Blocos seguidos acima do limiar para contar como fala, não como estalo. */
const BARGE_CHUNKS = 3
/** Blocos guardados enquanto ele fala, para não cortar o começo da sua frase. */
const PREROLL = 6
/** Abaixo disto é o chiado do microfone, não alguém falando. */
const PISO_DO_MIC = 0.006

const CAPTURE_WORKLET = `
class ApoloCaptura extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Int16Array(${CHUNK}); this.n = 0 }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (!ch) return true
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]))
      this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff
      if (this.n === this.buf.length) {
        const out = this.buf.slice(0)
        this.port.postMessage(out.buffer, [out.buffer])
        this.n = 0
      }
    }
    return true
  }
}
registerProcessor('apolo-captura', ApoloCaptura)
`

type Part = { inlineData?: { data?: string; mimeType?: string }; text?: string }
type ServerMessage = {
  setupComplete?: unknown
  serverContent?: {
    modelTurn?: { parts?: Part[] }
    turnComplete?: boolean
    interrupted?: boolean
    generationComplete?: boolean
    inputTranscription?: { text?: string }
    outputTranscription?: { text?: string }
  }
  toolCall?: { functionCalls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }> }
  toolCallCancellation?: { ids?: string[] }
  goAway?: { timeLeft?: string }
  sessionResumptionUpdate?: { newHandle?: string; resumable?: boolean }
  error?: { message?: string }
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(s)
}

function fromBase64(b64: string): Int16Array<ArrayBuffer> {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Int16Array(bytes.buffer, 0, bytes.length >> 1)
}

function rms(pcm: Int16Array): number {
  let sum = 0
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i] / 0x8000
    sum += v * v
  }
  return Math.sqrt(sum / pcm.length)
}

/** Motivos de fechamento do Google, ditos de um jeito que ajuda. */
function explainClose(code: number, reason: string): string {
  const r = reason || `código ${code}`
  if (/quota|exhausted|rate/i.test(r)) return `O limite gratuito do Gemini foi atingido: ${r}`
  if (/api key|permission|unauth|token/i.test(r)) return `O Google recusou a chave: ${r}`
  if (/model/i.test(r)) return `O Google recusou o modelo de voz: ${r}`
  return `A conexão de voz com o Google fechou: ${r}`
}

export async function connectGemini(
  first: Extract<SessionGrant, { provider: 'gemini' }>,
  renew: () => Promise<SessionGrant>,
  h: RealtimeHandlers,
): Promise<RealtimeSession> {
  diag.model = first.model

  // -- áudio: captura ---------------------------------------------------------
  const mic = (await getMic()).getAudioTracks()[0].clone()
  const inCtx = new AudioContext({ sampleRate: IN_RATE })
  const workletUrl = URL.createObjectURL(
    new Blob([CAPTURE_WORKLET], { type: 'application/javascript' }),
  )
  await inCtx.audioWorklet.addModule(workletUrl)
  URL.revokeObjectURL(workletUrl)
  const source = inCtx.createMediaStreamSource(new MediaStream([mic]))
  const capture = new AudioWorkletNode(inCtx, 'apolo-captura')
  source.connect(capture)
  // Um nó precisa chegar ao destino para o Chrome processá-lo; o ganho zero
  // garante que você não se ouve.
  const sink = inCtx.createGain()
  sink.gain.value = 0
  capture.connect(sink).connect(inCtx.destination)
  void inCtx.resume()

  // -- áudio: reprodução -------------------------------------------------------
  const outCtx = new AudioContext({ sampleRate: OUT_RATE })
  void outCtx.resume()
  const analyser = outCtx.createAnalyser()
  analyser.fftSize = 512
  analyser.smoothingTimeConstant = 0.7
  analyser.connect(outCtx.destination)
  const levels = new Uint8Array(analyser.frequencyBinCount)
  const playing = new Set<AudioBufferSourceNode>()
  let nextTime = 0
  let speaking = false
  /** Depois de uma interrupção, descarta o resto da resposta que ainda chegar. */
  let dropUntilTurnEnd = false
  /** Em espera no celular: ouve, mas nada do que ele disser toca (docs/adr/0024). */
  let mudo = false

  const stopPlayback = () => {
    for (const s of playing) {
      try {
        s.stop()
      } catch {
        /* já terminou */
      }
    }
    playing.clear()
    nextTime = 0
    if (speaking) {
      speaking = false
      diag.speaking = false
      h.onSpeakingStop()
    }
  }

  const play = (b64: string) => {
    if (dropUntilTurnEnd || mudo) return
    const pcm = fromBase64(b64)
    if (!pcm.length) return
    const buffer = outCtx.createBuffer(1, pcm.length, OUT_RATE)
    const ch = buffer.getChannelData(0)
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000
    const node = outCtx.createBufferSource()
    node.buffer = buffer
    node.connect(analyser)
    const at = Math.max(outCtx.currentTime + 0.03, nextTime)
    node.start(at)
    nextTime = at + buffer.duration
    playing.add(node)
    node.onended = () => {
      playing.delete(node)
      if (!playing.size && speaking) {
        speaking = false
        diag.speaking = false
        h.onSpeakingStop()
      }
    }
    if (!speaking) {
      speaking = true
      diag.speaking = true
      h.onSpeakingStart()
    }
  }

  // -- estado da conversa ------------------------------------------------------
  let ws: WebSocket | null = null
  let closed = false
  let micOn = true
  let handle: string | null = null
  let reconnecting = false
  let userText = ''
  let userOpen = false
  let assistantOpen = false

  const send = (msg: Record<string, unknown>) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }

  const closeUserTurn = () => {
    if (!userOpen) return
    userOpen = false
    const text = userText.trim()
    userText = ''
    h.onSpeechStop()
    if (text) {
      diag.lastHeard = text
      h.onUserText(text)
    }
  }

  // -- microfone → servidor, com o portão anti-eco -----------------------------
  const preroll: ArrayBuffer[] = []
  let loudRun = 0
  let bargeOpen = false
  let rmsDoMic = 0

  capture.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
    rmsDoMic = micOn ? rms(new Int16Array(e.data)) : 0
    if (!micOn || closed || reconnecting || ws?.readyState !== WebSocket.OPEN) return
    const buf = e.data
    const sendChunk = (b: ArrayBuffer) =>
      send({ realtimeInput: { audio: { data: toBase64(b), mimeType: `audio/pcm;rate=${IN_RATE}` } } })

    if (!speaking) {
      bargeOpen = false
      loudRun = 0
      preroll.length = 0
      sendChunk(buf)
      return
    }
    if (bargeOpen) {
      sendChunk(buf)
      return
    }
    // Ele está falando: só sobe se for a sua voz por cima da dele.
    preroll.push(buf)
    if (preroll.length > PREROLL) preroll.shift()
    loudRun = rms(new Int16Array(buf)) > BARGE_RMS ? loudRun + 1 : 0
    if (loudRun >= BARGE_CHUNKS) {
      bargeOpen = true
      for (const b of preroll) sendChunk(b)
      preroll.length = 0
    }
  }

  // -- ferramentas -------------------------------------------------------------
  const runTools = async (
    calls: Array<{ id?: string; name?: string; args?: Record<string, unknown> }>,
  ) => {
    const responses: Array<Record<string, unknown>> = []
    for (const call of calls) {
      if (!call.name) continue
      diag.tools++
      let result: ToolResult
      try {
        result = await h.onToolCall(call.name, call.args ?? {})
      } catch (err) {
        result = { output: `Erro: ${err instanceof Error ? err.message : String(err)}` }
      }
      if (result.image) {
        const data = result.image.slice(result.image.indexOf(',') + 1)
        send({ realtimeInput: { video: { data, mimeType: 'image/jpeg' } } })
      }
      if (result.descartar) {
        stopPlayback()
        dropUntilTurnEnd = true
      }
      responses.push({ id: call.id, name: call.name, response: { result: result.output } })
    }
    if (!closed && responses.length) send({ toolResponse: { functionResponses: responses } })
  }

  // -- mensagens do servidor ---------------------------------------------------
  const onMessage = (msg: ServerMessage) => {
    if (msg.sessionResumptionUpdate?.resumable && msg.sessionResumptionUpdate.newHandle) {
      handle = msg.sessionResumptionUpdate.newHandle
    }
    if (msg.goAway) {
      diag.lastEvent = 'goAway'
      void reconnect()
      return
    }
    if (msg.toolCall?.functionCalls?.length) {
      diag.lastEvent = 'toolCall'
      closeUserTurn()
      void runTools(msg.toolCall.functionCalls)
      return
    }
    const sc = msg.serverContent
    if (!sc) return

    if (sc.interrupted) {
      diag.lastEvent = 'interrupted'
      stopPlayback()
      assistantOpen = false
      dropUntilTurnEnd = false
      h.onSpeechStart()
    }
    if (sc.inputTranscription?.text) {
      if (!userOpen) {
        userOpen = true
        userText = ''
        dropUntilTurnEnd = false
        h.onSpeechStart()
      }
      userText += sc.inputTranscription.text
      h.onUserPartial(userText.trim())
    }
    if (sc.modelTurn?.parts?.length) {
      diag.lastEvent = 'modelTurn'
      closeUserTurn()
      for (const p of sc.modelTurn.parts) {
        if (p.inlineData?.data && (p.inlineData.mimeType ?? '').startsWith('audio/')) {
          play(p.inlineData.data)
        }
      }
    }
    if (sc.outputTranscription?.text && !dropUntilTurnEnd && !mudo) {
      closeUserTurn()
      if (!assistantOpen) {
        assistantOpen = true
        diag.responses++
        h.onAssistantStart()
      }
      h.onAssistantDelta(sc.outputTranscription.text)
    }
    if (sc.turnComplete) {
      diag.lastEvent = 'turnComplete'
      closeUserTurn()
      assistantOpen = false
      dropUntilTurnEnd = false
      if (!playing.size && speaking) {
        speaking = false
        diag.speaking = false
        h.onSpeakingStop()
      }
    }
  }

  // -- conexão -------------------------------------------------------------------
  const open = (grant: Extract<SessionGrant, { provider: 'gemini' }>) =>
    new Promise<void>((resolve, reject) => {
      const sock = new WebSocket(`${WS_URL}?access_token=${encodeURIComponent(grant.token)}`)
      sock.binaryType = 'arraybuffer'
      let ready = false
      const timer = setTimeout(() => {
        sock.close()
        reject(new Error('O Google não confirmou a sessão de voz a tempo.'))
      }, 12000)

      sock.onopen = () => {
        const setup = { ...grant.setup }
        if (handle) setup.sessionResumption = { handle }
        sock.send(JSON.stringify({ setup }))
      }
      sock.onmessage = (e: MessageEvent) => {
        const raw =
          typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data as ArrayBuffer)
        let msg: ServerMessage
        try {
          msg = JSON.parse(raw)
        } catch {
          return
        }
        if (!ready && msg.setupComplete !== undefined) {
          ready = true
          clearTimeout(timer)
          ws = sock
          resolve()
          return
        }
        if (msg.error?.message) {
          diag.lastError = msg.error.message
          h.onError(`Erro na voz: ${msg.error.message}`)
        }
        if (ws === sock) onMessage(msg)
      }
      sock.onclose = (e: CloseEvent) => {
        clearTimeout(timer)
        if (!ready) {
          reject(new Error(explainClose(e.code, e.reason)))
          return
        }
        if (ws !== sock || closed) return
        ws = null
        // Fechamento normal do Google: reconecta com a retomada.
        if (handle) void reconnect()
        else {
          diag.lastError = explainClose(e.code, e.reason)
          finish()
        }
      }
    })

  const reconnect = async () => {
    if (reconnecting || closed) return
    reconnecting = true
    diag.state = 'reconectando'
    const old = ws
    ws = null
    try {
      old?.close()
    } catch {
      /* já fechado */
    }
    try {
      const grant = await renew()
      if (grant.provider !== 'gemini') throw new Error('o provedor de voz mudou')
      await open(grant)
      diag.state = 'conectado'
    } catch (err) {
      diag.lastError = err instanceof Error ? err.message : String(err)
      finish()
    } finally {
      reconnecting = false
    }
  }

  const finish = () => {
    if (closed) return
    closed = true
    diag.state = 'encerrado'
    diag.micOn = false
    diag.speaking = false
    stopPlayback()
    try {
      ws?.close()
    } catch {
      /* já fechado */
    }
    ws = null
    try {
      mic.stop()
    } catch {
      /* já parado */
    }
    void inCtx.close().catch(() => {})
    void outCtx.close().catch(() => {})
    h.onClosed()
  }

  try {
    await open(first)
  } catch (err) {
    closed = true
    mic.stop()
    void inCtx.close().catch(() => {})
    void outCtx.close().catch(() => {})
    diag.state = 'falhou'
    throw err
  }

  diag.state = 'conectado'
  diag.connectedAt = Date.now()
  diag.micOn = true

  return {
    model: first.model,
    setMicOn(on) {
      micOn = on
      mic.enabled = on
      diag.micOn = on
    },
    interrupt() {
      if (speaking) dropUntilTurnEnd = true
      stopPlayback()
    },
    silenciar(on) {
      mudo = on
      if (on) stopPlayback()
    },
    prompt(instructions) {
      send({ realtimeInput: { text: instructions } })
    },
    level() {
      if (!speaking) return 0
      analyser.getByteFrequencyData(levels)
      let sum = 0
      for (let i = 2; i < levels.length; i++) sum += levels[i]
      return Math.min(1, (sum / (levels.length - 2) / 255) * 3)
    },
    nivelDoMic() {
      // A raiz abre a faixa de baixo, onde fica quase toda fala a um braço do celular.
      return Math.min(1, Math.sqrt(Math.max(0, rmsDoMic - PISO_DO_MIC)) * 1.8)
    },
    retomar() {
      void inCtx.resume()
      void outCtx.resume()
    },
    close: finish,
  }
}
