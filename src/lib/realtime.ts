import { BRIDGE_HTTP_URL } from '../config'
import { getMic } from './audio'

/**
 * Voz em tempo real — speech-to-speech (ver docs/adr/0009).
 *
 * Um único modelo da OpenAI ouve, pensa e responde em áudio. O navegador abre
 * uma conexão WebRTC direto com a OpenAI: o microfone sobe como uma faixa de
 * áudio, a voz do A.P.O.L.O. desce como outra, e um canal de dados leva os
 * eventos (transcrições, início e fim de fala, chamadas de ferramenta).
 *
 * Não há mais fila de reconhecimento → LLM → síntese. A detecção de turno, a
 * interrupção (falar por cima dele) e o cancelamento de eco acontecem no
 * próprio fluxo, por isso a resposta começa em uma fração de segundo.
 *
 * A chave permanente nunca chega aqui: a ponte local emite uma chave temporária
 * por sessão (POST /realtime/sessao).
 */

export type ToolResult = {
  /** Texto devolvido ao modelo como resultado da ferramenta. */
  output: string
  /** Imagem (data URL) anexada à conversa para o modelo ver. */
  image?: string
  /** Não pedir uma nova resposta depois (ex.: ao dormir). */
  silent?: boolean
}

export type RealtimeHandlers = {
  /** A pessoa começou a falar (já interrompe a fala dele, se houver). */
  onSpeechStart: () => void
  /** A pessoa parou de falar; a resposta está sendo gerada. */
  onSpeechStop: () => void
  /** Transcrição parcial do que a pessoa está dizendo. */
  onUserPartial: (text: string) => void
  /** Transcrição final de uma fala da pessoa. */
  onUserText: (text: string) => void
  /** Começou uma resposta nova (primeiro trecho do texto dela). */
  onAssistantStart: () => void
  onAssistantDelta: (delta: string) => void
  /** O áudio dele começou / terminou de tocar. */
  onSpeakingStart: () => void
  onSpeakingStop: () => void
  onToolCall: (name: string, args: Record<string, unknown>) => Promise<ToolResult>
  onError: (message: string) => void
  /** A sessão acabou (expirou, caiu ou foi encerrada). */
  onClosed: () => void
}

export type RealtimeSession = {
  /** Liga ou desliga o microfone sem encerrar a sessão. */
  setMicOn: (on: boolean) => void
  /** Interrompe o que ele estiver falando agora. */
  interrupt: () => void
  /** Pede uma resposta com uma instrução pontual (ex.: cumprimentar). */
  prompt: (instructions: string) => void
  /** Nível 0..1 da voz dele, para o reator pulsar junto. */
  level: () => number
  close: () => void
  readonly model: string
}

type ServerEvent = {
  type: string
  delta?: string
  transcript?: string
  item_id?: string
  response_id?: string
  error?: { message?: string; code?: string }
  response?: {
    id?: string
    status?: string
    status_details?: { error?: { message?: string } }
    output?: Array<{ type?: string; name?: string; call_id?: string; arguments?: string }>
  }
}

/** Estado exposto para o painel de diagnóstico (tecla D). */
export const diag = {
  state: 'desligado',
  model: '',
  micOn: false,
  speaking: false,
  lastEvent: '',
  lastHeard: '',
  lastError: '',
  responses: 0,
  tools: 0,
  connectedAt: 0,
}
;(globalThis as Record<string, unknown>).__rt = diag

const once = (target: EventTarget, event: string, ms: number, what: string) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(what)), ms)
    target.addEventListener(
      event,
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })

export async function connectRealtime(h: RealtimeHandlers): Promise<RealtimeSession> {
  diag.state = 'conectando'
  diag.lastError = ''

  // 1. Chave temporária, emitida pela ponte.
  let token: { value: string; model: string }
  try {
    const res = await fetch(`${BRIDGE_HTTP_URL}/realtime/sessao`, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) throw new Error((await res.text()) || `erro ${res.status}`)
    token = await res.json()
  } catch (err) {
    diag.state = 'falhou'
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(
      /fetch|network|Failed/i.test(msg)
        ? 'Não consegui falar com a ponte local. Ela está rodando? Use npm start.'
        : msg,
    )
  }
  diag.model = token.model

  // 2. Conexão WebRTC.
  const pc = new RTCPeerConnection()
  const audio = new Audio()
  audio.autoplay = true

  let outAnalyser: AnalyserNode | null = null
  let outBuf: Uint8Array | null = null
  let outCtx: AudioContext | null = null

  pc.ontrack = (e) => {
    const remote = e.streams[0]
    audio.srcObject = remote
    void audio.play().catch(() => {})
    try {
      outCtx = new AudioContext()
      void outCtx.resume()
      const src = outCtx.createMediaStreamSource(remote)
      outAnalyser = outCtx.createAnalyser()
      outAnalyser.fftSize = 512
      outAnalyser.smoothingTimeConstant = 0.7
      src.connect(outAnalyser)
      outBuf = new Uint8Array(outAnalyser.frequencyBinCount)
    } catch {
      /* sem medidor, o reator só não pulsa com a voz dele */
    }
  }

  // Uma cópia da faixa do microfone compartilhado: desligá-la não afeta o
  // medidor do reator nem o detector de palmas, que usam a original.
  const mic = (await getMic()).getAudioTracks()[0].clone()
  pc.addTrack(mic, new MediaStream([mic]))

  const dc = pc.createDataChannel('oai-events')

  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)

  const answer = await fetch('https://api.openai.com/v1/realtime/calls', {
    method: 'POST',
    body: offer.sdp,
    headers: {
      authorization: `Bearer ${token.value}`,
      'content-type': 'application/sdp',
    },
  })
  if (!answer.ok) {
    pc.close()
    mic.stop()
    diag.state = 'falhou'
    throw new Error(`A OpenAI recusou a conexão de voz (${answer.status}): ${await answer.text()}`)
  }
  await pc.setRemoteDescription({ type: 'answer', sdp: await answer.text() })
  await once(dc, 'open', 10000, 'A conexão de voz não abriu a tempo.')

  diag.state = 'conectado'
  diag.connectedAt = Date.now()
  diag.micOn = true

  // 3. Eventos.
  let closed = false
  const send = (event: Record<string, unknown>) => {
    if (dc.readyState === 'open') dc.send(JSON.stringify(event))
  }

  let responding = false
  let toolsRunning = 0
  let wantResponse = false
  let currentResponse = ''
  let partial = ''

  const requestResponse = () => {
    if (responding || toolsRunning > 0) {
      wantResponse = true
      return
    }
    wantResponse = false
    responding = true
    send({ type: 'response.create' })
  }

  const runTool = async (call: { name?: string; call_id?: string; arguments?: string }) => {
    if (!call.name || !call.call_id) return
    let args: Record<string, unknown> = {}
    try {
      args = call.arguments ? JSON.parse(call.arguments) : {}
    } catch {
      /* argumentos ilegíveis: segue vazio e a ferramenta decide */
    }
    toolsRunning++
    diag.tools++
    let result: ToolResult
    try {
      result = await h.onToolCall(call.name, args)
    } catch (err) {
      result = { output: `Erro: ${err instanceof Error ? err.message : String(err)}` }
    }
    toolsRunning--
    if (closed) return
    send({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: call.call_id, output: result.output },
    })
    if (result.image) {
      send({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_image', image_url: result.image }],
        },
      })
    }
    if (!result.silent) requestResponse()
    else if (wantResponse && toolsRunning === 0 && !responding) requestResponse()
  }

  dc.addEventListener('message', (e: MessageEvent) => {
    let ev: ServerEvent
    try {
      ev = JSON.parse(e.data as string)
    } catch {
      return
    }
    diag.lastEvent = ev.type

    switch (ev.type) {
      case 'input_audio_buffer.speech_started':
        partial = ''
        h.onSpeechStart()
        break
      case 'input_audio_buffer.speech_stopped':
        h.onSpeechStop()
        break
      case 'conversation.item.input_audio_transcription.delta':
        partial += ev.delta ?? ''
        h.onUserPartial(partial)
        break
      case 'conversation.item.input_audio_transcription.completed': {
        const text = (ev.transcript ?? '').trim()
        partial = ''
        if (text) {
          diag.lastHeard = text
          h.onUserText(text)
        }
        break
      }
      case 'response.created':
        responding = true
        diag.responses++
        break
      case 'response.output_audio_transcript.delta':
        if (ev.response_id && ev.response_id !== currentResponse) {
          currentResponse = ev.response_id
          h.onAssistantStart()
        }
        h.onAssistantDelta(ev.delta ?? '')
        break
      case 'output_audio_buffer.started':
        diag.speaking = true
        h.onSpeakingStart()
        break
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared':
        diag.speaking = false
        h.onSpeakingStop()
        break
      case 'response.done': {
        responding = false
        const r = ev.response
        if (r?.status === 'failed') {
          const msg = r.status_details?.error?.message ?? 'a resposta falhou'
          diag.lastError = msg
          h.onError(`Erro na voz: ${msg}`)
        }
        const calls = (r?.output ?? []).filter((o) => o.type === 'function_call')
        if (calls.length) {
          for (const c of calls) void runTool(c)
        } else if (wantResponse && toolsRunning === 0) {
          requestResponse()
        }
        break
      }
      case 'error': {
        const msg = ev.error?.message ?? 'erro desconhecido'
        // Corrida inofensiva: pedimos uma resposta enquanto outra começava.
        if (ev.error?.code === 'conversation_already_has_active_response') {
          wantResponse = true
          break
        }
        if (ev.error?.code === 'response_cancel_not_active') break
        diag.lastError = msg
        h.onError(`Erro na voz: ${msg}`)
        break
      }
    }
  })

  const finish = () => {
    if (closed) return
    closed = true
    diag.state = 'encerrado'
    diag.micOn = false
    diag.speaking = false
    try {
      mic.stop()
    } catch {
      /* já parado */
    }
    try {
      pc.close()
    } catch {
      /* já fechado */
    }
    audio.srcObject = null
    void outCtx?.close().catch(() => {})
    h.onClosed()
  }
  dc.addEventListener('close', finish)
  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') finish()
  })

  return {
    model: token.model,
    setMicOn(on) {
      mic.enabled = on
      diag.micOn = on
    },
    interrupt() {
      send({ type: 'response.cancel' })
      send({ type: 'output_audio_buffer.clear' })
    },
    prompt(instructions) {
      if (responding) return
      responding = true
      send({ type: 'response.create', response: { instructions } })
    },
    level() {
      if (!outAnalyser || !outBuf) return 0
      outAnalyser.getByteFrequencyData(outBuf as Uint8Array<ArrayBuffer>)
      let sum = 0
      for (let i = 2; i < outBuf.length; i++) sum += outBuf[i]
      return Math.min(1, (sum / (outBuf.length - 2) / 255) * 3)
    },
    close: finish,
  }
}
