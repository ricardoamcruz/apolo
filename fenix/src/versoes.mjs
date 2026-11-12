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
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
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

/** Um `git fetch` preso num pedido de senha ou numa rede lenta não segura a Fênix. */
export const PRAZO_GIT_MS = 30_000
export const PRAZO_REDE_MS = 120_000

/** O que o Git deixa em disco quando uma operação ficou pela metade. */
const PENDENTES = [
  ['MERGE_HEAD', 'um merge'],
  ['CHERRY_PICK_HEAD', 'um cherry-pick'],
  ['REVERT_HEAD', 'um revert'],
  ['rebase-merge', 'um rebase'],
  ['rebase-apply', 'um rebase ou um am'],
  ['BISECT_LOG', 'um bisect'],
]

/**
 * O erro de um comando do Git em uma linha legível, com o comando e o motivo, no
 * lugar do "Command failed" do Node com a saída inteira.
 */
export function erroDoGit(args, err) {
  const linhas = String(err.stderr ?? '')
    .split('\n')
    .map((l) => l.replace(/^(fatal|error|erro):\s*/i, '').trim())
    .filter((l) => l && !/^(hint|dica):/i.test(l))
  const motivo = err.killed ? `passou de ${Math.round((err.prazo ?? PRAZO_GIT_MS) / 1000)} s sem terminar` : (linhas[0] ?? err.message)
  const erro = new Error(`git ${args[0]} falhou: ${motivo}`)
  erro.codigo = err.code
  erro.detalhe = linhas.join('\n')
  return erro
}

const real = (caminho) => {
  try {
    return realpathSync(caminho)
  } catch {
    return caminho
  }
}

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

  /**
   * Todo comando do Git roda na pasta do projeto, com prazo e sem perguntar nada
   * no terminal: sem isso, um pedido de senha prende a troca para sempre, calada.
   */
  const gitCom = (prazo) => async (...args) => {
    try {
      const r = await exec('git', args, {
        cwd: repo,
        maxBuffer: 16 * 1024 * 1024,
        timeout: prazo,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', LC_ALL: 'C' },
      })
      return r.stdout.trim()
    } catch (err) {
      err.prazo = prazo
      throw erroDoGit(args, err)
    }
  }
  const git = gitCom(PRAZO_GIT_MS)
  const gitRede = gitCom(PRAZO_REDE_MS)
  const sim = (p) => p.then(() => true, () => false)

  const versaoAtual = async () => {
    const sha = await git('rev-parse', 'HEAD')
    const ref = await git('symbolic-ref', '--short', '-q', 'HEAD').catch(() => sha)
    return { ref, sha }
  }

  const curto = (sha) => String(sha ?? '').slice(0, 7)
  const existeLocal = (ref) => sim(git('show-ref', '--verify', '--quiet', `refs/heads/${ref}`))
  const remotoDe = async (ref) => (await git('config', `branch.${ref}.remote`).catch(() => '')) || 'origin'

  /** Com submódulos, a troca só termina quando eles também estão no commit certo. */
  async function atualizarSubmodulos() {
    if (!existsSync(join(repo, '.gitmodules'))) return
    await gitRede('submodule', 'update', '--init', '--recursive', '--quiet')
  }

  /**
   * A cópia está em condições de trocar de versão? Devolve o motivo exato quando
   * não está, ou null. `alvo` é o commit para onde se vai: arquivos não rastreados
   * só barram a troca quando o alvo traz um arquivo com o mesmo nome, porque aí o
   * Git pararia no meio.
   */
  async function conferirCopia(alvo = null) {
    const dentro = await git('rev-parse', '--is-inside-work-tree').catch(() => '')
    if (dentro !== 'true') return `A pasta ${repo} não é um repositório Git; nada foi trocado.`
    const topo = await git('rev-parse', '--show-toplevel')
    if (real(topo) !== real(repo)) {
      return `A Fênix aponta para ${repo}, mas o repositório começa em ${topo}; confira "repositorio" no fenix.config.json. Nada foi trocado.`
    }
    const caminhoGit = async (nome) => {
      const c = await git('rev-parse', '--git-path', nome)
      return isAbsolute(c) ? c : join(repo, c)
    }
    if (existsSync(await caminhoGit('index.lock'))) {
      return 'Outro processo do Git está usando a cópia (há um index.lock); nada foi trocado.'
    }
    for (const [arquivo, operacao] of PENDENTES) {
      if (existsSync(await caminhoGit(arquivo))) return `A cópia está no meio de ${operacao}; termine ou aborte antes. Nada foi trocado.`
    }
    const sujos = (await git('status', '--porcelain', '--untracked-files=no')).split('\n').filter(Boolean)
    if (sujos.length) {
      const lista = sujos.slice(0, 5).map((l) => l.trim().replace(/^\S{1,2}\s+/, '')).join(', ')
      return `A cópia em execução tem alterações não commitadas (${lista}${sujos.length > 5 ? '...' : ''}); nada foi trocado.`
    }
    if (alvo) {
      const soltos = (await git('ls-files', '--others', '--exclude-standard')).split('\n').filter(Boolean)
      if (soltos.length) {
        const doAlvo = new Set((await git('ls-tree', '-r', '--name-only', alvo)).split('\n'))
        const batem = soltos.filter((f) => doAlvo.has(f))
        if (batem.length) {
          return `Arquivos não rastreados seriam sobrescritos (${batem.slice(0, 5).join(', ')}); guarde-os ou apague antes. Nada foi trocado.`
        }
      }
    }
    return null
  }

  /**
   * Troca e confere: no fim, HEAD tem de estar na branch pedida (e no commit
   * pedido, com `conferirSha`). Branch que só existe no remoto vira uma local que
   * o acompanha; branch que não existe em lugar nenhum é erro, antes de mexer.
   */
  async function trocarPara({ ref, sha }, { conferirSha = true } = {}) {
    if (ref === sha) {
      await git('switch', '--quiet', '--detach', sha)
    } else if (await existeLocal(ref)) {
      await git('switch', '--quiet', ref)
    } else {
      const remoto = await remotoDe(ref)
      if (!(await sim(git('show-ref', '--verify', '--quiet', `refs/remotes/${remoto}/${ref}`)))) {
        throw new Error(`a branch ${ref} não existe nesta cópia nem em ${remoto}`)
      }
      await git('switch', '--quiet', '--create', ref, '--track', `${remoto}/${ref}`)
    }
    await atualizarSubmodulos()
    const agora = await versaoAtual()
    if (agora.ref !== ref || (conferirSha && sha && agora.sha !== sha)) {
      throw new Error(`pedi ${ref} (${curto(sha)}), mas a cópia ficou em ${agora.ref} (${curto(agora.sha)})`)
    }
    return agora
  }

  /** Ocupado com uma troca: a saída da ponte é esperada ou já está em análise. */
  let ocupado = false
  /** Motivo pelo qual a ponte caiu durante a observação ou o teste. */
  let queda = null
  /** A transição que aguarda a avaliação do Ricardo. */
  let emTeste = null

  async function rodarInstalar() {
    const [comando, ...args] = instalar.comando
    try {
      await exec(comando, args, { cwd: repo, maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60_000 })
    } catch (err) {
      const ultima = String(err.stderr ?? '').trim().split('\n').pop()
      const como = err.killed ? 'passou de 15 min' : `saiu com ${err.code ?? err.signal ?? '?'}`
      throw new Error(`a reinstalação (${instalar.comando.join(' ')}) ${como}${ultima ? `: ${ultima}` : ''}`)
    }
  }

  const apagarBranch = (ref) => git('branch', '-D', ref).catch(() => {})

  async function recusaAplicar({ sha, branch }) {
    // Nome que o Git leria como opção (começando por "-") nunca chega à linha de comando.
    if (!/^\w[\w./-]*$/.test(String(branch ?? '')) || String(branch).includes('..')) {
      return `Branch inválida: ${branch}; nada foi trocado.`
    }
    if (!/^[0-9a-f]{7,40}$/i.test(String(sha ?? ''))) return 'A alteração veio sem um commit válido; nada foi trocado.'
    if (!(await sim(git('cat-file', '-e', `${sha}^{commit}`)))) {
      return `O commit ${curto(sha)} não existe nesta cópia; nada foi trocado.`
    }
    const copia = await conferirCopia(sha)
    if (copia) return copia
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
    // A main pode ter andado enquanto a alteração estava em teste: confere a branch.
    await trocarPara(transicao.de, { conferirSha: false }).catch((err) => (falha = err))
    queda = null
    ligar()
    if (falha) {
      // transicao.json fica em disco: a próxima partida tenta voltar de novo.
      anotar(`[fenix] ATENÇÃO: não consegui voltar para ${transicao.de.ref}: ${falha.message}`)
      throw new Error(`não consegui voltar para ${transicao.de.ref}: ${falha.message}`)
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
        let rollback = null
        if (transicao) await descartar(transicao, err.message).catch((e) => (rollback = e))
        if (rollback) {
          // A pior notícia não pode chegar disfarçada de "voltei": quem pediu precisa agir.
          notificar({
            id,
            tipo: 'falhou',
            mensagem: `A troca falhou (${err.message}) e o rollback também (${rollback.message}). Rode npm run rollback com tudo parado.`,
          })
        } else {
          notificar({ id, tipo: 'revertido', mensagem: `A troca falhou: ${err.message}. A versão segura voltou ao ar.` })
        }
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
        const copia = await conferirCopia(transicao.de.sha)
        if (copia) return notificar({ id, tipo: 'recusado', mensagem: copia })
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
        const copia = await conferirCopia(transicao.de.sha)
        if (copia) return notificar({ id, tipo: 'recusado', mensagem: copia })
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
      const copia = await conferirCopia(transicao.de.sha)
      if (copia) throw new Error(`não consegui voltar para ${transicao.de.ref}: ${copia}`)
      await trocarPara(transicao.de, { conferirSha: false })
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
     *
     * Em etapas, uma depois da outra, e cada uma conferida: busca, confere que dá
     * para avançar sem merge, troca, confere o commit, reinstala se precisar, sobe
     * e observa. Qualquer falha no caminho volta ao commit de antes e religa os
     * serviços: a cópia nunca fica no meio, e a resposta diz o motivo exato.
     */
    async atualizar() {
      if (ocupado || emTeste) return { ok: false, mensagem: 'Há uma troca em andamento ou uma alteração em teste.' }
      ocupado = true
      let antes = null
      let desligados = false
      let mexeu = false
      let reinstalar = false
      const recusa = (mensagem) => {
        anotar(`[fenix] atualização recusada: ${mensagem}`)
        return { ok: false, mensagem }
      }
      const religar = () => {
        queda = null
        ligar()
        desligados = false
      }
      /** Volta ao commit de antes; nunca deixa a troca pela metade. */
      const restaurar = async () => {
        if (!desligados) {
          await desligar()
          desligados = true
        }
        await git('reset', '--hard', '--quiet', antes)
        await atualizarSubmodulos()
        const agora = await git('rev-parse', 'HEAD')
        if (agora !== antes) throw new Error(`a cópia ficou em ${curto(agora)}, e não em ${curto(antes)}`)
        if (reinstalar) await rodarInstalar().catch((err) => anotar(`[fenix] ATENÇÃO: a reinstalação da versão anterior falhou: ${err.message}`))
      }
      try {
        const copia = await conferirCopia()
        if (copia) return recusa(copia.replace('nada foi trocado', 'nada foi atualizado').replace('Nada foi trocado', 'Nada foi atualizado'))
        const { ref, sha } = await versaoAtual()
        if (ref === sha) return recusa(`A cópia está com HEAD destacado em ${curto(sha)}; só atualizo na ${versaoSegura}.`)
        if (ref !== versaoSegura) return recusa(`Só atualizo na ${versaoSegura}; agora estou em ${ref}.`)
        antes = sha

        const remoto = await remotoDe(versaoSegura)
        const ramo = (await git('config', `branch.${versaoSegura}.merge`).catch(() => '')).replace(/^refs\/heads\//, '') || versaoSegura
        if (!(await git('remote').catch(() => '')).split('\n').includes(remoto)) {
          return recusa(`A cópia não tem o remoto ${remoto}; nada foi atualizado.`)
        }
        await gitRede('fetch', '--prune', '--quiet', remoto)
        const depois = await git('rev-parse', '--verify', '--quiet', `refs/remotes/${remoto}/${ramo}^{commit}`).catch(() => '')
        if (!depois) return recusa(`O remoto ${remoto} não tem a branch ${ramo}; nada foi atualizado.`)
        if (depois === antes) return { ok: true, mensagem: 'Já estava na versão mais nova.' }
        if (!(await sim(git('merge-base', '--is-ancestor', antes, depois)))) {
          const aFrente = await sim(git('merge-base', '--is-ancestor', depois, antes))
          return recusa(
            aFrente
              ? `A ${versaoSegura} local tem commits que ${remoto}/${ramo} não tem; nada foi atualizado.`
              : `A ${versaoSegura} local e ${remoto}/${ramo} divergiram; resolva à mão. Nada foi atualizado.`,
          )
        }
        // Conferido de novo com o alvo: um arquivo solto com o nome de um que chega para a troca no meio.
        const colisao = await conferirCopia(depois)
        if (colisao) return recusa(colisao.replace('Nada foi trocado', 'Nada foi atualizado'))

        const mudados = (await git('diff', '--name-only', antes, depois)).split('\n').filter(Boolean)
        reinstalar = Boolean(instalar && mudados.some((f) => instalar.quando.some((re) => re.test(f))))
        anotar(`[fenix] atualizando ${versaoSegura} de ${curto(antes)} para ${curto(depois)}`)

        await desligar()
        desligados = true
        mexeu = true
        await git('merge', '--ff-only', '--quiet', depois)
        await atualizarSubmodulos()
        const agora = await git('rev-parse', 'HEAD')
        if (agora !== depois) throw new Error(`a cópia ficou em ${curto(agora)}, e não em ${curto(depois)}`)
        if (reinstalar) await rodarInstalar()
        religar()

        const motivo = await observar(false)
        if (!motivo) {
          anotar(`[fenix] ${versaoSegura} atualizada para ${curto(depois)}`)
          return { ok: true, mensagem: `Atualizei de ${curto(antes)} para ${curto(depois)}, ${mudados.length} arquivos.` }
        }
        await restaurar()
        religar()
        anotar(`[fenix] a atualização falhou (${motivo}); de volta a ${curto(antes)}`)
        return { ok: false, mensagem: `${motivo} Voltei para a versão de antes, ${curto(antes)}.` }
      } catch (err) {
        anotar(`[fenix] falha ao atualizar: ${err.message}`)
        if (!mexeu) return { ok: false, mensagem: `Não consegui atualizar: ${err.message}. Nada foi trocado.` }
        try {
          await restaurar()
          anotar(`[fenix] de volta a ${curto(antes)} depois da falha`)
          return { ok: false, mensagem: `Não consegui atualizar: ${err.message}. Voltei para a versão de antes, ${curto(antes)}.` }
        } catch (falha) {
          anotar(`[fenix] ATENÇÃO: não consegui voltar para ${curto(antes)}: ${falha.message}`)
          return {
            ok: false,
            mensagem: `Não consegui atualizar (${err.message}) nem voltar para ${curto(antes)} (${falha.message}). Confira a cópia com git status.`,
          }
        }
      } finally {
        // Nenhum caminho deixa os serviços desligados.
        if (desligados) religar()
        ocupado = false
      }
    },
  }
}
