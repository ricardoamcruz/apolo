import { soltarMic } from '../audio'
import { chamouPeloNome } from '../chamada'
import { criarJanela } from '../conversa'
import { vigiarCancelamento } from '../comandos'
import type { AcaoDePopup } from '../comandosDePopup'
import { foraDeHora, ouviuConfirmacao, registrarFala, type AutodevEstado } from '../autodev'
import { lerParametros, textoDaFenix } from '../fenix'
import { connectGemini } from './gemini'
import type { RealtimeSession, SessionGrant, ToolResult } from './types'

/**
 * A voz do browser, comandada pelo app do iPhone (docs/adr/0019).
 *
 * O cliente é o mesmo `connectGemini`. O que muda é tudo o que no PC passa pela
 * ponte: aqui a página não tem o token, então a credencial e as tarefas pedem ao
 * app, que fala com o gateway. Popups continuam sendo o que o agente abrir.
 *
 * O desenvolvimento e a F.Ê.N.I.X. funcionam como no PC (docs/adr/0030): os
 * pedidos vão ao core pelo app (`core`), e o estado volta por `doCore`. Quem
 * confirma, aprova ou abre o PR é a fala do Ricardo, conferida aqui contra a
 * transcrição do microfone do celular, e não contra o que o modelo afirma.
 */

export type FaseDaVoz = 'desligada' | 'espera' | 'ouvindo' | 'pensando' | 'ferramenta' | 'falando'

export type MensagemDaVoz =
  | { fase: FaseDaVoz }
  | { nivel: number }
  /** O que ele está entendendo. `fim` marca a frase completa. */
  | { ouviu: string; fim?: boolean }
  | { medida: { nome: string; ms?: number; info?: string } }
  | { aviso: string }
  | { credencial: string }
  | { tarefa: string; pedido: string }
  /** Ele mandou cancelar a tarefa em andamento. */
  | { cancelar: true }
  /** Um pedido ao core (autodesenvolvimento ou Fênix); a resposta volta por `doCore`. */
  | { core: PedidoAoCore }

/** O que a voz pede ao core, como a interface do PC pede à ponte. */
export type PedidoAoCore = { id: string; tipo: 'autodev' | 'fenix'; acao: string } & Record<string, unknown>
/** O que o core manda de volta: a resposta de um pedido (`resposta`) ou o estado. */
export type MensagemDoCore = {
  type?: string
  resposta?: string
  ok?: boolean
  mensagem?: string
  saida?: string
  proposta?: PropostaDaFenix
  estado?: unknown
}
type PropostaDaFenix = { id: string; script: string; motivo: string }
type RespostaDoCore = { ok: boolean; mensagem: string; saida?: string; proposta?: PropostaDaFenix }

type Grant = Extract<SessionGrant, { provider: 'gemini' }>

/** Uma fala ouvida há menos que isto conta como alguém falando agora. */
const FALA_RECENTE_MS = 2_000
const INTERVALO_DO_NIVEL_MS = 80
const PRAZO_DA_DESPEDIDA_MS = 2_500
/** A ponte pede a credencial ao Google, então pode demorar, mas não para sempre. */
const PRAZO_DA_CREDENCIAL_MS = 20_000
/** Nível do microfone que conta como você falando, para medir a resposta. */
const NIVEL_DE_FALA = 0.3

export function criarVozDoCelular(
  enviar: (mensagem: MensagemDaVoz) => void,
  /** Fecha os popups e diz quantos saíram: a voz precisa saber se havia algum. */
  fecharPopups: () => number,
  comandarPopup: (acao: AcaoDePopup, titulo?: string) => string,
) {
  let sessao: RealtimeSession | null = null
  let abrindo = false
  let emEspera = false
  let falando = false
  /** Quando o microfone ouviu fala pela última vez, de quem for. */
  let ultimoSom = 0
  let nivel: ReturnType<typeof setInterval> | null = null
  let pedidos = 0
  /** Momentos de fala medidos aqui, porque o Google só avisa depois de processar. */
  let inicioDaFala = 0
  let ultimaFala = 0
  let transcreveu = false
  const credenciais = new Map<string, { resolve: (g: Grant) => void; reject: (e: Error) => void }>()
  const tarefas = new Map<string, (texto: string) => void>()
  /** Pedidos ao core esperando resposta. Enquanto houver um, a conversa não fecha. */
  const pedidosAoCore = new Map<string, (r: RespostaDoCore) => void>()
  let autodevEstado: AutodevEstado | null = null
  /** `vistaEm`: quando a proposta chegou aqui; só uma fala depois disso confirma. */
  let propostas: (PropostaDaFenix & { vistaEm: number })[] = []
  const vigia = vigiarCancelamento(() => {
    if (tarefas.size) enviar({ cancelar: true })
  })

  const fase = (nova: FaseDaVoz) => enviar({ fase: nova })
  const medir = (nome: string, ms?: number, info?: string) => enviar({ medida: { nome, ms, info } })

  const acompanharMic = () => {
    const nivelDoMic = sessao?.nivelDoMic?.() ?? 0
    if (nivelDoMic < NIVEL_DE_FALA) return nivelDoMic
    const agora = Date.now()
    ultimoSom = agora
    // Um silêncio de mais de 2 s separa uma fala da outra.
    if (agora - ultimaFala > 2_000) {
      inicioDaFala = agora
      transcreveu = false
    }
    ultimaFala = agora
    return nivelDoMic
  }

  // Sem nada dirigido a ele por 20 s, ele volta à espera (docs/adr/0024).
  const janela = criarJanela(
    () => dormir(),
    () => {
      if (falando || tarefas.size || pedidosAoCore.size) return 'sim'
      return Date.now() - ultimoSom < FALA_RECENTE_MS ? 'talvez' : 'nao'
    },
  )
  const limparOcioso = () => janela.pausar()
  const armarOcioso = () => janela.abrir()

  /**
   * Em espera o microfone segue aberto, mas nada dele toca até ouvir o nome: no
   * celular não há reconhecedor do navegador para isso (docs/adr/0024).
   */
  function dormir() {
    limparOcioso()
    emEspera = true
    sessao?.interrupt()
    sessao?.silenciar?.(true)
    fase('espera')
  }

  const sairDaEspera = () => {
    emEspera = false
    sessao?.silenciar?.(false)
    fase('ouvindo')
    armarOcioso()
  }

  const acordar = () => {
    sairDaEspera()
    sessao?.prompt('O Ricardo tocou na tela e você saiu da espera. Diga em poucas palavras que está ouvindo.')
  }

  const pedirCredencial = () =>
    new Promise<Grant>((resolve, reject) => {
      const id = `v${++pedidos}`
      const prazo = setTimeout(() => {
        credenciais.delete(id)
        reject(new Error('O computador não liberou a voz. Reinicie o npm start e toque na tela.'))
      }, PRAZO_DA_CREDENCIAL_MS)
      credenciais.set(id, {
        resolve: (g) => {
          clearTimeout(prazo)
          resolve(g)
        },
        reject: (e) => {
          clearTimeout(prazo)
          reject(e)
        },
      })
      enviar({ credencial: id })
    })

  const executar = (pedido: string) =>
    new Promise<string>((resolve) => {
      const id = `t${++pedidos}`
      tarefas.set(id, resolve)
      enviar({ tarefa: id, pedido })
    })

  /** Um pedido ao core. Nunca rejeita: sem resposta no prazo, `ok: false`. */
  const pedirAoCore = (tipo: PedidoAoCore['tipo'], acao: string, extra: Record<string, unknown> = {}, prazoMs = 20_000) =>
    new Promise<RespostaDoCore>((resolve) => {
      const id = `${tipo === 'autodev' ? 'd' : 'f'}${++pedidos}`
      const prazo = setTimeout(() => {
        pedidosAoCore.delete(id)
        resolve({ ok: false, mensagem: 'O computador não respondeu a tempo.' })
      }, prazoMs)
      pedidosAoCore.set(id, (r) => {
        clearTimeout(prazo)
        resolve(r)
      })
      enviar({ core: { id, tipo, acao, ...extra } })
    })

  /** Enquanto o core trabalha, a fase mostra que há algo rodando. */
  const comCoreTrabalhando = async <T,>(pedir: () => Promise<T>) => {
    fase('ferramenta')
    try {
      return await pedir()
    } finally {
      fase('pensando')
      armarOcioso()
    }
  }

  /** As mesmas regras do PC (src/App.tsx), sem os botões: aqui só a fala confirma. */
  const desenvolvimento = async (args: Record<string, unknown>): Promise<ToolResult> => {
    const acao = String(args.acao ?? '')
    armarOcioso()
    // Abrir o PR manda código para fora: também exige o sim falado dele.
    if (acao === 'pull_request' && !(await ouviuConfirmacao(Date.now() - 60_000))) {
      return {
        output:
          'O sim do Ricardo não foi ouvido. Pergunte uma vez se ele quer abrir o pull request; ' +
          'se ele disser que sim, chame de novo. Nada foi enviado.',
      }
    }
    if (acao === 'confirmar' || acao === 'aprovar') {
      const impedimento = foraDeHora(acao, autodevEstado)
      if (impedimento) return { output: impedimento.replace(', então também não há botão na tela', '') }
      const desde = acao === 'aprovar' ? autodevEstado?.testeDesde : autodevEstado?.criadoEm
      if (!(await ouviuConfirmacao(desde ?? Date.now()))) {
        return {
          output:
            `A confirmação não foi ouvida do Ricardo. Peça uma vez que ele diga "${acao === 'aprovar' ? 'aprovo' : 'confirmo'}". ` +
            'Se ele pedir outra coisa, atenda. Nada foi feito.',
        }
      }
    }
    const tarefa = typeof args.tarefa === 'string' && args.tarefa.trim() ? { tarefa: args.tarefa.trim() } : {}
    const r = await comCoreTrabalhando(() => pedirAoCore('autodev', acao, { pedido: String(args.pedido ?? ''), ...tarefa }))
    return { output: r.mensagem }
  }

  const fenix = async (args: Record<string, unknown>): Promise<ToolResult> => {
    const acao = String(args.acao ?? '')
    armarOcioso()
    // Como no desenvolvimento: quem confirma um script é a fala do Ricardo.
    if (acao === 'confirmar' || acao === 'cancelar') {
      const proposta = propostas.at(-1)
      if (!proposta) return { output: 'Não há comando da Fênix esperando confirmação.' }
      if (acao === 'confirmar' && !(await ouviuConfirmacao(proposta.vistaEm))) {
        return {
          output: 'A confirmação não foi ouvida do Ricardo. Peça uma vez que ele diga "confirmo". Nada foi rodado.',
        }
      }
      const r = await comCoreTrabalhando(() => pedirAoCore('fenix', acao, { proposta: proposta.id }, 6 * 60_000))
      return { output: textoDaFenix(r) }
    }
    const extra = {
      nome: String(args.nome ?? ''),
      parametros: lerParametros(String(args.parametros ?? '')),
      script: String(args.script ?? ''),
      motivo: String(args.motivo ?? ''),
    }
    if (acao === 'comando') {
      const r = await pedirAoCore('fenix', 'comando', extra)
      if (!r.ok || !r.proposta) return { output: r.mensagem }
      // A proposta vale a partir de agora, mesmo que o estado chegue depois.
      if (!propostas.some((p) => p.id === r.proposta?.id)) propostas = [...propostas, { ...r.proposta, vistaEm: Date.now() }]
      return {
        output:
          `Proposta registrada, ainda sem rodar: ${r.proposta.script}\n` +
          'Diga em uma frase o que o script faz e pergunte se ele confirma. No celular não há botão: ele confirma falando.',
      }
    }
    if (acao === 'rotina') {
      return { output: textoDaFenix(await comCoreTrabalhando(() => pedirAoCore('fenix', 'rotina', extra, 50 * 60_000))) }
    }
    return { output: textoDaFenix(await pedirAoCore('fenix', acao, extra)) }
  }

  const usarFerramenta = async (
    nome: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> => {
    // Em espera, nada do que ele decidir vale: a fala não trouxe o nome.
    if (emEspera) return { output: 'Ignorado.', silent: true, descartar: true }
    if (nome !== 'ignorar_fala') limparOcioso()
    if (nome === 'executar_tarefa') {
      const pedido = String(args.pedido ?? '').trim()
      if (!pedido) return { output: 'Pedido vazio.' }
      fase('ferramenta')
      const texto = await executar(pedido)
      vigia.parar()
      fase('pensando')
      armarOcioso()
      return { output: texto || 'Tarefa concluída, sem nada a relatar.' }
    }
    if (nome === 'desenvolvimento') return desenvolvimento(args)
    if (nome === 'fenix') return fenix(args)
    if (nome === 'ajustar_interface') {
      armarOcioso()
      if (typeof args.popups === 'string') {
        const titulo = typeof args.popup === 'string' ? args.popup : undefined
        return { output: comandarPopup(args.popups as AcaoDePopup, titulo) }
      }
      if (!args.limpar_tela) return { output: 'Aqui só dá para mexer nos popups.' }
      const fechados = fecharPopups()
      if (!fechados) return { output: 'A tela já estava limpa.' }
      return { output: fechados === 1 ? 'Feito: um popup fechado.' : `Feito: ${fechados} popups fechados.` }
    }
    if (nome === 'dormir') {
      // Deixa a despedida terminar de tocar antes de fechar o microfone.
      setTimeout(dormir, PRAZO_DA_DESPEDIDA_MS)
      return { output: 'Em espera.', silent: true }
    }
    if (nome === 'ignorar_fala') {
      fase('ouvindo')
      janela.garantir()
      return { output: 'Ignorado.', silent: true, descartar: true }
    }
    return { output: `Isto só funciona no computador: ${nome}.` }
  }

  const encerrar = () => {
    limparOcioso()
    if (nivel) clearInterval(nivel)
    nivel = null
    falando = false
    const aberta = sessao
    sessao = null
    aberta?.close()
    soltarMic()
  }

  const ligar = async () => {
    if (sessao || abrindo) return
    abrindo = true
    const inicio = Date.now()
    try {
      const primeira = await pedirCredencial()
      sessao = await connectGemini(primeira, pedirCredencial, {
        onSpeechStart: () => {
          if (!emEspera) fase('ouvindo')
        },
        onSpeechStop: () => {
          if (!emEspera) fase('pensando')
        },
        onUserPartial: (texto) => {
          // Em espera, o que ele ouve da sala não vai para a tela.
          if (emEspera) return
          if (!transcreveu && inicioDaFala) {
            transcreveu = true
            medir('voz_transcricao', Date.now() - inicioDaFala)
          }
          enviar({ ouviu: texto })
          // A transcrição é o que confere o "confirmo": nunca o que o modelo diz.
          registrarFala(texto)
          if (tarefas.size) vigia.ouvir(texto)
        },
        onUserText: (texto) => {
          // Chega antes do áudio da resposta: acordar aqui deixa a resposta ao chamado tocar.
          if (emEspera && chamouPeloNome(texto).chamou) sairDaEspera()
          if (!emEspera) {
            registrarFala(texto)
            enviar({ ouviu: texto, fim: true })
          }
        },
        onAssistantStart: () => {},
        onAssistantDelta: () => {},
        onSpeakingStart: () => {
          falando = true
          if (ultimaFala) medir('voz_resposta', Date.now() - ultimaFala)
          ultimaFala = 0
          fase('falando')
        },
        onSpeakingStop: () => {
          falando = false
          if (emEspera) return
          fase('ouvindo')
          armarOcioso()
        },
        onToolCall: usarFerramenta,
        onError: (mensagem) => {
          medir('voz_erro')
          enviar({ aviso: mensagem })
        },
        onClosed: () => {
          medir('voz_caiu')
          if (sessao) encerrar()
          fase('desligada')
        },
      })
      // Falando, o círculo segue a voz dele; no resto do tempo, a sua. É isso que mostra
      // que ele está ouvindo, como no PC. Em silêncio não manda nada: o círculo decai.
      nivel = setInterval(() => {
        const valor = falando ? (sessao?.level() ?? 0) : acompanharMic()
        if (valor > 0.02) enviar({ nivel: valor })
      }, INTERVALO_DO_NIVEL_MS)
      medir('voz_abriu', Date.now() - inicio)
      emEspera = false
      fase('ouvindo')
      armarOcioso()
    } catch (err) {
      soltarMic()
      enviar({ aviso: err instanceof Error ? err.message : String(err) })
      fase('desligada')
    } finally {
      abrindo = false
    }
  }

  return {
    /** Pode ser chamado de novo a qualquer hora: ao voltar ao app, religa o que caiu. */
    ligar: () => {
      sessao?.retomar?.()
      return ligar()
    },
    desligar: () => {
      encerrar()
      for (const concluir of tarefas.values()) concluir('A conexão com o computador caiu.')
      tarefas.clear()
      for (const concluir of pedidosAoCore.values()) concluir({ ok: false, mensagem: 'A conexão com o computador caiu.' })
      pedidosAoCore.clear()
      fase('desligada')
    },
    /** Um toque fora dos popups: interrompe a fala, acorda ou tenta de novo. */
    tocar: () => {
      sessao?.retomar?.()
      if (!sessao) return void ligar()
      if (emEspera) return acordar()
      if (falando) sessao.interrupt()
    },
    credencial: (id: string, grant?: SessionGrant, erro?: string) => {
      const pedido = credenciais.get(id)
      credenciais.delete(id)
      if (grant?.provider === 'gemini') pedido?.resolve(grant)
      else pedido?.reject(new Error(erro ?? 'O computador não liberou a voz.'))
    },
    fimDaTarefa: (id: string, texto: string) => {
      tarefas.get(id)?.(texto)
      tarefas.delete(id)
    },
    /** O que o core mandou: a resposta de um pedido, ou o estado do autodev e da Fênix. */
    doCore: (msg: MensagemDoCore) => {
      if (!msg || typeof msg !== 'object') return
      if (typeof msg.resposta === 'string') {
        const concluir = pedidosAoCore.get(msg.resposta)
        pedidosAoCore.delete(msg.resposta)
        concluir?.({
          ok: msg.ok === true,
          mensagem: msg.mensagem ?? (msg.ok ? 'Feito.' : 'O computador não disse o motivo.'),
          saida: msg.saida,
          proposta: msg.proposta,
        })
        return
      }
      if (msg.type === 'autodev' && msg.estado) autodevEstado = msg.estado as AutodevEstado
      if (msg.type === 'fenix' && msg.estado) {
        const vistas = new Map(propostas.map((p) => [p.id, p.vistaEm]))
        const novas = (msg.estado as { propostas?: PropostaDaFenix[] }).propostas ?? []
        propostas = novas.map((p) => ({ ...p, vistaEm: vistas.get(p.id) ?? Date.now() }))
      }
    },
  }
}
