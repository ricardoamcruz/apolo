import * as THREE from 'three'
import { BRIDGE_HTTP_URL } from '../config'
import { accentFor, atividadeAtual, faseNaTela, useStore } from '../store'
import { RAIO_RELATIVO } from '../scene/Enxame'
import { FIT_DO_NUCLEO } from '../scene/Core'
import { contrastante, corEmHex, terceira } from './cor'
import { ouviuFala } from './autodev'
import { pedeLocalizacao } from './comandos'

/**
 * Extensões plugáveis, o lado da interface (docs/adr/0033).
 *
 * A ponte lê `extensoes/<id>/apolo.extensao.json` e avisa a lista; aqui o módulo
 * de cada uma é baixado da ponte e importado em tempo de execução, sem passar pelo
 * build. Trocar a pasta troca a extensão: a ponte avisa, esta desliga a antiga e
 * liga a nova.
 *
 * O módulo exporta `ativar(apolo)` e, se quiser, devolve uma função de desligar. Tudo
 * o que ele pode fazer com o A.P.O.L.O. está em `ApiDaExtensao`, e só isso: a API é o
 * contrato, e uma extensão que mexa em outra coisa quebra na próxima versão. O que
 * ela registra (ferramentas, ouvintes, a camada na tela) sai junto ao desligar.
 *
 * Importado como blob, porque a política de segurança da página só aceita script
 * da própria origem ou de `blob:`. Isso também quer dizer que o módulo é um arquivo
 * só: um `import` relativo dentro dele não teria de onde vir. O resto (dados,
 * imagens) ele pede por `apolo.arquivo()`.
 */

export const CONTRATO = '1'

/** Até onde olhar para trás ao conferir que ele mesmo pediu a localização. */
const JANELA_DO_PEDIDO_MS = 20_000

export type ExtensaoNaPonte =
  | {
      id: string
      nome: string
      ok: true
      versao: string
      interface: string
      icone: string | null
      assinatura: string
      ferramentas: string[]
    }
  | { id: string; nome: string; ok: false; motivo: string }

export type ResultadoDeFerramenta = string | { output: string; silent?: boolean }
type Ferramenta = (args: Record<string, unknown>) => ResultadoDeFerramenta | Promise<ResultadoDeFerramenta>
type Evento = 'espera' | 'limpar'

export type ApiDaExtensao = {
  contrato: string
  id: string
  /** O three.js do A.P.O.L.O.: o mesmo, para não carregar outro. */
  THREE: typeof THREE
  /** O endereço de um arquivo da pasta da extensão. */
  arquivo: (nome: string) => string
  /** Trata uma ferramenta declarada no manifesto. Devolve o texto que a voz recebe. */
  ferramenta: (nome: string, tratar: Ferramenta) => void
  /** Uma camada que cobre a tela, entre a cena e o HUD. Começa sem receber toques. */
  camada: () => HTMLElement
  cor: {
    /** A cor da interface agora (por fase, atividade ou pedido), em hexadecimal. */
    interface: () => string
    /** A cor de contraste com a da interface, a mesma do alerta. */
    contrastante: (hex?: string) => string
    /** A terceira cor, distante das outras duas (a da localização dele no mapa). */
    terceira: (hex?: string) => string
    /** Chamado a cada troca de cor. Devolve como parar. */
    ouvir: (aoMudar: (interfaceHex: string, contrasteHex: string, terceiraHex: string) => void) => () => void
  }
  /**
   * A localização dele, do navegador. Só se a fala dele pediu nos últimos segundos
   * (conferido na transcrição, como a câmera); senão, rejeita com o motivo. Fica na
   * tela: a extensão não deve mandá-la a lugar nenhum, nem na resposta à voz.
   */
  localizacao: () => Promise<{ lat: number; lon: number; precisao: number }>
  nucleo: {
    /** Onde o núcleo está na tela, em pixels da janela. */
    geometria: () => { x: number; y: number; raio: number }
    /** Pede o núcleo emprestado: o Enxame se apaga em cerca de meio segundo. */
    ceder: () => void
    /** Devolve o núcleo: o Enxame volta. */
    devolver: () => void
  }
  /** "espera": ele pôs o A.P.O.L.O. em espera. "limpar": mandou limpar a tela. */
  ao: (evento: Evento, fazer: () => void) => () => void
  /** Uma frase sobre o que a extensão mostra agora, para a voz saber (ou vazio). */
  descreverTela: (descrever: () => string) => void
  log: (...partes: unknown[]) => void
}

type Ativa = {
  info: Extract<ExtensaoNaPonte, { ok: true }>
  limpar: Array<() => void>
  desligar?: () => void
}

type Estado = { id: string; nome: string; ok: boolean; motivo?: string; icone?: string }

const ativas = new Map<string, Ativa>()
const ferramentas = new Map<string, { extensao: string; tratar: Ferramenta }>()
const descricoes = new Map<string, () => string>()
const estados = new Map<string, Estado>()
const ouvintesDoEstado = new Set<() => void>()
let fila: Promise<void> = Promise.resolve()

const avisarEstado = () => ouvintesDoEstado.forEach((f) => f())

/** O que a aba SISTEMAS mostra das extensões. */
export const estadoDasExtensoes = (): Estado[] => [...estados.values()]
export function ouvirEstadoDasExtensoes(fn: () => void) {
  ouvintesDoEstado.add(fn)
  return () => void ouvintesDoEstado.delete(fn)
}

/** A ferramenta de uma extensão, se houver uma com esse nome. */
export async function chamarFerramentaDeExtensao(nome: string, args: Record<string, unknown>) {
  const f = ferramentas.get(nome)
  if (!f) return null
  try {
    const r = await f.tratar(args)
    return typeof r === 'string' ? { output: r } : r
  } catch (err) {
    console.error(`[extensões] ${f.extensao}: a ferramenta ${nome} falhou`, err)
    return { output: `A extensão falhou: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/** O que as extensões mostram agora, numa frase cada. */
export function telaDasExtensoes(): string {
  return [...descricoes.values()]
    .map((d) => {
      try {
        return d().trim()
      } catch {
        return ''
      }
    })
    .filter(Boolean)
    .join(' ')
}

/** O store muda a cada quadro (o nível do microfone): só converte quando a cor muda. */
let cssAntes = ''
let hexAntes = ''
/**
 * O raio do Enxame na tela, em pixels. O plano z = 0 da câmera ocupa a tela inteira,
 * então é a mesma conta do raio em unidades do mundo (src/scene/Enxame.tsx).
 */
const raioDoEnxameNaTela = (largura: number, altura: number, escala: number) =>
  FIT_DO_NUCLEO * 0.5 * Math.min(largura, altura) * RAIO_RELATIVO * escala

const corAgora = () => {
  const s = useStore.getState()
  const fase = faseNaTela(s)
  const css = accentFor(fase, s.ui, atividadeAtual({ ...s, phase: fase }))
  if (css !== cssAntes) {
    cssAntes = css
    hexAntes = corEmHex(css)
  }
  return hexAntes
}

let raizDasCamadas: HTMLElement | null = null
function camadaNova(id: string) {
  if (!raizDasCamadas) {
    raizDasCamadas = document.createElement('div')
    raizDasCamadas.className = 'extensoes'
    document.body.append(raizDasCamadas)
  }
  const el = document.createElement('div')
  el.className = 'extensao-camada'
  el.dataset.extensao = id
  raizDasCamadas.append(el)
  return el
}

function criarApi(a: Ativa): ApiDaExtensao {
  const { id } = a.info
  const limpar = (f: () => void) => a.limpar.push(f)
  return {
    contrato: CONTRATO,
    id,
    THREE,
    arquivo: (nome) =>
      `${BRIDGE_HTTP_URL}/extensoes/${id}/${String(nome).split('/').map(encodeURIComponent).join('/')}?v=${a.info.assinatura}`,
    ferramenta: (nome, tratar) => {
      if (!a.info.ferramentas.includes(nome)) {
        throw new Error(`a ferramenta ${nome} não está no manifesto de ${id}`)
      }
      ferramentas.set(nome, { extensao: id, tratar })
      limpar(() => {
        if (ferramentas.get(nome)?.extensao === id) ferramentas.delete(nome)
      })
    },
    camada: () => {
      const el = camadaNova(id)
      limpar(() => el.remove())
      return el
    },
    cor: {
      interface: corAgora,
      contrastante: (hex) => contrastante(hex ?? corAgora()),
      terceira: (hex) => terceira(hex ?? corAgora()),
      ouvir: (aoMudar) => {
        let antes = ''
        const conferir = () => {
          const agora = corAgora()
          if (agora === antes) return
          antes = agora
          aoMudar(agora, contrastante(agora), terceira(agora))
        }
        conferir()
        const parar = useStore.subscribe(conferir)
        limpar(parar)
        return parar
      },
    },
    nucleo: {
      geometria: () => ({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
        raio: raioDoEnxameNaTela(window.innerWidth, window.innerHeight, useStore.getState().ui.reactor.scale),
      }),
      ceder: () => useStore.getState().cederNucleo(id),
      devolver: () => {
        if (useStore.getState().nucleoCedido === id) useStore.getState().cederNucleo(null)
      },
    },
    localizacao: async () => {
      if (!(await ouviuFala(pedeLocalizacao, Date.now() - JANELA_DO_PEDIDO_MS))) {
        throw new Error('O pedido da localização não foi ouvido do Ricardo. Nada foi lido.')
      }
      if (!navigator.geolocation) throw new Error('Este navegador não dá a localização.')
      return new Promise((pronto, falhou) =>
        navigator.geolocation.getCurrentPosition(
          (p) => pronto({ lat: p.coords.latitude, lon: p.coords.longitude, precisao: p.coords.accuracy }),
          (err) =>
            falhou(
              new Error(
                err.code === err.PERMISSION_DENIED
                  ? 'O acesso à localização não foi permitido nesta janela.'
                  : 'Não consegui a localização agora.',
              ),
            ),
          { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
        ),
      )
    },
    ao: (evento, fazer) => {
      const parar = useStore.subscribe((s, antes) => {
        if (evento === 'limpar' && s.limpezas !== antes.limpezas) fazer()
        if (evento === 'espera' && s.esperaPedida && !antes.esperaPedida) fazer()
      })
      limpar(parar)
      return parar
    },
    descreverTela: (descrever) => {
      descricoes.set(id, descrever)
      limpar(() => descricoes.delete(id))
    },
    log: (...partes) => console.log(`[${id}]`, ...partes),
  }
}

function desativar(id: string) {
  const a = ativas.get(id)
  if (!a) return
  ativas.delete(id)
  try {
    a.desligar?.()
  } catch (err) {
    console.error(`[extensões] ${id}: erro ao desligar`, err)
  }
  for (const f of a.limpar.splice(0).reverse()) {
    try {
      f()
    } catch {
      /* o que falhar ao sair não impede o resto de sair */
    }
  }
  if (useStore.getState().nucleoCedido === id) useStore.getState().cederNucleo(null)
}

async function ativar(info: Extract<ExtensaoNaPonte, { ok: true }>) {
  const a: Ativa = { info, limpar: [] }
  const url = `${BRIDGE_HTTP_URL}/extensoes/${info.id}/${encodeURIComponent(info.interface)}?v=${info.assinatura}`
  const resposta = await fetch(url, { cache: 'no-store' })
  if (!resposta.ok) throw new Error(`a ponte não entregou ${info.interface} (${resposta.status})`)
  const blob = URL.createObjectURL(new Blob([await resposta.text()], { type: 'text/javascript' }))
  try {
    const modulo = await import(/* @vite-ignore */ blob)
    if (typeof modulo.ativar !== 'function') throw new Error(`${info.interface} não exporta ativar()`)
    ativas.set(info.id, a)
    const desligar = await modulo.ativar(criarApi(a))
    if (typeof desligar === 'function') a.desligar = desligar
  } catch (err) {
    desativar(info.id)
    throw err
  } finally {
    URL.revokeObjectURL(blob)
  }
}

/**
 * A lista nova da ponte. Liga o que entrou, desliga o que saiu e troca o que mudou
 * de assinatura. Em fila: duas listas seguidas não ligam a mesma extensão duas vezes.
 */
export function aplicarExtensoes(lista: ExtensaoNaPonte[]) {
  fila = fila.then(async () => {
    const novas = new Map(lista.map((e) => [e.id, e]))
    for (const [id, a] of ativas) {
      const nova = novas.get(id)
      if (!nova || !nova.ok || nova.assinatura !== a.info.assinatura) desativar(id)
    }
    estados.clear()
    for (const e of lista) {
      if (!e.ok) {
        estados.set(e.id, { id: e.id, nome: e.nome, ok: false, motivo: e.motivo })
        continue
      }
      if (!ativas.has(e.id)) {
        try {
          await ativar(e)
        } catch (err) {
          console.error(`[extensões] ${e.id} não ligou`, err)
          estados.set(e.id, { id: e.id, nome: e.nome, ok: false, motivo: err instanceof Error ? err.message : String(err) })
          continue
        }
      }
      const icone = e.icone ? `${BRIDGE_HTTP_URL}/extensoes/${e.id}/${encodeURIComponent(e.icone)}?v=${e.assinatura}` : undefined
      estados.set(e.id, { id: e.id, nome: e.nome, ok: true, icone })
    }
    avisarEstado()
  })
  return fila
}
