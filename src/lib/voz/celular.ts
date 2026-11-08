import { soltarMic } from '../audio'
import { chamouPeloNome } from '../chamada'
import { criarJanela } from '../conversa'
import { vigiarCancelamento } from '../comandos'
import type { AcaoDePopup } from '../comandosDePopup'
import { connectGemini } from './gemini'
import type { RealtimeSession, SessionGrant, ToolResult } from './types'

/**
 * A voz do browser, comandada pelo app do iPhone (docs/adr/0019).
 *
 * O cliente é o mesmo `connectGemini`. O que muda é tudo o que no PC passa pela
 * ponte: aqui a página não tem o token, então a credencial e as tarefas pedem ao
 * app, que fala com o gateway. Popups continuam sendo o que o agente abrir.
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
      if (falando || tarefas.size) return 'sim'
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
          if (tarefas.size) vigia.ouvir(texto)
        },
        onUserText: (texto) => {
          // Chega antes do áudio da resposta: acordar aqui deixa a resposta ao chamado tocar.
          if (emEspera && chamouPeloNome(texto).chamou) sairDaEspera()
          if (!emEspera) enviar({ ouviu: texto, fim: true })
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
  }
}
