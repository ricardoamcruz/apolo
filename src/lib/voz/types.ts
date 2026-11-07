/** Tipos comuns aos provedores de voz em tempo real (OpenAI e Gemini). */

export type ToolResult = {
  /** Texto devolvido ao modelo como resultado da ferramenta. */
  output: string
  /** Imagem (data URL) anexada à conversa para o modelo ver. */
  image?: string
  /** Não pedir uma nova resposta depois (ex.: ao dormir). */
  silent?: boolean
  /** Descarta o que o modelo ainda disser nesta vez (ex.: fala que não era para ele). */
  descartar?: boolean
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
  /** Nível 0..1 do microfone: o quanto ele está captando de você agora. */
  nivelDoMic?: () => number
  /** Destrava o áudio dentro de um toque, para quem exige gesto (iOS). */
  retomar?: () => void
  close: () => void
  readonly model: string
}

/** Estado exposto para o painel de diagnóstico (tecla D). */
export const diag = {
  state: 'desligado',
  provider: '',
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

/** O que a ponte devolve em POST /realtime/sessao. */
export type SessionGrant =
  | { provider: 'openai'; value: string; model: string }
  | { provider: 'gemini'; token: string; model: string; setup: Record<string, unknown> }
