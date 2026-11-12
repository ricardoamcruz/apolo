import { atividadeDaFerramenta } from './lib/estados'
import { useEffect, useRef } from 'react'
import { Scene } from './scene/Scene'
import { Hud } from './ui/Hud'
import { Diagnostics } from './ui/Diagnostics'
import { useStore } from './store'
import * as sfx from './lib/sfx'
import * as music from './lib/music'
import * as hands from './lib/hands'
import { listenForClap } from './lib/clap'
import * as camera from './lib/camera'
import {
  ask,
  cancel as cancelTask,
  warmBridge,
  salvarPreferencias,
  watchPreferencias,
  watchServers,
  watchPanels,
  watchBlades,
  watchCapture,
  watchBrowser,
  watchUi,
  watchConnection,
  watchAutodev,
  watchFenix,
  autodev,
  fenix,
  bomDia,
  bridgeServers,
  type FenixResposta,
} from './lib/bridge'
import { connectRealtime, type RealtimeSession, type ToolResult } from './lib/realtime'
import { startAnalyser, micLevel, retomarAnalyser } from './lib/audio'
import { foraDeHora, ouviuConfirmacao, ouviuFala, registrarFala } from './lib/autodev'
import { agradece, pedeModoMaos, vigiarCancelamento } from './lib/comandos'
import { INTERVALO_DOS_POPUPS_MS, PREFIXO_DO_BOM_DIA, descreverPopups, popupsDoBomDia } from './lib/bomDia'
import { criarJanela } from './lib/conversa'
import { comandarPopup, type AcaoDePopup } from './lib/comandosDePopup'
import { abrirNoYoutube } from './lib/musica'
import { chamadaDisponivel, deuBomDia, ouvirNome } from './lib/chamada'
import { sistemasAgora } from './lib/estadoDosSistemas'
import { resumoSistemas } from './lib/sistemas'
import { handleBrowser } from './lib/navegador'

/**
 * A conversa, agora em speech-to-speech (docs/adr/0009).
 *
 * Antes eram três etapas em fila — reconhecer a fala, mandar o texto ao Claude,
 * sintetizar a resposta — e cada uma esperava a anterior terminar. Agora um
 * único modelo de voz em tempo real ouve e responde direto em áudio. Este
 * componente só traduz os eventos dessa sessão em fases da interface e executa
 * as ferramentas que o modelo chama.
 *
 * O que exige agir no mundo (internet, e-mail, navegador, painéis) continua com
 * o Claude, na ponte local: a voz chama `executar_tarefa` e fala o resultado.
 */

/** O Chrome só deixa tocar som depois de um gesto na página, salvo exceções. */

/** Uma fala ouvida há menos que isto conta como alguém falando agora. */
const FALA_RECENTE_MS = 2_000

const newId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `id${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

/** `mcp__apolo_navegador__chrome_open` -> `navegador · chrome open` */
const prettyTool = (raw: string) => raw.replace(/_/g, ' ')

/**
 * O que a voz pede em `limpar_tela` e o que isso significa na tela (RF-16).
 *
 * "Limpe a bagunça" é um pedido sobre os popups, não sobre a conversa: apagar o
 * histórico junto destrói o que estava sendo dito. Por isso qualquer valor que
 * não seja explícito cai em `panels`, o escopo que não perde nada.
 */
const SCREEN_SCOPE: Record<string, 'all' | 'panels' | 'transcript'> = {
  popups: 'panels',
  historico: 'transcript',
  tudo: 'all',
}

/** Até onde olhar para trás ao conferir que ele mesmo pediu a câmera. */
const JANELA_DO_PEDIDO_MS = 20_000

/** G e a voz passam por aqui. Devolve o erro, ou nada se deu certo. */
async function ligarModoMaos(): Promise<string | null> {
  const s = useStore.getState()
  s.setError(null)
  try {
    await hands.enableHands()
    useStore.getState().setGestures(true)
    return null
  } catch (err) {
    const motivo =
      (err as Error)?.name === 'NotAllowedError'
        ? 'Acesso à câmera negado — controle por gestos indisponível.'
        : `O controle por gestos não iniciou: ${(err as Error)?.message ?? err}`
    useStore.getState().setGestures(false)
    useStore.getState().setError(motivo)
    return motivo
  }
}

function desligarModoMaos() {
  hands.disableHands()
  useStore.getState().setGestures(false)
}

/**
 * Limpa a tela e conta o que saiu — ou nada, se não havia o que limpar. A voz
 * precisa dessa diferença: anunciar "tela limpa" diante de uma tela que já
 * estava vazia soa como uma ordem que se perdeu no caminho.
 */
/** "nivel=30, dias=2" vira { nivel: '30', dias: '2' }. A Fênix confere cada valor. */
function lerParametros(texto: string): Record<string, string> {
  const valores: Record<string, string> = {}
  for (const par of texto.split(',')) {
    const [chave, ...resto] = par.split('=')
    if (chave?.trim() && resto.length) valores[chave.trim()] = resto.join('=').trim()
  }
  return valores
}

/** O que a voz recebe de volta: a mensagem e o fim da saída, onde fica o erro. */
function textoDaFenix(r: FenixResposta) {
  const saida = r.saida?.trim()
  return saida ? `${r.mensagem}\nSaída:\n${saida.slice(-1500)}` : r.mensagem
}

/** Rotina e script rodando: a cor de script (lilás) até a Fênix responder. */
async function comFenixTrabalhando(pedir: () => Promise<FenixResposta>) {
  const s = useStore.getState()
  s.setActiveTool('F.Ê.N.I.X.')
  s.setAtividade('executando')
  try {
    return textoDaFenix(await pedir())
  } finally {
    useStore.getState().setActiveTool(null)
    useStore.getState().setAtividade(null)
  }
}

function clearScreenAndReport(what: 'all' | 'panels' | 'transcript'): string | null {
  const s = useStore.getState()
  const popups = what === 'transcript' ? 0 : s.panels.length + s.blades.length
  const linhas = what === 'panels' ? 0 : s.turns.length
  s.clearScreen(what)
  const saiu: string[] = []
  if (popups) saiu.push(popups === 1 ? 'um popup fechado' : `${popups} popups fechados`)
  if (linhas) saiu.push('histórico apagado')
  return saiu.length ? saiu.join(' e ') : null
}

/** Quanto tempo a conversa fica aberta, em silêncio, com os popups do bom dia na tela. */
const LEITURA_DO_BOM_DIA_MS = 3 * 60_000

export default function App() {
  const store = useStore
  const phase = useStore((s) => s.phase)
  const session = useRef<RealtimeSession | null>(null)
  const connecting = useRef<Promise<RealtimeSession> | null>(null)
  const booting = useRef(false)
  /** Quando a última fala foi ouvida, de quem for. */
  const ultimaFala = useRef(0)
  /** Há uma fala dele em andamento na transcrição (para anexar os trechos). */
  const assistantOpen = useRef(false)
  /** A tarefa em andamento foi cancelada pela fala. */
  const cancelada = useRef(false)
  /** Os popups do bom dia estão na tela, esperando um "obrigado" ou outro assunto. */
  const bomDiaNaTela = useRef(false)
  /** Quando os popups do bom dia abriram: enquanto ele os lê, a conversa não fecha. */
  const bomDiaDesde = useRef(0)
  /** Ele agradeceu: a despedida termina e ele entra em espera. */
  const dormirAoCalar = useRef<ReturnType<typeof setTimeout> | null>(null)
  const vigia = useRef(
    vigiarCancelamento(() => {
      if (store.getState().phase !== 'tooling') return
      cancelada.current = true
      cancelTask()
    }),
  )

  // -- espera ---------------------------------------------------------------

  // Sem nada dirigido a ele por 20 s, ele volta à espera, e a sessão continua aberta,
  // então voltar é instantâneo (docs/adr/0024).
  const janela = useRef(
    criarJanela(
      () => goDormant(),
      () => {
        const p = store.getState().phase
        if (p === 'speaking' || p === 'tooling') return 'sim'
        // Lendo os popups do bom dia, o silêncio dele não é fim de conversa. Fecha com
        // um "obrigado", com outro assunto ou, esquecido ali, depois de uns minutos.
        if (bomDiaNaTela.current && Date.now() - bomDiaDesde.current < LEITURA_DO_BOM_DIA_MS) return 'sim'
        if (p === 'thinking' || Date.now() - ultimaFala.current < FALA_RECENTE_MS) return 'talvez'
        return 'nao'
      },
    ),
  )
  const clearIdle = () => janela.current.pausar()
  const armIdle = () => janela.current.abrir()

  /**
   * Em espera. `pedida`: ele mandou (voz ou Esc), e só então a tela muda para o
   * visual de espera e os popups vão para a bandeja. Por silêncio, só o microfone
   * fecha: a tela fica como estava.
   */
  const goDormant = (pedida = false) => {
    clearIdle()
    session.current?.interrupt()
    session.current?.setMicOn(false)
    const s = store.getState()
    s.setCaption('')
    s.setActiveTool(null)
    s.setEsperaPedida(pedida)
    if (pedida) s.minimizeBlades()
    music.working(false)
    music.duck(false)
    sfx.duck(false)
    s.setPhase('dormant')
  }

  /** Outro assunto: os popups do bom dia vão para a bandeja, sem fechar. */
  const minimizarBomDia = () => {
    if (!bomDiaNaTela.current) return
    bomDiaNaTela.current = false
    const s = store.getState()
    if (s.blades.some((b) => b.id.startsWith(PREFIXO_DO_BOM_DIA) && !b.minimized)) s.minimizeBlades()
  }

  /** "Obrigado" com o bom dia na tela: fecha tudo e, depois da despedida, espera. */
  const encerrarBomDia = () => {
    bomDiaNaTela.current = false
    const s = store.getState()
    s.clearScreen('panels')
    if (s.musica) s.comandarMusica('parar')
    if (dormirAoCalar.current) clearTimeout(dormirAoCalar.current)
    // Se ele não chegar a responder, dorme assim mesmo.
    dormirAoCalar.current = setTimeout(() => {
      dormirAoCalar.current = null
      goDormant()
    }, 6000)
  }

  // -- ferramentas ------------------------------------------------------------

  const runTool = async (name: string, args: Record<string, unknown>): Promise<ToolResult> => {
    const s = store.getState()
    // Uma fala ignorada não foi para ele: não pode segurar a conversa aberta.
    if (name !== 'ignorar_fala') clearIdle()

    if (name === 'executar_tarefa') {
      const pedido = String(args.pedido ?? '').trim()
      if (!pedido) return { output: 'Pedido vazio.' }
      s.clearPanels()
      s.clearBlades()
      minimizarBomDia()
      s.setPhase('tooling')
      s.setActiveTool('agente de tarefas')
      s.setAtividade('processando')
      sfx.play('tool')
      music.working(true)
      cancelada.current = false
      try {
        const { text } = await ask(pedido, {
          onText: () => {},
          onTool: (tool, bruto) => {
            const atual = store.getState()
            atual.setActiveTool(prettyTool(tool))
            atual.setAtividade(atividadeDaFerramenta(bruto))
          },
        })
        if (cancelada.current) return { output: 'O Ricardo cancelou a tarefa.' }
        return { output: text || 'Tarefa concluída, sem nada a relatar.' }
      } catch (err) {
        sfx.play('error')
        return {
          output: `A tarefa falhou: ${err instanceof Error ? err.message : String(err)}`,
        }
      } finally {
        vigia.current.parar()
        store.getState().setActiveTool(null)
        store.getState().setAtividade(null)
        music.working(false)
        if (store.getState().phase === 'tooling') store.getState().setPhase('thinking')
        armIdle()
      }
    }

    if (name === 'desenvolvimento') {
      const acao = String(args.acao ?? '')
      armIdle()
      // Abrir o PR manda código para fora: também exige o sim falado dele.
      if (acao === 'pull_request' && !(await ouviuConfirmacao(Date.now() - 60_000))) {
        return {
          output:
            'O sim do Ricardo não foi ouvido. Pergunte uma vez se ele quer abrir o pull request; ' +
            'se ele disser que sim, chame de novo. Nada foi enviado.',
        }
      }
      // Quem confirma é a pessoa, na própria fala; o modelo só repassa.
      if (acao === 'confirmar' || acao === 'aprovar') {
        const impedimento = foraDeHora(acao, s.autodev)
        if (impedimento) return { output: impedimento }
        const desde = acao === 'aprovar' ? s.autodev?.testeDesde : s.autodev?.criadoEm
        if (!(await ouviuConfirmacao(desde ?? Date.now()))) {
          const botao = acao === 'aprovar' ? 'Aprovar' : 'Confirmar'
          return {
            output:
              `A confirmação não foi ouvida do Ricardo. Peça uma vez que ele diga "confirmo" ou ` +
              `clique em ${botao} na tela. Se ele pedir outra coisa, atenda. Nada foi feito.`,
          }
        }
      }
      const { mensagem } = await autodev(acao, { pedido: String(args.pedido ?? '') })
      return { output: mensagem }
    }

    if (name === 'bom_dia') {
      armIdle()
      const r = await bomDia()
      if (!r.ok) return { output: `O resumo do dia não veio (${r.mensagem}). Dê bom dia normalmente, sem resumo.` }
      if (r.musica) s.setMusica({ ...r.musica, tocando: true, posicao: r.musica.inicio })
      // Notícias, compromissos e desenvolvimento, em diagonal, um de cada vez.
      const popups = popupsDoBomDia(r)
      for (const b of s.blades) if (b.id.startsWith(PREFIXO_DO_BOM_DIA)) s.closeBlade(b.id)
      popups.forEach((b, i) => setTimeout(() => store.getState().pushBlade(b), i * INTERVALO_DOS_POPUPS_MS))
      bomDiaNaTela.current = popups.length > 0
      bomDiaDesde.current = Date.now()
      return {
        output:
          `${r.texto}\n${descreverPopups(popups)}\n\nDê bom dia ao Ricardo e resuma isso em até 30 segundos, ` +
          'como um assistente que conhece a rotina dele: compromissos primeiro, um destaque por tema ' +
          'de notícia, o GitHub numa frase. Os detalhes já estão nos popups: não leia listas. A ' +
          'música já está tocando baixinho por baixo: não a anuncie, a não ser que ele pergunte. ' +
          'Se ele agradecer, despeça-se em poucas palavras: a tela fecha os popups e entra em espera ' +
          'sozinha. Se ele mudar de assunto, chame ajustar_interface com popups "minimizar" antes ' +
          'de responder; se ele perguntar de uma notícia ou de um compromisso, os popups ficam. ' +
          'Termine o resumo com uma pergunta curta, como se quer detalhar alguma notícia, e ' +
          'espere: a conversa continua. A voz dele por cima da música é para você: não use ' +
          'ignorar_fala por causa da música.',
      }
    }

    if (name === 'musica') {
      const acao = String(args.acao ?? '')
      const m = s.musica
      if (!m) return { output: 'Nenhuma música tocando agora.' }
      if (acao === 'pausar' || acao === 'tocar' || acao === 'parar') {
        s.comandarMusica(acao)
        return { output: acao === 'pausar' ? 'Pausada.' : acao === 'tocar' ? 'Tocando de novo.' : 'Parei a música.' }
      }
      if (acao === 'playlist') {
        const aberta = abrirNoYoutube(m)
        s.comandarMusica('parar')
        return {
          output: aberta
            ? 'Abri a playlist numa aba do YouTube Music, a partir desta música.'
            : 'O Chrome bloqueou a aba nova. Peça que ele clique em "Abrir no YouTube" no tocador do canto, ou libere os pop-ups deste endereço.',
        }
      }
      return { output: `Ação desconhecida: ${acao}.` }
    }

    if (name === 'fenix') {
      const acao = String(args.acao ?? '')
      armIdle()
      // Como no desenvolvimento: quem confirma um script é a fala do Ricardo.
      if (acao === 'confirmar' || acao === 'cancelar') {
        const proposta = s.fenix.propostas.at(-1)
        if (!proposta) return { output: 'Não há comando da Fênix esperando confirmação.' }
        if (acao === 'confirmar' && !(await ouviuConfirmacao(proposta.vistaEm))) {
          return {
            output:
              'A confirmação não foi ouvida do Ricardo. Peça uma vez que ele diga "confirmo" ou ' +
              'clique em Confirmar na tela. Nada foi rodado.',
          }
        }
        return { output: await comFenixTrabalhando(() => fenix(acao, { proposta: proposta.id }, 6 * 60_000)) }
      }
      const extra = {
        nome: String(args.nome ?? ''),
        parametros: lerParametros(String(args.parametros ?? '')),
        script: String(args.script ?? ''),
        motivo: String(args.motivo ?? ''),
      }
      if (acao === 'comando') {
        const r = await fenix('comando', extra)
        if (!r.ok || !r.proposta) return { output: r.mensagem }
        return {
          output:
            `Proposta na tela, ainda sem rodar: ${r.proposta.script}\n` +
            'Diga em uma frase o que o script faz e pergunte se ele confirma.',
        }
      }
      if (acao === 'rotina') {
        return { output: await comFenixTrabalhando(() => fenix('rotina', extra, 50 * 60_000)) }
      }
      return { output: textoDaFenix(await fenix(acao, extra)) }
    }

    if (name === 'olhar_camera') {
      s.setLooking(String(args.motivo ?? 'dando uma olhada'))
      let held = false
      try {
        await camera.holdCamera()
        held = true
        const frame = camera.grabFrame()
        return {
          output: 'A foto da câmera foi anexada logo abaixo. Responda com base nela.',
          image: `data:${frame.mimeType};base64,${frame.data}`,
        }
      } catch (err) {
        return {
          output:
            (err as DOMException)?.name === 'NotAllowedError'
              ? 'A câmera não foi permitida, então não consigo ver nada.'
              : `Não foi possível ler a câmera: ${(err as Error)?.message ?? err}`,
        }
      } finally {
        if (held) camera.releaseCamera()
        store.getState().setLooking(null)
        armIdle()
      }
    }

    if (name === 'ajustar_interface') {
      const feito: string[] = []
      /** Pedido de limpeza que não encontrou nada para limpar. */
      let vazio: string | null = null
      if (args.restaurar) {
        s.resetUi()
        feito.push('interface restaurada')
      }
      if (typeof args.cor === 'string' && /^#?[0-9a-f]{3,8}$/i.test(args.cor)) {
        const cor = args.cor.startsWith('#') ? args.cor : `#${args.cor}`
        s.applyUi({ accent: cor })
        feito.push(`cor ${cor}`)
      }
      if (typeof args.efeito === 'string') {
        s.fireEffect(args.efeito as never)
        feito.push(`efeito ${args.efeito}`)
      }
      const pedido = {
        ...(typeof args.exibir_ponte === 'boolean' && { exibirPonte: args.exibir_ponte }),
        ...(typeof args.exibir_chat === 'boolean' && { exibirChat: args.exibir_chat }),
      }
      if (Object.keys(pedido).length) {
        s.setExibicao({ ...s.exibicao, ...pedido })
        void salvarPreferencias(pedido)
        feito.push('exibição ajustada')
      }
      if (typeof args.popups === 'string') {
        const titulo = typeof args.popup === 'string' ? args.popup : undefined
        vazio = comandarPopup(args.popups as AcaoDePopup, titulo)
      }
      if (args.modo_maos === false) {
        desligarModoMaos()
        feito.push('modo mãos desligado')
      }
      if (args.modo_maos === true) {
        if (!(await ouviuFala(pedeModoMaos, Date.now() - JANELA_DO_PEDIDO_MS))) {
          vazio = 'O pedido da câmera não foi ouvido do Ricardo. Ela continua desligada.'
        } else {
          const erro = await ligarModoMaos()
          if (erro) vazio = erro
          else feito.push('modo mãos ligado')
        }
      }
      if (args.limpar_tela) {
        const alvo = SCREEN_SCOPE[String(args.limpar_tela)] ?? 'panels'
        const saiu = clearScreenAndReport(alvo)
        if (saiu) feito.push(saiu)
        else {
          vazio =
            alvo === 'transcript' ? 'O histórico já estava vazio.' : 'A tela já estava limpa.'
        }
      }
      armIdle()
      const partes: string[] = []
      if (feito.length) partes.push(`Feito: ${feito.join(', ')}.`)
      if (vazio) partes.push(vazio)
      return { output: partes.join(' ') || 'Nada foi alterado.' }
    }

    if (name === 'diagnostico') {
      armIdle()
      if (args.mostrar === false) {
        s.setSistemas('fechado')
        return { output: 'A aba de sistemas foi fechada.' }
      }
      if (args.detalhes) s.setSistemas('completo')
      else if (s.sistemas === 'fechado') s.setSistemas('aba')
      return { output: resumoSistemas(sistemasAgora()) }
    }

    if (name === 'dormir') {
      // O mesmo que o Esc: também cancela a tarefa em andamento.
      if (s.phase === 'tooling') cancelTask()
      // Deixa a despedida terminar de tocar antes de fechar o microfone.
      setTimeout(() => goDormant(true), 2500)
      return { output: 'Em espera.', silent: true }
    }

    if (name === 'ignorar_fala') {
      // A fala não era para ele: volta a ouvir, e o prazo da conversa segue correndo,
      // então a TV ou uma conversa ao lado acabam em espera sozinhas.
      if (s.phase === 'thinking') s.setPhase('listening')
      janela.current.garantir()
      return { output: 'Ignorado.', silent: true, descartar: true }
    }

    return { output: `Ferramenta desconhecida: ${name}.` }
  }

  // -- sessão de voz ----------------------------------------------------------

  const openSession = (): Promise<RealtimeSession> => {
    if (session.current) return Promise.resolve(session.current)
    if (connecting.current) return connecting.current

    connecting.current = connectRealtime({
      onSpeechStart: () => {
        // Não reabre a janela: ouvir alguém não quer dizer que falaram com ele.
        ultimaFala.current = Date.now()
        const s = store.getState()
        if (s.phase === 'dormant' || s.phase === 'offline' || s.phase === 'boot') return
        s.setError(null)
        assistantOpen.current = false
        sfx.duck(true)
        music.duck(true)
        if (s.phase !== 'tooling') s.setPhase('listening')
      },
      onSpeechStop: () => {
        const s = store.getState()
        if (s.phase === 'listening') s.setPhase('thinking')
      },
      onUserPartial: (text) => {
        ultimaFala.current = Date.now()
        registrarFala(text)
        store.getState().setCaption(text)
        if (store.getState().phase === 'tooling') vigia.current.ouvir(text)
      },
      onUserText: (text) => {
        registrarFala(text)
        const s = store.getState()
        s.setCaption('')
        s.pushTurn({ id: newId(), role: 'user', text })
        // Pela transcrição, como o cancelar: não depende de o modelo lembrar.
        if (bomDiaNaTela.current && agradece(text)) encerrarBomDia()
      },
      onAssistantStart: () => {
        assistantOpen.current = true
        store.getState().pushTurn({ id: newId(), role: 'apolo', text: '' })
      },
      onAssistantDelta: (delta) => {
        if (!assistantOpen.current) {
          assistantOpen.current = true
          store.getState().pushTurn({ id: newId(), role: 'apolo', text: '' })
        }
        store.getState().appendToLastTurn(delta)
      },
      onSpeakingStart: () => {
        clearIdle()
        const s = store.getState()
        sfx.duck(true)
        music.duck(true)
        if (s.phase !== 'dormant' && s.phase !== 'tooling') s.setPhase('speaking')
      },
      onSpeakingStop: () => {
        assistantOpen.current = false
        sfx.duck(false)
        music.duck(false)
        if (dormirAoCalar.current) {
          clearTimeout(dormirAoCalar.current)
          dormirAoCalar.current = null
          goDormant()
          return
        }
        const s = store.getState()
        if (s.phase === 'speaking' || s.phase === 'thinking') {
          s.setPhase('listening')
          armIdle()
        }
      },
      onToolCall: runTool,
      onError: (message) => {
        console.warn('[apolo]', message)
        store.getState().setError(message)
      },
      onClosed: () => {
        session.current = null
        const s = store.getState()
        if (s.phase !== 'offline' && s.phase !== 'boot') {
          clearIdle()
          s.setPhase('dormant')
          s.setError('A sessão de voz foi encerrada. Ela recomeça quando você me chamar.')
        }
      },
    })
      .then((rt) => {
        session.current = rt
        store.getState().setVoice(rt.model)
        return rt
      })
      .finally(() => {
        connecting.current = null
      })
    return connecting.current
  }

  /** Acorda: abre o microfone (e a sessão, se ela tiver caído). */
  const wake = async () => {
    const s = store.getState()
    if (s.phase === 'offline' || s.phase === 'boot') return
    s.setError(null)
    sfx.play('wake')
    try {
      const rt = await openSession()
      rt.setMicOn(true)
      store.getState().setPhase('listening')
      sfx.play('listen')
      armIdle()
    } catch (err) {
      sfx.play('error')
      store.getState().setPhase('dormant')
      store.getState().setError(err instanceof Error ? err.message : String(err))
    }
  }

  /** Chamado pelo nome em espera. O que veio junto vira o primeiro pedido. */
  const atenderChamado = async (fala: string, pedido: string) => {
    await wake()
    const s = store.getState()
    if (s.phase !== 'listening') return
    if (pedido || deuBomDia(fala)) {
      registrarFala(fala)
      s.pushTurn({ id: newId(), role: 'user', text: fala })
      session.current?.prompt(`O Ricardo chamou você pelo nome e disse: "${fala}". Atenda.`)
    } else {
      session.current?.prompt(
        'O Ricardo acabou de chamar você pelo nome, e você saiu da espera. Responda em ' +
          'poucas palavras que está ouvindo.',
      )
    }
  }

  // -- partida ----------------------------------------------------------------

  const powerOn = async () => {
    if (booting.current) return
    booting.current = true
    try {
      await ignite()
    } catch (err) {
      booting.current = false
      console.error('[apolo] falha ao iniciar:', err)
      store.getState().setPhase('offline')
      store
        .getState()
        .setError(
          err instanceof Error
            ? `Falha ao iniciar: ${err.message}`
            : 'Falha ao iniciar. Clique ou aperte uma tecla para tentar de novo.',
        )
    }
  }

  const ignite = async () => {
    const s = store.getState()

    // Sem clique para ligar: se o Chrome segurar o som até um gesto, ele é liberado
    // no primeiro toque (ver `liberarSom`), e o resto já sobe.
    await sfx.unlockAudio()
    sfx.play('boot')
    music.enable()
    s.setPhase('boot')

    watchServers((servers) => store.getState().setConnected(servers))
    watchPreferencias((valores) => store.getState().setExibicao(valores))
    watchPanels((panel) => store.getState().pushPanel(panel))
    watchBlades((blade) => store.getState().pushBlade(blade))

    // O trabalho leva minutos, então o resultado é anunciado quando chega. Só
    // o que começou com esta página aberta: o estado salvo não é notícia.
    watchFenix((estado) => store.getState().setFenix(estado))
    let acompanhando = false
    let testeAvisado = false
    watchAutodev((estado) => {
      store.getState().setAutodev(estado)
      if (estado.fase !== 'ocioso' && estado.fase !== 'proposto') acompanhando = true
      if (estado.fase === 'testando' && !testeAvisado && acompanhando) {
        testeAvisado = true
        session.current?.prompt(
          `A alteração está no ar para teste. Diga o que mudou em uma ou duas frases e peça ` +
            `que o Ricardo teste e diga se aprova ou descarta: ${estado.resumo ?? ''}`,
        )
      }
      if (estado.fase === 'ocioso') testeAvisado = false
      if (estado.fase === 'ocioso' && estado.resultado && acompanhando) {
        acompanhando = false
        const aprovado = estado.resultado.tipo === 'aprovado' && estado.resultado.branch
        session.current?.prompt(
          `O autodesenvolvimento terminou. Informe o Ricardo em uma ou duas frases, sem ler ` +
            `código nem nomes de branch: ${estado.resultado.mensagem}` +
            (aprovado
              ? ' Depois pergunte se ele quer que você abra o pull request para a main. Só se ele ' +
                'disser que sim, use desenvolvimento com acao "pull_request".'
              : ''),
        )
      }
    })

    // O agente de tarefas pedindo para ver algo pela câmera.
    watchCapture(async (req) => {
      const note =
        req.mode === 'watch'
          ? req.when === 'past'
            ? req.reason || 'revendo os últimos segundos'
            : `${req.reason || 'observando'} · ${req.seconds}s`
          : req.reason || 'dando uma olhada'
      store.getState().setLooking(note)

      if (req.mode === 'watch' && req.when === 'past' && camera.bufferedSeconds() < 1) {
        store.getState().setLooking(null)
        return {
          error:
            'Não há imagens recentes — a câmera precisa estar aberta na tela ' +
            'para eu lembrar o que acabou de acontecer.',
        }
      }

      let held = false
      try {
        await camera.holdCamera()
        held = true
        if (req.mode === 'look') return camera.grabFrame()
        if (req.when === 'past') {
          const grid = camera.recentGrid(req.seconds, 9)
          return grid ?? { error: 'Não há imagens recentes suficientes para revisar.' }
        }
        return await camera.watchAhead(req.seconds, 9)
      } catch (err) {
        return {
          error:
            (err as DOMException)?.name === 'NotAllowedError'
              ? 'A câmera não foi permitida, então não consigo ver nada.'
              : `Não foi possível ler a câmera: ${(err as Error)?.message ?? err}`,
        }
      } finally {
        if (held) camera.releaseCamera()
        store.getState().setLooking(null)
      }
    })

    // O agente de tarefas querendo saber em que navegador está, ou abrir uma
    // aba nele (ferramentas browser_*). Quem responde é a página: ninguém no
    // servidor sabe o que tem do outro lado da tela.
    watchBrowser(handleBrowser)

    // A interface é dele para mexer (ferramentas ui_* do agente de tarefas).
    watchUi((op, args) => {
      const s = store.getState()
      const a = (args ?? {}) as Record<string, never>
      switch (op) {
        case 'patch':
          s.applyUi(args)
          break
        case 'orbit':
          if (a.action === 'add') s.addOrbit(args)
          else if (a.action === 'remove') s.removeOrbit(String(a.id))
          else s.clearOrbits()
          break
        case 'effect':
          s.fireEffect(a.kind)
          break
        case 'reset':
          s.resetUi()
          break
        case 'screen':
          // Sem escopo, só os popups: ver SCREEN_SCOPE.
          s.clearScreen(a.what ?? 'panels')
          break
        default:
          console.warn('[apolo] operação de interface desconhecida:', op, args)
      }
    })

    watchConnection((state) => {
      if (state === 'lost') {
        store.getState().setError('Conexão com o agente de tarefas perdida — reconectando.')
      } else if (state === 'reconnected') {
        store.getState().setError(null)
      }
    })

    // Tudo em paralelo com a animação de partida: a ponte, o medidor do
    // microfone e a sessão de voz.
    const bridgeUp = warmBridge().catch((err: Error) => s.setError(err.message))
    try {
      await startAnalyser()
    } catch {
      throw new Error('o microfone não foi permitido. Libere o acesso e tente de novo.')
    }
    const voiceUp = openSession()

    await bridgeUp
    store.getState().setConnected(bridgeServers())

    try {
      await voiceUp
    } catch (err) {
      store.getState().setPhase('dormant')
      store.getState().setError(err instanceof Error ? err.message : String(err))
      sfx.play('error')
      return
    }

    store.getState().setPhase('listening')
    armIdle()
    // Sem cumprimento a cada partida: o bip diz que ele está pronto.
    sfx.play('listen')
  }

  // -- palmas -----------------------------------------------------------------

  /** Em espera, só o nome acorda por voz (RF-11). */
  useEffect(() => {
    if (phase !== 'dormant' || !chamadaDisponivel()) return
    const escuta = ouvirNome(
      (fala, pedido) => void atenderChamado(fala, pedido),
      (motivo) => store.getState().setError(motivo),
    )
    return () => escuta.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  /**
   * Uma palma liga a interface. Em espera ela não acorda mais, porque só o nome
   * deve acordá-lo, salvo num navegador que não saiba ouvir o nome.
   */
  useEffect(() => {
    if (phase !== 'offline' && !(phase === 'dormant' && !chamadaDisponivel())) return
    let live: { stop: () => void } | null = null
    let gone = false
    void listenForClap(() => {
      if (gone) return
      if (store.getState().phase === 'offline') void powerOn()
      else void wake()
    }).then((l) => {
      if (gone) l.stop()
      else live = l
    })
    return () => {
      gone = true
      live?.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // -- partida automática ----------------------------------------------------

  /** Retoma o som que o Chrome segurou, ou tenta ligar de novo se a partida falhou. */
  const liberarSom = () => {
    void sfx.unlockAudio()
    retomarAnalyser()
    session.current?.retomar?.()
    if (store.getState().phase === 'offline') void powerOn()
  }

  // Liga sozinho ao abrir, como o app do celular: sem tela de INICIAR nem animação.
  useEffect(() => {
    // Se o Chrome segurar o som, o primeiro clique ou tecla o libera, em silêncio.
    void powerOn()
    window.addEventListener('pointerdown', liberarSom)
    window.addEventListener('keydown', liberarSom)
    return () => {
      window.removeEventListener('pointerdown', liberarSom)
      window.removeEventListener('keydown', liberarSom)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // -- nível + teclas ---------------------------------------------------------

  useEffect(() => {
    let raf = 0
    const pump = () => {
      const st = store.getState()
      const lvl =
        st.phase === 'speaking' && session.current ? session.current.level() : micLevel()
      st.setLevel(lvl)
      raf = requestAnimationFrame(pump)
    }
    pump()

    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const bare = !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey

      // G liga a câmera e o controle por gestos. Nunca implícito.
      if (e.key === 'g' && bare) {
        e.preventDefault()
        if (store.getState().gestures) desligarModoMaos()
        else void ligarModoMaos()
        return
      }

      // Esc põe em espera e cancela uma tarefa em andamento.
      if (e.key === 'Escape') {
        e.preventDefault()
        const p = store.getState().phase
        if (p === 'tooling') cancelTask()
        if (p !== 'offline' && p !== 'boot') goDormant(true)
        return
      }

      if (e.code !== 'Space' || e.repeat) return
      e.preventDefault()
      const p = store.getState().phase
      if (p === 'offline') void powerOn()
      else if (p === 'dormant') void wake()
      else if (p === 'speaking') session.current?.interrupt()
    }
    window.addEventListener('keydown', onKey)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey)
      clearIdle()
      session.current?.close()
      hands.disableHands()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <Scene />
      <Hud />
      <Diagnostics />
    </>
  )
}
