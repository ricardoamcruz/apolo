import type { Pareamento } from './pareamento'

export type EstadoDoCanal = 'desligado' | 'conectando' | 'conectado' | 'recusado'

export type EventosDoCanal = {
  aoMudarEstado: (estado: EstadoDoCanal) => void
  aoTexto: (delta: string) => void
  aoFerramenta: (nome: string) => void
  aoPainel: (painel: unknown) => void
  aoPopup: (popup: unknown) => void
  /** Onde os popups buscam imagens e páginas. Chega ao abrir a conexão. */
  aoMidia: (base: string) => void
  /** O texto final do agente, que substitui o que veio em partes. */
  aoTerminar: (texto: string) => void
  aoFalhar: (mensagem: string) => void
  aoCredencial: (id: string, sessao: unknown, erro?: string) => void
  /** Cada medida de tempo da conexão (docs/adr/0020). */
  aoMedir?: (nome: string, ms?: number, info?: string) => void
  /** Mensagem de uma extensão entre dispositivos (docs/adr/0022). Nada usa ainda. */
  aoExtensao?: (extensao: string, dados: unknown) => void
  /** Resposta ou estado do autodesenvolvimento e da Fênix, para a voz (docs/adr/0030). */
  aoCore?: (quadro: Record<string, unknown>) => void
}

/** Os pedidos ao core que o celular pode fazer, como a interface do PC (docs/adr/0030). */
export const TIPOS_DO_CORE = new Set(['autodev', 'fenix'])

/** O pedaço do WebSocket que o canal usa. Nos testes, entra o pacote `ws`. */
export type SocketDoCanal = {
  readyState: number
  send: (dados: string) => void
  close: () => void
  onopen: (() => void) | null
  onclose: (() => void) | null
  onerror: ((evento: { message?: string }) => void) | null
  onmessage: ((evento: { data: unknown }) => void) | null
}

type CriarSocket = (par: Pareamento) => SocketDoCanal

type Quadro = {
  type?: string
  ask?: string | null
  delta?: string
  name?: string
  text?: string
  message?: string
  panel?: unknown
  blade?: unknown
  chave?: string
  extensao?: string
  dados?: unknown
  id?: string
  sessao?: unknown
  erro?: string
}

const ABERTO = 1
const ESPERA_MINIMA_MS = 1_000
const ESPERA_MAXIMA_MS = 5_000
/** Sem resposta ao ping dentro disto, o backend é dado como fora do ar. */
const PULSO_MS = 6_000

/** O terceiro argumento existe no React Native, mas falta nos tipos do DOM. */
const WebSocketNativo = WebSocket as unknown as new (
  url: string,
  protocolos: undefined,
  opcoes: { headers: Record<string, string> },
) => SocketDoCanal

const socketNativo: CriarSocket = ({ url, token }) =>
  new WebSocketNativo(url, undefined, { headers: { Authorization: `Bearer ${token}` } })

/** `mcp__apolo_navegador__chrome_open` → `navegador · chrome open` */
export function nomeDaFerramenta(nome: string) {
  const partes = nome.replace(/^mcp__/, '').replace(/^apolo_/, '').split('__')
  return partes.map((parte) => parte.replaceAll('_', ' ')).join(' · ')
}

/** `wss://host/canal` e a chave → `https://host/m/chave` */
export const baseDeMidia = (url: string, chave: string) =>
  `${url.replace(/^ws/, 'http').replace(/\/canal$/, '')}/m/${chave}`

/** A conversa com o gateway (bridge/gateway.mjs), reconectando sozinha. */
export class Canal {
  private socket: SocketDoCanal | null = null
  private par: Pareamento | null = null
  private estado: EstadoDoCanal = 'desligado'
  private espera = ESPERA_MINIMA_MS
  private retorno: ReturnType<typeof setTimeout> | null = null
  private pedidos = 0
  /** O pedido em andamento. Quadros de qualquer outro são sobras de um cancelado. */
  private pendente: string | null = null
  private pulso: ReturnType<typeof setInterval> | null = null
  private devendoPong = false
  private pingEm = 0
  private abertoEm = 0
  private conectadoEm = 0
  private tarefaEm = 0
  private textoDaTarefa = false
  private readonly credenciaisEm = new Map<string, number>()

  private readonly eventos: EventosDoCanal
  private readonly criarSocket: CriarSocket
  private readonly pulsoMs: number

  constructor(
    eventos: EventosDoCanal,
    criarSocket: CriarSocket = socketNativo,
    pulsoMs: number = PULSO_MS,
  ) {
    this.eventos = eventos
    this.criarSocket = criarSocket
    this.pulsoMs = pulsoMs
  }

  ligar(par: Pareamento) {
    this.desligar()
    this.par = par
    this.abrir()
  }

  desligar() {
    this.par = null
    this.pendente = null
    if (this.retorno) clearTimeout(this.retorno)
    this.retorno = null
    this.pararPulso()
    const socket = this.socket
    this.socket = null
    if (socket) {
      socket.onclose = null
      socket.onerror = null
      socket.onmessage = null
      socket.close()
    }
    this.mudar('desligado')
  }

  /** O iOS derruba o socket em segundo plano: ao voltar, não espera o relógio. */
  retomar() {
    if (!this.par || this.estado === 'recusado') return
    if (this.socket?.readyState === ABERTO) return
    if (this.retorno) clearTimeout(this.retorno)
    this.retorno = null
    this.espera = ESPERA_MINIMA_MS
    if (!this.socket) this.abrir()
  }

  perguntar(texto: string) {
    if (this.socket?.readyState !== ABERTO) return false
    const id = `c${++this.pedidos}`
    this.pendente = id
    this.tarefaEm = Date.now()
    this.textoDaTarefa = false
    this.socket.send(JSON.stringify({ type: 'ask', id, text: texto }))
    return true
  }

  interromper() {
    this.pendente = null
    if (this.socket?.readyState === ABERTO) {
      this.socket.send(JSON.stringify({ type: 'interrupt' }))
    }
  }

  /** Pede a credencial da sessão de voz, que volta por `aoCredencial`. */
  pedirCredencial(id: string) {
    if (this.socket?.readyState !== ABERTO) return false
    this.credenciaisEm.set(id, Date.now())
    this.socket.send(JSON.stringify({ type: 'voz_sessao', id }))
    return true
  }

  /**
   * Um pedido ao core (`autodev` ou `fenix`), com o id da voz. A resposta volta por
   * `aoCore`, com `resposta` igual a esse id. Quem decide se pode é a ponte.
   */
  pedirAoCore({ tipo, ...pedido }: { tipo: string; id: string; acao: string } & Record<string, unknown>) {
    if (this.socket?.readyState !== ABERTO || !TIPOS_DO_CORE.has(tipo)) return false
    this.socket.send(JSON.stringify({ ...pedido, type: tipo }))
    return true
  }

  enviarExtensao(extensao: string, dados: unknown) {
    if (this.socket?.readyState !== ABERTO) return false
    this.socket.send(JSON.stringify({ type: 'extensao', extensao, dados }))
    return true
  }

  enviarTelemetria(eventos: unknown[]) {
    if (this.socket?.readyState !== ABERTO || this.estado !== 'conectado') return false
    this.socket.send(JSON.stringify({ type: 'telemetria', eventos }))
    return true
  }

  private pararPulso() {
    if (this.pulso) clearInterval(this.pulso)
    this.pulso = null
  }

  /**
   * Um socket aberto não prova nada: ao perder a rede, ele continua "aberto" por
   * minutos. Conectado é o backend ter respondido há pouco.
   */
  private iniciarPulso(socket: SocketDoCanal) {
    this.devendoPong = false
    this.pulso = setInterval(() => {
      if (this.devendoPong) return this.cair(socket, false)
      this.devendoPong = true
      this.pingEm = Date.now()
      socket.send('{"type":"ping"}')
    }, this.pulsoMs)
  }

  private cair(socket: SocketDoCanal, recusado: boolean) {
    if (this.socket !== socket) return
    this.socket = null
    if (this.conectadoEm) {
      const motivo = recusado ? 'recusado' : this.devendoPong ? 'sem_pong' : 'socket_fechou'
      this.eventos.aoMedir?.('canal_caiu', Date.now() - this.conectadoEm, motivo)
      this.conectadoEm = 0
    }
    this.pararPulso()
    socket.onclose = null
    socket.onerror = null
    socket.onmessage = null
    socket.close()
    if (this.pendente) {
      this.pendente = null
      this.eventos.aoFalhar('A conexão caiu e a tarefa foi interrompida.')
    }
    if (recusado) return this.mudar('recusado')
    this.mudar('conectando')
    this.retorno = setTimeout(() => {
      this.retorno = null
      this.abrir()
    }, this.espera)
    this.espera = Math.min(this.espera * 2, ESPERA_MAXIMA_MS)
  }

  private mudar(estado: EstadoDoCanal) {
    if (estado === this.estado) return
    this.estado = estado
    this.eventos.aoMudarEstado(estado)
  }

  private abrir() {
    if (!this.par) return
    this.mudar('conectando')
    this.abertoEm = Date.now()
    let recusado = false
    const socket = this.criarSocket(this.par)
    this.socket = socket

    socket.onopen = () => {
      this.espera = ESPERA_MINIMA_MS
      this.iniciarPulso(socket)
    }
    socket.onmessage = ({ data }) => this.receber(data)
    socket.onerror = ({ message }) => {
      // O aperto de mão é o único lugar em que o gateway diz por que recusou.
      if (message && /\b401\b/.test(message)) recusado = true
    }
    socket.onclose = () => this.cair(socket, recusado)
  }

  private receber(dados: unknown) {
    let quadro: Quadro
    try {
      quadro = JSON.parse(String(dados)) as Quadro
    } catch {
      return
    }
    if (quadro.type === 'pong') {
      this.devendoPong = false
      this.eventos.aoMedir?.('ping', Date.now() - this.pingEm)
      return
    }
    if (quadro.type === 'midia' && quadro.chave && this.par) {
      // A primeira mensagem do gateway: daqui em diante o backend está respondendo.
      this.conectadoEm = Date.now()
      this.eventos.aoMedir?.('canal_conectou', this.conectadoEm - this.abertoEm)
      this.mudar('conectado')
      return this.eventos.aoMidia(baseDeMidia(this.par.url, quadro.chave))
    }
    if (quadro.type && TIPOS_DO_CORE.has(quadro.type)) {
      return this.eventos.aoCore?.(quadro as Record<string, unknown>)
    }
    if (quadro.type === 'extensao' && quadro.extensao) {
      return this.eventos.aoExtensao?.(quadro.extensao, quadro.dados)
    }
    if (quadro.type === 'voz_sessao' && quadro.id) {
      const pedidoEm = this.credenciaisEm.get(quadro.id)
      this.credenciaisEm.delete(quadro.id)
      if (pedidoEm) {
        this.eventos.aoMedir?.('credencial', Date.now() - pedidoEm, quadro.erro ? 'erro' : undefined)
      }
      return this.eventos.aoCredencial(quadro.id, quadro.sessao, quadro.erro)
    }
    // Painéis e popups não têm dono: um pedido cancelado já os mostrou por inteiro.
    if (quadro.type === 'panel' && quadro.panel) return this.eventos.aoPainel(quadro.panel)
    if (quadro.type === 'blade' && quadro.blade) return this.eventos.aoPopup(quadro.blade)

    // `error` de sessão vem sem `ask`: vale para o que estiver em andamento.
    const meu = quadro.ask === this.pendente || (quadro.type === 'error' && quadro.ask == null)
    if (!this.pendente || !meu) return

    if (quadro.type === 'text' && quadro.delta) {
      if (!this.textoDaTarefa) {
        this.textoDaTarefa = true
        this.eventos.aoMedir?.('tarefa_primeiro_texto', Date.now() - this.tarefaEm)
      }
      this.eventos.aoTexto(quadro.delta)
    }
    if (quadro.type === 'tool' && quadro.name) this.eventos.aoFerramenta(quadro.name)
    if (quadro.type === 'done') {
      this.pendente = null
      this.eventos.aoMedir?.('tarefa', Date.now() - this.tarefaEm)
      this.eventos.aoTerminar(quadro.text ?? '')
    }
    if (quadro.type === 'error') {
      this.pendente = null
      this.eventos.aoMedir?.('tarefa', Date.now() - this.tarefaEm, 'erro')
      this.eventos.aoFalhar(quadro.message ?? 'A tarefa falhou.')
    }
  }
}
