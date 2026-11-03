/**
 * Supervisor do autodesenvolvimento: troca a versão em execução e desfaz a troca
 * se ela quebrar (docs/adr/0011).
 *
 * Vive fora da ponte porque a ponte é justamente o que ele derruba, e fica
 * carregado na memória do `npm start`: uma versão nova não muda quem a vigia
 * até a próxima partida manual — e estes arquivos são sensíveis (politica.mjs),
 * então só mudam por revisão humana.
 *
 * Toda troca é registrada em disco antes de começar. Se o Mac desligar no meio,
 * a próxima partida encontra o registro e volta para a versão anterior.
 *
 * Só a branch em execução muda. A `main` continua intocada: o que sobrevive
 * aqui ainda entra nela por pull request.
 */

import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { classificar } from '../bridge/autodev/politica.mjs'

const exec = promisify(execFile)

const lerJson = (arquivo, padrao) => {
  try {
    return JSON.parse(readFileSync(arquivo, 'utf8'))
  } catch {
    return padrao
  }
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * @param repo      a cópia do projeto em execução
 * @param pasta     onde ficam o registro da transição e o histórico
 * @param ligar     sobe a ponte
 * @param desligar  derruba a ponte; resolve quando ela tiver saído
 * @param saude     `{ ok, motivo?, interfaces }` da versão no ar
 * @param notificar entrega um resultado à ponte em execução
 */
export function criarSupervisor({
  repo,
  pasta,
  ligar,
  desligar,
  saude,
  notificar = () => {},
  log = console.log,
  subidaMs = 30_000,
  estabilidadeMs = 60_000,
  intervaloMs = 1000,
}) {
  mkdirSync(pasta, { recursive: true })
  const arqTransicao = join(pasta, 'transicao.json')
  const arqHistorico = join(pasta, 'historico.json')

  const git = async (...args) =>
    (await exec('git', args, { cwd: repo, maxBuffer: 16 * 1024 * 1024 })).stdout.trim()

  const versaoAtual = async () => {
    const sha = await git('rev-parse', 'HEAD')
    const ref = await git('symbolic-ref', '--short', '-q', 'HEAD').catch(() => sha)
    return { ref, sha }
  }

  const trocarPara = ({ ref, sha }) =>
    ref === sha ? git('switch', '--detach', sha) : git('switch', ref)

  /** Ocupado com uma troca: a saída da ponte é esperada ou já está em análise. */
  let ocupado = false
  /** Motivo pelo qual a ponte caiu durante a observação. */
  let queda = null

  async function recusaAplicar({ sha, branch }) {
    if (await git('status', '--porcelain')) {
      return 'A cópia em execução tem alterações não commitadas; nada foi trocado.'
    }
    const atual = await git('rev-parse', 'HEAD')
    const descende = await git('merge-base', '--is-ancestor', atual, sha).then(
      () => true,
      () => false,
    )
    if (!descende) return 'A alteração não parte da versão em execução; nada foi trocado.'
    if ((await git('rev-parse', branch).catch(() => '')) !== sha) {
      return 'A branch da alteração não confere com o commit verificado; nada foi trocado.'
    }
    // Conferido de novo aqui, e não só na ponte: é o que a ponte pede que precisa
    // ser verificado, e a ponte é parte do que muda.
    const nomes = (await git('diff', '--name-only', atual, sha)).split('\n').filter(Boolean)
    const { proibidos, sensiveis } = classificar(nomes)
    if (proibidos.length + sensiveis.length) {
      return `A alteração toca arquivos protegidos (${[...proibidos, ...sensiveis].join(', ')}); exige revisão.`
    }
    return null
  }

  /** Espera a versão no ar responder. Devolve o motivo da falha, ou null. */
  async function esperarSubida() {
    let motivo = 'não respondeu a tempo'
    const limite = Date.now() + subidaMs
    while (true) {
      if (queda) return queda
      const s = await saude().catch((err) => ({ ok: false, motivo: err.message }))
      if (s.ok) return null
      motivo = s.motivo ?? motivo
      if (Date.now() > limite) return `A nova versão ${motivo}.`
      await dormir(intervaloMs)
    }
  }

  /** Espera a versão subir e continuar de pé. Devolve o motivo da falha, ou null. */
  async function observar(exigirInterface) {
    const naoSubiu = await esperarSubida()
    if (naoSubiu) return naoSubiu
    let interfaceVoltou = false
    const fim = Date.now() + estabilidadeMs
    while (Date.now() < fim) {
      if (queda) return queda
      const s = await saude().catch((err) => ({ ok: false, motivo: err.message }))
      if (!s.ok) return `A nova versão parou de responder: ${s.motivo ?? 'sem detalhe'}.`
      if (s.interfaces > 0) interfaceVoltou = true
      await dormir(intervaloMs)
    }
    if (exigirInterface && !interfaceVoltou) return 'A interface não voltou a se conectar.'
    return null
  }

  async function voltar(transicao, motivo) {
    await desligar()
    await trocarPara(transicao.de)
    queda = null
    ligar()
    rmSync(arqTransicao, { force: true })
    log(`[supervisor] rollback para ${transicao.de.ref}: ${motivo}`)
    // Não há para onde voltar depois disto, então a falha precisa ser gritada.
    const naoSubiu = await esperarSubida()
    if (naoSubiu) log(`[supervisor] ATENÇÃO: a versão anterior também falhou: ${naoSubiu}`)
  }

  return {
    /** Troca para o commit verificado, observa e desfaz se quebrar. */
    async aplicar({ id, sha, branch, interfaces = 0 }) {
      if (ocupado) return notificar({ id, tipo: 'recusado', mensagem: 'Já há uma troca em andamento.' })
      ocupado = true
      try {
        const recusa = await recusaAplicar({ sha, branch }).catch((err) => err.message)
        if (recusa) return notificar({ id, tipo: 'recusado', mensagem: recusa })

        const transicao = { id, de: await versaoAtual(), para: { ref: branch, sha } }
        writeFileSync(arqTransicao, JSON.stringify(transicao, null, 2))
        log(`[supervisor] trocando ${transicao.de.ref} por ${branch}`)

        await desligar()
        queda = null
        await trocarPara(transicao.para)
        ligar()

        const motivo = await observar(interfaces > 0)
        if (motivo) {
          await voltar(transicao, motivo)
          return notificar({
            id,
            tipo: 'revertido',
            mensagem: `${motivo} O rollback foi feito e a versão anterior voltou ao ar.`,
          })
        }

        const historico = lerJson(arqHistorico, [])
        historico.push(transicao)
        writeFileSync(arqHistorico, JSON.stringify(historico.slice(-20), null, 2))
        rmSync(arqTransicao, { force: true })
        log(`[supervisor] ${branch} estável`)
        notificar({ id, tipo: 'concluido', mensagem: 'A alteração está no ar e estável.' })
      } catch (err) {
        log(`[supervisor] falha na troca: ${err.message}`)
        const transicao = lerJson(arqTransicao, null)
        if (transicao) await voltar(transicao, err.message).catch((e) => log(`[supervisor] ${e.message}`))
        notificar({ id, tipo: 'revertido', mensagem: `A troca falhou: ${err.message}` })
      } finally {
        ocupado = false
      }
    },

    /** Pedido de quem usa: volta uma evolução já tida como estável. */
    async reverter({ id } = {}) {
      if (ocupado) return notificar({ id, tipo: 'recusado', mensagem: 'Há uma troca em andamento.' })
      const historico = lerJson(arqHistorico, [])
      const ultima = historico.at(-1)
      if (!ultima) return notificar({ id, tipo: 'recusado', mensagem: 'Não há versão anterior registrada.' })
      ocupado = true
      try {
        if (await git('status', '--porcelain')) {
          return notificar({
            id,
            tipo: 'recusado',
            mensagem: 'A cópia em execução tem alterações não commitadas; nada foi trocado.',
          })
        }
        await voltar(ultima, 'pedido do Ricardo')
        writeFileSync(arqHistorico, JSON.stringify(historico.slice(0, -1), null, 2))
        notificar({ id, tipo: 'revertido', mensagem: 'A versão anterior voltou ao ar.' })
      } finally {
        ocupado = false
      }
    },

    /** Uma troca que ficou pela metade: volta antes de subir qualquer coisa. */
    async recuperar() {
      const transicao = lerJson(arqTransicao, null)
      if (!transicao) return null
      log(`[supervisor] troca interrompida encontrada; voltando para ${transicao.de.ref}`)
      await trocarPara(transicao.de)
      rmSync(arqTransicao, { force: true })
      return transicao
    },

    /** A ponte saiu. Devolve true se isso faz parte de uma troca em curso. */
    ponteSaiu(codigo) {
      if (!ocupado) return false
      queda = `A ponte caiu ao iniciar (código ${codigo}).`
      return true
    },
  }
}

/** A saúde real: a ponte responde e o Vite consegue transformar a interface. */
export async function saudeHttp({ portaPonte, portaInterface }) {
  const ponte = await fetch(`http://localhost:${portaPonte}/health`, {
    signal: AbortSignal.timeout(2000),
  })
  if (!ponte.ok) return { ok: false, motivo: `a ponte respondeu ${ponte.status}` }
  const { interfaces = 0 } = await ponte.json()
  for (const arquivo of ['/src/main.tsx', '/src/App.tsx']) {
    const r = await fetch(`http://localhost:${portaInterface}${arquivo}`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!r.ok) return { ok: false, motivo: `a interface não compilou (${arquivo}: ${r.status})` }
  }
  return { ok: true, interfaces }
}
