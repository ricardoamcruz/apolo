/**
 * As versões: coloca uma alteração em teste e garante a volta à versão segura
 * (docs/adr/0011, 0015 e 0025).
 *
 * Vive na F.Ê.N.I.X., fora do projeto, porque o projeto é justamente o que ela
 * derruba. As regras (o que exige revisão, que branch vale) vêm do
 * fenix.config.json lido na partida: uma versão nova não muda quem a vigia até a
 * próxima partida manual, e o arquivo de configuração só muda por revisão humana.
 *
 * Enquanto o Ricardo não aprova, a alteração é provisória, sem limite de tempo:
 * `transicao.json` fica em disco. Uma queda a qualquer momento, até o Mac
 * desligando, volta para a versão segura — na hora ou na próxima partida.
 *
 *   aprovada   → vira a branch fase-x.x/nome e o projeto volta à versão segura
 *   descartada → a branch some e o projeto volta à versão segura
 */

import { execFile } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

const lerJson = (arquivo, padrao) => {
  try {
    return JSON.parse(readFileSync(arquivo, 'utf8'))
  } catch {
    return padrao
  }
}

/** Sem segurar o processo: quem o mantém vivo são os serviços e o canal. */
const dormir = (ms) => new Promise((r) => setTimeout(r, ms).unref())

const FALHAS_SEGUIDAS = 3

/**
 * O que exige revisão humana: a alteração para na branch e não entra em teste.
 * Devolve os arquivos que barram a troca, com o motivo.
 */
export async function barrados(protecao, nomes, conteudo) {
  const revisao = nomes.filter((f) => !protecao.liberados.has(f) && protecao.revisao.some((re) => re.test(f)))
  const quebrados = []
  for (const { arquivo, contem } of protecao.invariantes) {
    if (!nomes.includes(arquivo)) continue
    const codigo = await conteudo(arquivo).catch(() => '')
    if (!contem.every((re) => re.test(codigo))) quebrados.push(arquivo)
  }
  return { revisao, quebrados }
}

/**
 * @param repo      a cópia do projeto em execução
 * @param pasta     onde ficam o registro da transição e os eventos
 * @param ligar     sobe os serviços versionados
 * @param desligar  derruba os serviços versionados; resolve quando tiverem saído
 * @param saude     `{ ok, motivo?, interfaces }` da versão no ar
 * @param notificar entrega um resultado ao projeto em execução
 * @param protecao  o que exige revisão (fenix.config.json)
 * @param instalar  `{ comando, quando }`: reinstala as dependências numa atualização
 */
export function criarVersoes({
  repo,
  pasta,
  ligar,
  desligar,
  saude,
  notificar = () => {},
  protecao = { revisao: [], liberados: new Set(), invariantes: [], branch: /^[\w./-]+$/ },
  versaoSegura = 'main',
  instalar = null,
  log = console.log,
  subidaMs = 30_000,
  estabilidadeMs = 30_000,
  intervaloMs = 1000,
  vigiaMs = 5000,
}) {
  mkdirSync(pasta, { recursive: true })
  const arqTransicao = join(pasta, 'transicao.json')
  const arqEventos = join(pasta, 'eventos.log')

  /** O terminal se perde a cada partida; o motivo de um rollback, não. */
  const anotar = (linha) => {
    log(linha)
    try {
      appendFileSync(arqEventos, `${new Date().toISOString()} ${linha}\n`)
    } catch {
      /* o registro nunca derruba uma troca */
    }
  }

  const branchValida = (nome) => protecao.branch.test(String(nome ?? ''))

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
  /** Motivo pelo qual a ponte caiu durante a observação ou o teste. */
  let queda = null
  /** A transição que aguarda a avaliação do Ricardo. */
  let emTeste = null

  async function rodarInstalar() {
    const [comando, ...args] = instalar.comando
    await exec(comando, args, { cwd: repo, maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60_000 })
  }

  const apagarBranch = (ref) => git('branch', '-D', ref).catch(() => {})

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
    // Conferido de novo aqui, e não só no projeto: é o que o projeto pede que
    // precisa ser verificado, e o projeto é parte do que muda.
    const nomes = (await git('diff', '--name-only', atual, sha)).split('\n').filter(Boolean)
    const { revisao, quebrados } = await barrados(protecao, nomes, (f) => git('show', `${sha}:${f}`))
    if (revisao.length) {
      return `A alteração toca arquivos protegidos (${revisao.join(', ')}); exige revisão.`
    }
    if (quebrados.length) {
      return `A alteração tira ${quebrados.join(', ')} do que precisa continuar valendo; exige revisão.`
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
    let falhas = 0
    const fim = Date.now() + estabilidadeMs
    while (Date.now() < fim) {
      if (queda) return queda
      const s = await saude().catch((err) => ({ ok: false, motivo: err.message }))
      // Uma resposta lenta do Vite num Mac ocupado não é uma versão quebrada.
      falhas = s.ok ? 0 : falhas + 1
      if (falhas >= FALHAS_SEGUIDAS) return `A nova versão parou de responder: ${s.motivo ?? 'sem detalhe'}.`
      if (s.interfaces > 0) interfaceVoltou = true
      await dormir(intervaloMs)
    }
    if (exigirInterface && !interfaceVoltou) return 'A interface não voltou a se conectar.'
    return null
  }

  /** Volta à versão segura. Se o Git recusar, a ponte sobe mesmo assim e o erro sobe. */
  async function voltar(transicao, motivo) {
    await desligar()
    let falha = null
    await trocarPara(transicao.de).catch((err) => (falha = err))
    queda = null
    ligar()
    if (falha) {
      anotar(`[fenix] ATENÇÃO: não consegui voltar para ${transicao.de.ref}: ${falha.message}`)
      throw falha
    }
    rmSync(arqTransicao, { force: true })
    anotar(`[fenix] rollback para ${transicao.de.ref}: ${motivo}`)
    // Não há para onde voltar depois disto, então a falha precisa ser gritada.
    const naoSubiu = await esperarSubida()
    if (naoSubiu) anotar(`[fenix] ATENÇÃO: a versão anterior também falhou: ${naoSubiu}`)
  }

  /** Volta e apaga a branch. O sha fica no registro: é o que permite recuperar. */
  async function descartar(transicao, motivo) {
    await voltar(transicao, motivo)
    await apagarBranch(transicao.para.ref)
    anotar(`[fenix] ${transicao.para.ref} descartada (${transicao.para.sha})`)
  }

  /** Durante o teste: uma queda ou a saúde falhando volta sem esperar ninguém. */
  async function vigiar(transicao) {
    const ticks = Math.max(1, Math.round(vigiaMs / intervaloMs))
    let tick = 0
    let falhas = 0
    while (emTeste === transicao) {
      await dormir(intervaloMs)
      if (emTeste !== transicao || ocupado) continue
      let motivo = queda
      if (!motivo && ++tick >= ticks) {
        tick = 0
        const s = await saude().catch((err) => ({ ok: false, motivo: err.message }))
        falhas = s.ok ? 0 : falhas + 1
        if (falhas >= FALHAS_SEGUIDAS) motivo = `A nova versão parou de responder: ${s.motivo ?? 'sem detalhe'}.`
      }
      if (!motivo || emTeste !== transicao || ocupado) continue
      emTeste = null
      ocupado = true
      try {
        await descartar(transicao, motivo)
        notificar({
          id: transicao.id,
          tipo: 'revertido',
          mensagem: `${motivo} O rollback foi feito e a versão segura voltou ao ar.`,
        })
      } catch (err) {
        notificar({ id: transicao.id, tipo: 'falhou', mensagem: `O rollback falhou: ${err.message}` })
      } finally {
        ocupado = false
      }
    }
  }

  return {
    /** Troca para o commit verificado, confere que subiu e deixa em teste. */
    async aplicar({ id, sha, branch, interfaces = 0 }) {
      if (ocupado || emTeste) return notificar({ id, tipo: 'recusado', mensagem: 'Já há uma troca em andamento.' })
      ocupado = true
      try {
        const recusa = await recusaAplicar({ sha, branch }).catch((err) => err.message)
        if (recusa) return notificar({ id, tipo: 'recusado', mensagem: recusa })

        const transicao = { id, de: await versaoAtual(), para: { ref: branch, sha } }
        writeFileSync(arqTransicao, JSON.stringify(transicao, null, 2))
        anotar(`[fenix] trocando ${transicao.de.ref} por ${branch}`)

        await desligar()
        queda = null
        await trocarPara(transicao.para)
        ligar()

        const motivo = await observar(interfaces > 0)
        if (motivo) {
          await descartar(transicao, motivo)
          return notificar({
            id,
            tipo: 'revertido',
            mensagem: `${motivo} O rollback foi feito e a versão segura voltou ao ar.`,
          })
        }

        emTeste = transicao
        anotar(`[fenix] ${branch} em teste`)
        notificar({ id, tipo: 'em_teste', mensagem: 'A alteração está no ar para você testar.' })
        void vigiar(transicao)
      } catch (err) {
        anotar(`[fenix] falha na troca: ${err.message}`)
        const transicao = lerJson(arqTransicao, null)
        if (transicao) await descartar(transicao, err.message).catch((e) => anotar(`[fenix] ${e.message}`))
        notificar({ id, tipo: 'revertido', mensagem: `A troca falhou: ${err.message}` })
      } finally {
        ocupado = false
      }
    },

    /** O Ricardo gostou: vira a branch definitiva e o A.P.O.L.O. volta à main. */
    async aprovar({ id, branch }) {
      if (ocupado || !emTeste) return notificar({ id, tipo: 'recusado', mensagem: 'Não há alteração em teste.' })
      if (!branchValida(branch)) return notificar({ id, tipo: 'recusado', mensagem: `Branch inválida: ${branch}.` })
      const transicao = emTeste
      ocupado = true
      try {
        if (await git('status', '--porcelain')) {
          return notificar({
            id,
            tipo: 'recusado',
            mensagem: 'A cópia em execução tem alterações não commitadas; nada foi trocado.',
          })
        }
        // Renomear não mexe nos arquivos. Depois disto, a alteração já está salva
        // e uma troca interrompida só precisa voltar, sem apagar nada.
        await git('branch', '-m', transicao.para.ref, branch)
        emTeste = null
        const aprovada = { ...transicao, aprovada: true, para: { ...transicao.para, ref: branch } }
        writeFileSync(arqTransicao, JSON.stringify(aprovada, null, 2))
        anotar(`[fenix] ${transicao.para.ref} aprovada como ${branch}`)

        await voltar(aprovada, 'alteração aprovada')
        notificar({
          id,
          tipo: 'aprovado',
          mensagem: 'Guardei a alteração na branch e voltei à versão segura.',
          branch,
        })
      } catch (err) {
        anotar(`[fenix] falha ao aprovar: ${err.message}`)
        notificar({ id, tipo: 'recusado', mensagem: `Não consegui aprovar: ${err.message}` })
      } finally {
        ocupado = false
      }
    },

    /** O Ricardo não gostou: descarta a alteração e volta à versão segura. */
    async reverter({ id } = {}) {
      if (ocupado) return notificar({ id, tipo: 'recusado', mensagem: 'Há uma troca em andamento.' })
      if (!emTeste) return notificar({ id, tipo: 'recusado', mensagem: 'Já estou na versão segura.' })
      const transicao = emTeste
      ocupado = true
      try {
        if (await git('status', '--porcelain')) {
          return notificar({
            id,
            tipo: 'recusado',
            mensagem: 'A cópia em execução tem alterações não commitadas; nada foi trocado.',
          })
        }
        emTeste = null
        await descartar(transicao, 'pedido do Ricardo')
        notificar({ id, tipo: 'revertido', mensagem: 'A versão segura voltou ao ar.' })
      } catch (err) {
        notificar({ id, tipo: 'falhou', mensagem: `O rollback falhou: ${err.message}` })
      } finally {
        ocupado = false
      }
    },

    /** Uma alteração que não foi aprovada: volta antes de subir qualquer coisa. */
    async recuperar() {
      const transicao = lerJson(arqTransicao, null)
      if (!transicao) return null
      anotar(`[fenix] troca sem aprovação encontrada; voltando para ${transicao.de.ref}`)
      await trocarPara(transicao.de)
      if (!transicao.aprovada) {
        await apagarBranch(transicao.para.ref)
        anotar(`[fenix] ${transicao.para.ref} descartada (${transicao.para.sha})`)
      }
      rmSync(arqTransicao, { force: true })
      return transicao
    },

    /** Um serviço versionado caiu. Devolve true se quem cuida disso é a troca. */
    servicoCaiu(nome, motivo) {
      if (!ocupado && !emTeste) return false
      queda = `O serviço ${nome} caiu: ${motivo}.`
      return true
    },

    /** Em troca ou em teste: a saúde e as quedas são desta parte, não da guardiã. */
    emTroca: () => ocupado || Boolean(emTeste),

    /** Há uma alteração no ar que ninguém revisou? */
    emTeste: () => Boolean(emTeste),

    estado() {
      const t = emTeste ?? lerJson(arqTransicao, null)
      return {
        troca: emTeste ? 'testando' : ocupado ? 'aplicando' : null,
        id: t?.id ?? null,
        branch: t?.para?.ref ?? null,
      }
    },

    /**
     * Traz a versão segura mais nova do remoto e sobe com ela. Se a versão nova
     * não ficar de pé, volta para o commit de antes — a remota continua lá, e a
     * próxima atualização tenta de novo.
     */
    async atualizar() {
      if (ocupado || emTeste) return { ok: false, mensagem: 'Há uma troca em andamento ou uma alteração em teste.' }
      ocupado = true
      try {
        if (await git('status', '--porcelain')) {
          return { ok: false, mensagem: 'A cópia em execução tem alterações não commitadas; nada foi atualizado.' }
        }
        const { ref } = await versaoAtual()
        if (ref !== versaoSegura) {
          return { ok: false, mensagem: `Só atualizo na ${versaoSegura}; agora estou em ${ref}.` }
        }
        const antes = await git('rev-parse', 'HEAD')
        await git('pull', '--ff-only', '--quiet')
        const depois = await git('rev-parse', 'HEAD')
        if (antes === depois) return { ok: true, mensagem: 'Já estava na versão mais nova.' }
        const mudados = (await git('diff', '--name-only', antes, depois)).split('\n').filter(Boolean)
        const reinstalar = instalar && mudados.some((f) => instalar.quando.some((re) => re.test(f)))
        anotar(`[fenix] atualizando ${versaoSegura} de ${antes.slice(0, 7)} para ${depois.slice(0, 7)}`)

        await desligar()
        if (reinstalar) await rodarInstalar()
        queda = null
        ligar()
        const motivo = await observar(false)
        if (!motivo) {
          anotar(`[fenix] ${versaoSegura} atualizada para ${depois.slice(0, 7)}`)
          return {
            ok: true,
            mensagem: `Atualizei de ${antes.slice(0, 7)} para ${depois.slice(0, 7)}, ${mudados.length} arquivos.`,
          }
        }
        await desligar()
        await git('reset', '--hard', '--quiet', antes)
        if (reinstalar) await rodarInstalar()
        queda = null
        ligar()
        anotar(`[fenix] a atualização falhou (${motivo}); de volta a ${antes.slice(0, 7)}`)
        return { ok: false, mensagem: `${motivo} Voltei para a versão de antes, ${antes.slice(0, 7)}.` }
      } catch (err) {
        anotar(`[fenix] falha ao atualizar: ${err.message}`)
        return { ok: false, mensagem: `Não consegui atualizar: ${err.message}` }
      } finally {
        ocupado = false
      }
    },
  }
}
