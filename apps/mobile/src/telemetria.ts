export type Rede = 'wifi' | 'celular' | 'outra' | 'sem_rede'

export type Evento = { t: number; nome: string; ms?: number; info?: string; rede?: Rede }

/** Sem conexão, guarda o que der: é justamente quando a medida mais interessa. */
const LIMITE = 500
const LOTE = 100
const INTERVALO_MS = 30_000

/**
 * Medições do app, em lotes pelo canal (docs/adr/0020). Fica só na memória: se o app
 * for fechado sem conexão, o que não saiu se perde, e isso é aceitável para um log.
 */
export class Telemetria {
  /** A rede de agora, carimbada em cada evento. */
  rede: Rede | undefined
  private fila: Evento[] = []
  private relogio: ReturnType<typeof setInterval> | null = null
  private readonly enviar: (eventos: Evento[]) => boolean
  private readonly intervaloMs: number

  constructor(enviar: (eventos: Evento[]) => boolean, intervaloMs: number = INTERVALO_MS) {
    this.enviar = enviar
    this.intervaloMs = intervaloMs
  }

  registrar(nome: string, ms?: number, info?: string) {
    this.fila.push({ t: Date.now(), nome, ms, info, rede: this.rede })
    if (this.fila.length > LIMITE) this.fila.shift()
  }

  /** O que não couber no lote vai no próximo: o `enviar` pode falhar no meio. */
  descarregar() {
    while (this.fila.length) {
      const lote = this.fila.slice(0, LOTE)
      if (!this.enviar(lote)) return
      this.fila.splice(0, lote.length)
    }
  }

  ligar() {
    if (!this.relogio) this.relogio = setInterval(() => this.descarregar(), this.intervaloMs)
  }

  desligar() {
    if (this.relogio) clearInterval(this.relogio)
    this.relogio = null
  }
}
