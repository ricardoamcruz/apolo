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
 *   aprovada   → vira um commit da branch de trabalho, que continua no ar
 *                (docs/adr/0031): a branch de onde ela partiu, ou uma fase-x.y/nome
 *                nova quando ela partiu da versão segura, que nunca recebe commit direto
 *   descartada → a branch some e o projeto volta à versão de onde ela partiu
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

/** O que a voz pode registrar no eventos.log sobre uma troca que não chegou à Fênix. */
const RECUSAS_DA_VOZ = {
  'sim-nao-ouvido': 'o sim do Ricardo não apareceu na transcrição do microfone depois da prévia.',
  'previa-vencida': 'a prévia passou de 3 minutos sem o sim; uma nova foi lida.',
}

/** Um `git fetch` preso num pedido de senha ou numa rede lenta não segura a Fênix. */
export const PRAZO_GIT_MS = 30_000
export const PRAZO_REDE_MS = 120_000
export const PRAZO_BUSCA_MS = 15_000

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
  aoTrocar = () => {},
  quedasParaVoltar = 3,
  janelaDeQuedasMs = 5 * 60_000,
  // Rodando da cópia congelada da âncora (docs/adr/0041): não há repositório para trocar.
  versaoFixa = false,
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

  const FIXA =
    'Estou rodando da cópia congelada da âncora, porque o repositório não estava utilizável: daqui não troco ' +
    'de versão. Conserte o repositório e rode ancora --sair.'

  /**
   * A noite autorizada pelo Ricardo (docs/adr/0040): até quando a Fênix aceita pôr
   * no ar, sem revisão, alteração que toca arquivo sensível. O que está em
   * `nuncaDeNoite` continua barrado. Em disco, porque ela pode renascer no meio.
   */
  const arqNoite = join(pasta, 'noite.json')
  const FOLGA_DA_NOITE_MS = 30 * 60_000
  const noiteAtiva = () => {
    const n = lerJson(arqNoite, null)
    return Boolean(n && Number(n.ate) > 0 && Date.now() < Number(n.ate) + FOLGA_DA_NOITE_MS)
  }

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
  /** A prévia de uma troca é pergunta falada: sem rede, segue com o que tem, sem esperar dois minutos. */
  const gitBusca = gitCom(PRAZO_BUSCA_MS)
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
   * Esquece as cópias de trabalho (`git worktree`) cuja pasta já não existe. O Git
   * guarda o registro delas e continua achando que a branch está aberta lá: foi o
   * que travou a troca para a fase-3.5 em 27/11/2026. Só some o que não tem pasta;
   * uma cópia de verdade, com arquivos, fica como está.
   */
  async function limparCopiasOrfas() {
    // O `prune --verbose` fala no stderr; a lista em porcelana marca as órfãs com "prunable".
    const orfas = []
    let pasta = null
    for (const linha of (await git('worktree', 'list', '--porcelain').catch(() => '')).split('\n')) {
      if (linha.startsWith('worktree ')) pasta = linha.slice('worktree '.length)
      else if (linha.startsWith('prunable') && pasta) orfas.push(pasta)
    }
    if (!orfas.length) return
    await git('worktree', 'prune')
    anotar(`[fenix] esqueci ${orfas.length} ${orfas.length === 1 ? 'cópia de trabalho' : 'cópias de trabalho'} sem pasta: ${orfas.join(', ')}`)
  }

  /** A pasta de outra cópia de trabalho com a branch aberta, ou null: o Git não deixa abrir a mesma branch em duas. */
  async function copiaComABranch(branch) {
    const linhas = (await git('worktree', 'list', '--porcelain').catch(() => '')).split('\n')
    let pasta = null
    for (const linha of linhas) {
      if (linha.startsWith('worktree ')) pasta = linha.slice('worktree '.length)
      else if (linha === `branch refs/heads/${branch}` && pasta && real(pasta) !== real(repo)) return pasta
    }
    return null
  }

  /**
   * Troca e confere: no fim, HEAD tem de estar na branch pedida (e no commit
   * pedido, com `conferirSha`). Branch que só existe no remoto vira uma local que
   * o acompanha; branch que não existe em lugar nenhum é erro, antes de mexer.
   */
  async function trocarPara({ ref, sha }, { conferirSha = true } = {}) {
    await limparCopiasOrfas()
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

  async function recusaAplicar({ sha, branch, noturno = false }) {
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
    const deNoite = noturno && noiteAtiva()
    if (deNoite) {
      const travas = nomes.filter((f) => (protecao.nuncaDeNoite ?? []).some((re) => re.test(f)))
      if (travas.length) return `A alteração toca o que nem o modo noturno muda (${travas.join(', ')}); exige o Ricardo.`
    }
    if (revisao.length && !deNoite) {
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
  async function observar(exigirInterface, duracaoMs = estabilidadeMs) {
    const naoSubiu = await esperarSubida()
    if (naoSubiu) return naoSubiu
    let interfaceVoltou = false
    let falhas = 0
    const fim = Date.now() + duracaoMs
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

  /** A última troca de branch (docs/adr/0038): quem chega depois do reinício fica sabendo. */
  let ultimaTroca = null
  /** Quando a ponte caiu fora de uma troca: muitas seguidas numa branch de fase voltam à segura. */
  let quedasForaDaTroca = []

  /** As branches que dá para pôr no ar: as locais e as do remoto, sem repetir. */
  async function branchesConhecidas(remoto) {
    const locais = (await git('for-each-ref', '--format=%(refname:short)', 'refs/heads').catch(() => '')).split('\n')
    const remotas = (await git('for-each-ref', '--format=%(refname:short)', `refs/remotes/${remoto}`).catch(() => ''))
      .split('\n')
      .map((r) => r.slice(remoto.length + 1))
    return [...new Set([...locais, ...remotas])].filter((b) => b && b !== 'HEAD' && (b === versaoSegura || branchValida(b)))
  }

  /** As de fase mais recentes, para dizer o que existe quando o pedido não bate. */
  async function recentes(remoto, n = 4) {
    const linhas = await git(
      'for-each-ref',
      '--sort=-committerdate',
      '--format=%(refname:short)',
      'refs/heads',
      `refs/remotes/${remoto}`,
    ).catch(() => '')
    const nomes = linhas.split('\n').map((r) => (r.startsWith(`${remoto}/`) ? r.slice(remoto.length + 1) : r))
    return [...new Set(nomes)].filter((b) => branchValida(b)).slice(0, n)
  }

  /**
   * O que foi pedido, falado como sai da boca: "main", "3.4", "fase-3.4", o nome
   * inteiro ou só a parte criativa ("aurora-no-bolso"). Devolve a branch ou o motivo.
   */
  async function resolverBranch(pedido, remoto) {
    const p = String(pedido ?? '').trim().toLowerCase().replace(/^origin\//, '').replace(/^refs\/heads\//, '')
    if (!p) return { motivo: 'Diga para qual branch trocar.' }
    if (p === versaoSegura) return { branch: versaoSegura }
    const todas = await branchesConhecidas(remoto)
    if (todas.includes(p)) return { branch: p }
    const numero = p.match(/^(?:fase[-\s]?)?(\d+(?:\.\d+)*)$/)?.[1]
    const achadas = numero
      ? todas.filter((b) => b.startsWith(`fase-${numero}/`))
      : todas.filter((b) => b !== versaoSegura && (b.endsWith(`/${p}`) || b.startsWith(`${p}/`)))
    if (achadas.length === 1) return { branch: achadas[0] }
    if (achadas.length > 1) return { motivo: `Há mais de uma branch para "${pedido}": ${achadas.join(', ')}. Diga qual.` }
    const existem = await recentes(remoto)
    return {
      motivo: `Não há branch "${pedido}" nesta cópia nem no ${remoto}.${existem.length ? ` As mais recentes: ${existem.join(', ')}.` : ''} Nada foi trocado.`,
    }
  }

  /**
   * O plano de uma troca de branch, antes de mexer em qualquer coisa: para onde
   * vai, em que commit, o que muda e o que ninguém revisou. A branch local que
   * está atrás da do remoto avança junto, só se der sem merge.
   */
  async function planejarTroca(pedido, { buscar = true } = {}) {
    if (ocupado || emTeste) {
      return { motivo: emTeste ? 'Há uma alteração em teste no ar: aprove ou descarte antes de trocar de branch.' : 'Já há uma troca em andamento.' }
    }
    const copia = await conferirCopia()
    if (copia) return { motivo: copia }
    const remoto = await remotoDe(versaoSegura)
    let semRede = false
    if (buscar && (await git('remote').catch(() => '')).split('\n').includes(remoto)) {
      await gitBusca('fetch', '--prune', '--quiet', remoto).catch(() => (semRede = true))
    }
    const { branch, motivo } = await resolverBranch(pedido, remoto)
    if (!branch) return { motivo }
    const atual = await versaoAtual()
    if (atual.ref !== branch) {
      // Antes de prometer a troca: o Git recusa abrir uma branch que outra cópia já abriu.
      await limparCopiasOrfas()
      const outra = await copiaComABranch(branch)
      if (outra) {
        return {
          motivo:
            `A ${branch} está aberta em outra cópia de trabalho do Git (${outra}), e o Git não abre a mesma branch em duas. ` +
            `Feche essa cópia (git worktree remove ${outra}) e peça de novo. Nada foi trocado.`,
        }
      }
    }
    const sha = async (ref) => git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`).catch(() => '')
    const local = await sha(`refs/heads/${branch}`)
    const doRemoto = await sha(`refs/remotes/${remoto}/${branch}`)
    let alvo = local || doRemoto
    let avancar = false
    if (local && doRemoto && local !== doRemoto && (await sim(git('merge-base', '--is-ancestor', local, doRemoto)))) {
      alvo = doRemoto
      avancar = true
    }
    const plano = { branch, sha: alvo, de: atual, remoto, avancar, criar: !local, semRede }
    if (atual.ref === branch && atual.sha === alvo) return { ...plano, mesma: true }
    if (atual.ref === branch) {
      // Já no ar, só atrás do remoto: avança no lugar, como numa atualização.
      plano.avancar = true
    }
    const colisao = await conferirCopia(alvo)
    if (colisao) return { motivo: colisao }
    const nomes = (await git('diff', '--name-only', atual.sha, alvo)).split('\n').filter(Boolean)
    plano.mudados = nomes
    // O que a versão segura não tem e ninguém revisou: é o que ele precisa ouvir antes do sim.
    const base = await sha(`refs/heads/${versaoSegura}`) || await sha(`refs/remotes/${remoto}/${versaoSegura}`)
    const desdeASegura = base && branch !== versaoSegura
      ? (await git('diff', '--name-only', `${base}...${alvo}`).catch(() => '')).split('\n').filter(Boolean)
      : []
    const { revisao, quebrados } = await barrados(protecao, desdeASegura, (f) => git('show', `${alvo}:${f}`))
    plano.sensiveis = [...new Set([...revisao, ...quebrados])]
    plano.aFrente = base && branch !== versaoSegura ? Number(await git('rev-list', '--count', `${base}..${alvo}`).catch(() => 0)) : 0
    plano.ultimo = await git('log', '-1', '--format=%s', alvo).catch(() => '')
    return plano
  }

  /** O plano em frases, para a voz ler antes de pedir o sim. */
  function textoDoPlano(p) {
    const onde = (o) => (o.ref === o.sha ? `um commit solto (${curto(o.sha)})` : `a ${o.ref}`)
    const de = p.de.ref === p.de.sha ? `de um commit solto (${curto(p.de.sha)})` : `da ${p.de.ref}`
    // A mesma branch, só atrás do remoto: é trazer a mais nova, não trocar.
    if (p.de.ref === p.branch) {
      return (
        `Trazer a ${p.branch}, que já está no ar, para o commit mais novo do ${p.remoto}${p.ultimo ? ` (último: "${p.ultimo}")` : ''}. ` +
        `A ponte reinicia; se não ficar de pé, volto para o commit de agora.`
      )
    }
    const partes = [`Trocar ${de} para a ${p.branch}`]
    if (p.branch !== versaoSegura) {
      partes[0] += p.aFrente ? `, ${p.aFrente} ${p.aFrente === 1 ? 'commit' : 'commits'} à frente da ${versaoSegura}` : ''
      if (p.ultimo) partes[0] += ` (último: "${p.ultimo}")`
    }
    partes[0] += '.'
    if (p.criar) partes.push(`Ela só existe no ${p.remoto}; trago de lá.`)
    else if (p.avancar) partes.push(`A cópia local estava atrás do ${p.remoto} e avança junto.`)
    if (p.semRede) partes.push(`Não alcancei o ${p.remoto}: vou com o que há nesta máquina.`)
    if (p.sensiveis?.length) {
      partes.push(`Ela muda arquivos sensíveis que não entraram na ${versaoSegura}: ${p.sensiveis.slice(0, 6).join(', ')}${p.sensiveis.length > 6 ? '...' : ''}.`)
    }
    partes.push(`A ponte reinicia na troca; se a ${p.branch} não ficar de pé, volto sozinha para ${onde(p.de)}.`)
    return partes.join(' ')
  }

  /** Volta para onde a troca partiu, e reinstala se ela tinha reinstalado. */
  async function voltarDaTroca(de, reinstalou) {
    await desligar()
    const agora = await versaoAtual()
    // A mesma branch, que avançou no lugar: voltar pelo nome a deixaria no commit novo.
    if (de.ref !== de.sha && agora.ref === de.ref) {
      await git('reset', '--hard', '--quiet', de.sha)
      await atualizarSubmodulos()
    } else {
      await trocarPara(de, { conferirSha: false })
    }
    if (reinstalou) await rodarInstalar().catch((err) => anotar(`[fenix] ATENÇÃO: a reinstalação da versão anterior falhou: ${err.message}`))
  }

  /** A troca em si: chamada com `ocupado` já marcado, nunca deixa os serviços desligados. */
  async function executarTroca(id, plano, motivoDaTroca) {
    const { branch, sha, de } = plano
    const onde = (o) => (o.ref === o.sha ? `o commit solto ${curto(o.sha)}` : `a ${o.ref}`)
    const transicao = { id, troca: true, de, para: { ref: branch, sha } }
    let desligados = false
    let mexeu = false
    let reinstalar = false
    const fim = (ok, mensagem) => {
      ultimaTroca = { id, ok, mensagem, branch: ok ? branch : de.ref, de: de.ref, para: branch, em: Date.now() }
      // De onde e para onde vão junto: a voz diz uma frase diferente para cada caso.
      return { ...ultimaTroca }
    }
    try {
      writeFileSync(arqTransicao, JSON.stringify(transicao, null, 2))
      anotar(`[fenix] trocando ${onde(de)} pela ${branch} (${curto(sha)})${motivoDaTroca ? `: ${motivoDaTroca}` : ''}`)
      await desligar()
      desligados = true
      mexeu = true
      if (de.ref === branch) {
        await git('merge', '--ff-only', '--quiet', sha)
      } else {
        // A branch local atrás do remoto avança antes, sem merge: não é a que está no ar.
        if (plano.avancar && !plano.criar) await git('branch', '--force', branch, sha)
        await trocarPara({ ref: branch, sha })
      }
      await atualizarSubmodulos()
      const agora = await versaoAtual()
      if (agora.ref !== branch || agora.sha !== sha) {
        throw new Error(`a cópia ficou em ${agora.ref} (${curto(agora.sha)}), e não em ${branch} (${curto(sha)})`)
      }
      reinstalar = Boolean(instalar && (plano.mudados ?? []).some((f) => instalar.quando.some((re) => re.test(f))))
      if (reinstalar) await rodarInstalar()
      queda = null
      ligar()
      desligados = false
      const motivo = await observar(plano.interfaces > 0)
      if (!motivo) {
        rmSync(arqTransicao, { force: true })
        quedasForaDaTroca = []
        anotar(`[fenix] ${branch} no ar (${curto(sha)}); antes estava ${onde(de)}`)
        const guardada = de.ref !== de.sha && de.ref !== branch ? ` A ${de.ref} continua guardada.` : ''
        return fim(true, `A ${branch} está no ar.${guardada}`)
      }
      anotar(`[fenix] a ${branch} não ficou de pé (${motivo}); voltando para ${onde(de)}`)
      await voltarDaTroca(de, reinstalar)
      queda = null
      ligar()
      rmSync(arqTransicao, { force: true })
      const naoSubiu = await esperarSubida()
      if (naoSubiu) anotar(`[fenix] ATENÇÃO: a versão anterior também falhou: ${naoSubiu}`)
      return fim(false, `${motivo} Voltei para ${onde(de)}, que segue no ar; a ${branch} continua guardada.`)
    } catch (err) {
      anotar(`[fenix] falha na troca para ${branch}: ${err.message}`)
      if (!mexeu) {
        rmSync(arqTransicao, { force: true })
        return fim(false, `Não consegui trocar para a ${branch}: ${err.message}. Nada foi trocado.`)
      }
      try {
        await voltarDaTroca(de, reinstalar)
        rmSync(arqTransicao, { force: true })
        anotar(`[fenix] de volta para ${onde(de)} depois da falha`)
        return fim(false, `Não consegui trocar para a ${branch}: ${err.message}. Voltei para ${onde(de)}.`)
      } catch (falha) {
        // transicao.json fica: a próxima partida tenta voltar de novo.
        anotar(`[fenix] ATENÇÃO: não consegui voltar para ${onde(de)}: ${falha.message}`)
        return fim(false, `Não consegui trocar para a ${branch} (${err.message}) nem voltar para ${onde(de)} (${falha.message}). Confira a cópia com git status.`)
      }
    } finally {
      queda = null
      if (desligados) ligar()
    }
  }

  /**
   * Muitas quedas da ponte numa branch de fase, fora de qualquer troca: a versão
   * está quebrada e a voz, muda, então ninguém consegue pedir a volta. A Fênix
   * volta sozinha à versão segura (docs/adr/0038).
   */
  function quedaForaDaTroca(nome, motivo) {
    const agora = Date.now()
    quedasForaDaTroca = [...quedasForaDaTroca.filter((t) => agora - t < janelaDeQuedasMs), agora]
    if (quedasForaDaTroca.length < quedasParaVoltar) return
    quedasForaDaTroca = []
    void (async () => {
      const { ref } = await versaoAtual().catch(() => ({ ref: versaoSegura }))
      if (ref === versaoSegura || ocupado || emTeste) return
      // A frase vai ao aviso; o motivo técnico (o código de saída) fica só no log.
      const porque = `O serviço ${nome} caiu ${quedasParaVoltar} vezes em ${Math.round(janelaDeQuedasMs / 60_000)} min na ${ref}.`
      const plano = await planejarTroca(versaoSegura, { buscar: false }).catch((err) => ({ motivo: err.message }))
      if (!plano.branch || plano.mesma || ocupado || emTeste) {
        if (plano.motivo) anotar(`[fenix] ATENÇÃO: ${porque} Não consegui voltar à ${versaoSegura}: ${plano.motivo}`)
        return
      }
      ocupado = true
      try {
        const r = await executarTroca(`queda-${agora}`, plano, `${porque} Último motivo: ${motivo}`)
        const aviso = { ...r, automatica: true, mensagem: r.ok ? `${porque} Voltei para a ${versaoSegura}; a ${ref} continua guardada.` : r.mensagem }
        // O estado conta o mesmo que o aviso: a interface que reconectar depois anuncia a volta sozinha.
        ultimaTroca = { ...ultimaTroca, automatica: true, mensagem: aviso.mensagem }
        aoTrocar(aviso)
      } finally {
        ocupado = false
      }
    })()
  }

  return {
    /**
     * O que uma troca de branch faria, sem fazer (docs/adr/0038). `confirmar` diz
     * se ela precisa do sim falado do Ricardo: só voltar à versão segura não precisa.
     */
    async previa({ branch } = {}) {
      // Toda prévia fica no eventos.log, com o que foi dito: numa falha, o motivo está lá.
      const registrar = (r) => (anotar(`[fenix] prévia da troca para "${branch ?? ''}": ${r.ok ? '' : 'recusada: '}${r.mensagem}`), r)
      if (versaoFixa) return registrar({ ok: false, mensagem: FIXA })
      try {
        const p = await planejarTroca(branch)
        if (!p.branch) return registrar({ ok: false, mensagem: p.motivo })
        if (p.mesma) return registrar({ ok: true, mesma: true, branch: p.branch, sha: p.sha, mensagem: `Já estou na ${p.branch}, no commit mais novo que conheço.` })
        return registrar({
          ok: true,
          branch: p.branch,
          sha: p.sha,
          sensiveis: p.sensiveis,
          confirmar: p.branch !== versaoSegura,
          mensagem: textoDoPlano(p),
        })
      } catch (err) {
        return registrar({ ok: false, mensagem: `Não consegui preparar a troca: ${err.message}. Nada foi trocado.` })
      }
    },

    /**
     * Põe no ar uma branch que já existe (a segura ou uma de fase). Responde já, com
     * a troca começando ou o motivo de não começar; o fim chega em `concluida`,
     * porque a ponte que pediu reinicia no meio. `sha` é o da prévia: se a branch
     * andou depois dela, a troca não acontece sem uma prévia nova.
     */
    async trocar({ id = `troca-${Date.now()}`, branch, sha, interfaces = 0 } = {}) {
      const recusa = (mensagem) => {
        anotar(`[fenix] troca para "${branch ?? ''}" recusada: ${mensagem}`)
        return { ok: false, mensagem }
      }
      if (versaoFixa) return recusa(FIXA)
      let plano
      try {
        plano = await planejarTroca(branch, { buscar: false })
      } catch (err) {
        return recusa(`Não consegui preparar a troca: ${err.message}. Nada foi trocado.`)
      }
      if (!plano.branch) return recusa(plano.motivo)
      if (sha && plano.sha !== sha) {
        return recusa(`A ${plano.branch} mudou desde a prévia (agora em ${curto(plano.sha)}); peça a troca de novo. Nada foi trocado.`)
      }
      if (plano.mesma) return { ok: true, mesma: true, mensagem: `Já estou na ${plano.branch}.` }
      if (ocupado || emTeste) return recusa('Já há uma troca em andamento.')
      ocupado = true
      const concluida = executarTroca(id, { ...plano, interfaces }).finally(() => (ocupado = false))
      return { ok: true, id, mensagem: `Trocando para a ${plano.branch}; a ponte reinicia e eu volto em instantes.`, concluida }
    },

    /**
     * O que a voz decidiu sem chegar à Fênix (o sim que não foi ouvido), para o
     * eventos.log contar a história inteira. Só códigos conhecidos viram frase: o
     * log nunca recebe texto livre de fora.
     */
    registrarDaVoz({ codigo, branch } = {}) {
      const frase = RECUSAS_DA_VOZ[codigo]
      if (!frase) return { ok: false, mensagem: 'Código desconhecido; nada foi registrado.' }
      const nome = branchValida(branch) || branch === versaoSegura ? branch : '?'
      anotar(`[fenix] troca para "${nome}" parada na voz: ${frase}`)
      return { ok: true, mensagem: 'Registrado.' }
    },

    /** Troca para o commit verificado, confere que subiu e deixa em teste. */
    async aplicar({ id, sha, branch, interfaces = 0, noturno = false, observarMs = 0 }) {
      if (versaoFixa) return notificar({ id, tipo: 'recusado', mensagem: FIXA })
      if (ocupado || emTeste) return notificar({ id, tipo: 'recusado', mensagem: 'Já há uma troca em andamento.' })
      ocupado = true
      try {
        const recusa = await recusaAplicar({ sha, branch, noturno }).catch((err) => err.message)
        if (recusa) return notificar({ id, tipo: 'recusado', mensagem: recusa })

        const transicao = { id, de: await versaoAtual(), para: { ref: branch, sha } }
        writeFileSync(arqTransicao, JSON.stringify(transicao, null, 2))
        anotar(`[fenix] trocando ${transicao.de.ref} por ${branch}`)

        await desligar()
        queda = null
        await trocarPara(transicao.para)
        ligar()

        // De noite ninguém testa: a observação vale mais (docs/adr/0040), até 10 min.
        const duracao = Math.min(Math.max(Number(observarMs) || 0, estabilidadeMs), 10 * 60_000)
        const motivo = await observar(interfaces > 0, duracao)
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

    /**
     * O Ricardo gostou: a alteração vira um commit da branch de trabalho, e é ela
     * que fica no ar (docs/adr/0031). O próximo pedido parte dali e soma outro commit.
     *
     *   `branch` igual à de onde a alteração partiu → a branch avança até o commit
     *   `branch` nova (a alteração partiu da versão segura) → a de teste é renomeada
     *
     * Os arquivos não mudam: o que está no ar já é o commit aprovado. Por isso não há
     * reinício, e nada do que ele está usando cai.
     */
    async aprovar({ id, branch }) {
      if (ocupado || !emTeste) return notificar({ id, tipo: 'recusado', mensagem: 'Não há alteração em teste.' })
      if (!branchValida(branch)) return notificar({ id, tipo: 'recusado', mensagem: `Branch inválida: ${branch}.` })
      if (branch === versaoSegura) {
        return notificar({ id, tipo: 'recusado', mensagem: `A ${versaoSegura} não recebe commit direto: só por pull request.` })
      }
      const transicao = emTeste
      ocupado = true
      try {
        const copia = await conferirCopia(transicao.para.sha)
        if (copia) return notificar({ id, tipo: 'recusado', mensagem: copia })
        const integrar = branch === transicao.de.ref
        if (integrar && !(await sim(git('merge-base', '--is-ancestor', branch, transicao.para.sha)))) {
          return notificar({ id, tipo: 'recusado', mensagem: `A ${branch} andou enquanto a alteração estava em teste; nada foi trocado.` })
        }
        if (!integrar && (await existeLocal(branch))) {
          return notificar({ id, tipo: 'recusado', mensagem: `Já existe uma branch ${branch}; nada foi trocado.` })
        }
        // Gravado antes de mexer: uma queda no meio volta sem apagar o que foi aprovado.
        const aprovada = { ...transicao, aprovada: true, para: { ...transicao.para, ref: branch } }
        writeFileSync(arqTransicao, JSON.stringify(aprovada, null, 2))
        if (integrar) {
          await git('branch', '--force', branch, transicao.para.sha)
          await trocarPara({ ref: branch, sha: transicao.para.sha })
          await apagarBranch(transicao.para.ref)
        } else {
          await git('branch', '-m', transicao.para.ref, branch)
          const agora = await versaoAtual()
          if (agora.ref !== branch || agora.sha !== transicao.para.sha) {
            throw new Error(`pedi ${branch} (${curto(transicao.para.sha)}), mas a cópia ficou em ${agora.ref} (${curto(agora.sha)})`)
          }
        }
        emTeste = null
        rmSync(arqTransicao, { force: true })
        anotar(`[fenix] ${transicao.para.ref} aprovada: commit ${curto(transicao.para.sha)} em ${branch}, que segue no ar`)
        notificar({
          id,
          tipo: 'aprovado',
          mensagem: integrar
            ? `A alteração virou um commit da ${branch}, que segue no ar.`
            : `A alteração virou o primeiro commit da ${branch}, que segue no ar.`,
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
      anotar(
        transicao.troca
          ? `[fenix] troca para a ${transicao.para.ref} interrompida; voltando para ${transicao.de.ref}`
          : `[fenix] troca sem aprovação encontrada; voltando para ${transicao.de.ref}`,
      )
      const copia = await conferirCopia(transicao.de.sha)
      if (copia) throw new Error(`não consegui voltar para ${transicao.de.ref}: ${copia}`)
      await trocarPara(transicao.de, { conferirSha: false })
      // Uma troca de branch não cria nada: a branch de destino é do Ricardo e fica.
      if (!transicao.aprovada && !transicao.troca) {
        await apagarBranch(transicao.para.ref)
        anotar(`[fenix] ${transicao.para.ref} descartada (${transicao.para.sha})`)
      }
      rmSync(arqTransicao, { force: true })
      return transicao
    },

    /** Um serviço versionado caiu. Devolve true se quem cuida disso é a troca. */
    servicoCaiu(nome, motivo) {
      if (!ocupado && !emTeste) {
        quedaForaDaTroca(nome, motivo)
        return false
      }
      queda = `O serviço ${nome} caiu: ${motivo}.`
      return true
    },

    /** Em troca ou em teste: a saúde e as quedas são desta parte, não da guardiã. */
    emTroca: () => ocupado || Boolean(emTeste),

    /** Há uma alteração no ar que ninguém revisou? */
    emTeste: () => Boolean(emTeste),

    /**
     * A noite começa ou termina (docs/adr/0040). Quem autoriza é o "confirmo" falado
     * do Ricardo, conferido na interface; aqui fica o prazo, com teto de 14 horas.
     */
    noite({ acao, ate } = {}) {
      if (acao === 'terminar') {
        rmSync(arqNoite, { force: true })
        anotar('[fenix] a noite terminou')
        return { ok: true, mensagem: 'A noite terminou.' }
      }
      if (acao !== 'comecar') return { ok: false, mensagem: `Ação desconhecida da noite: ${acao}.` }
      if (versaoFixa) return { ok: false, mensagem: FIXA }
      const limite = Number(ate)
      if (!(limite > Date.now()) || limite - Date.now() > 14 * 60 * 60_000) {
        return { ok: false, mensagem: 'A noite precisa terminar no futuro, em até 14 horas.' }
      }
      writeFileSync(arqNoite, JSON.stringify({ ate: limite, desde: Date.now() }, null, 2))
      anotar(`[fenix] noite autorizada até ${new Date(limite).toISOString()}`)
      return { ok: true, mensagem: 'A noite está autorizada.' }
    },
    noiteAtiva,

    estado() {
      const t = emTeste ?? lerJson(arqTransicao, null)
      return {
        troca: emTeste ? 'testando' : ocupado ? 'aplicando' : null,
        id: t?.id ?? null,
        branch: t?.para?.ref ?? null,
        ultimaTroca,
      }
    },

    /**
     * Traz a versão segura mais nova do remoto e sobe com ela. Se a versão nova
     * não ficar de pé, volta para onde estava — a remota continua lá, e a
     * próxima atualização tenta de novo.
     *
     * Fora da versão segura (uma branch de fase, ou HEAD destacado), faz antes o
     * checkout dela: o pedido do Ricardo é "volte para a main e atualize". A branch
     * de onde saiu continua guardada, com tudo o que tem; só deixa de estar no ar.
     *
     * Em etapas, uma depois da outra, e cada uma conferida: busca, confere que dá
     * para avançar sem merge, troca, confere o commit, reinstala se precisar, sobe
     * e observa. Qualquer falha no caminho volta à branch e ao commit de antes e
     * religa os serviços: a cópia nunca fica no meio, e a resposta diz o motivo exato.
     */
    async atualizar() {
      if (versaoFixa) return { ok: false, mensagem: FIXA }
      if (ocupado || emTeste) return { ok: false, mensagem: 'Há uma troca em andamento ou uma alteração em teste.' }
      ocupado = true
      /** Onde a cópia estava (branch e commit): é para lá que uma falha volta. */
      let origem = null
      /** A versão segura local antes de avançar; vazia se ela só existia no remoto. */
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
      /** Volta à branch e ao commit de antes; nunca deixa a troca pela metade. */
      const restaurar = async () => {
        if (!desligados) {
          await desligar()
          desligados = true
        }
        const { ref } = await versaoAtual()
        // A versão segura volta ao commit em que estava; se ela nem existia, sai.
        if (ref === versaoSegura && antes) await git('reset', '--hard', '--quiet', antes)
        if (origem.ref !== versaoSegura) {
          await trocarPara(origem)
          if (!antes && (await existeLocal(versaoSegura))) await git('branch', '-D', versaoSegura)
        } else {
          await atualizarSubmodulos()
        }
        const agora = await versaoAtual()
        if (agora.sha !== origem.sha || agora.ref !== origem.ref) {
          throw new Error(`a cópia ficou em ${agora.ref} (${curto(agora.sha)}), e não em ${origem.ref} (${curto(origem.sha)})`)
        }
        if (reinstalar) await rodarInstalar().catch((err) => anotar(`[fenix] ATENÇÃO: a reinstalação da versão anterior falhou: ${err.message}`))
      }
      const onde = (o) => (o.ref === o.sha ? `HEAD destacado em ${curto(o.sha)}` : o.ref)
      try {
        const copia = await conferirCopia()
        if (copia) return recusa(copia.replace('nada foi trocado', 'nada foi atualizado').replace('Nada foi trocado', 'Nada foi atualizado'))
        origem = await versaoAtual()
        const fora = origem.ref !== versaoSegura
        antes = fora
          ? await git('rev-parse', '--verify', '--quiet', `refs/heads/${versaoSegura}^{commit}`).catch(() => '')
          : origem.sha

        const remoto = await remotoDe(versaoSegura)
        const ramo = (await git('config', `branch.${versaoSegura}.merge`).catch(() => '')).replace(/^refs\/heads\//, '') || versaoSegura
        if (!(await git('remote').catch(() => '')).split('\n').includes(remoto)) {
          return recusa(`A cópia não tem o remoto ${remoto}; nada foi atualizado.`)
        }
        await gitRede('fetch', '--prune', '--quiet', remoto)
        const depois = await git('rev-parse', '--verify', '--quiet', `refs/remotes/${remoto}/${ramo}^{commit}`).catch(() => '')
        if (!depois) return recusa(`O remoto ${remoto} não tem a branch ${ramo}; nada foi atualizado.`)
        if (!fora && depois === antes) return { ok: true, mensagem: 'Já estava na versão mais nova.' }
        if (antes && antes !== depois && !(await sim(git('merge-base', '--is-ancestor', antes, depois)))) {
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

        // O que muda é o que está no ar agora contra o alvo, e não só a main local.
        const mudados = (await git('diff', '--name-only', origem.sha, depois)).split('\n').filter(Boolean)
        reinstalar = Boolean(instalar && mudados.some((f) => instalar.quando.some((re) => re.test(f))))
        anotar(
          fora
            ? `[fenix] saindo de ${onde(origem)} para a ${versaoSegura} e atualizando para ${curto(depois)}`
            : `[fenix] atualizando ${versaoSegura} de ${curto(antes)} para ${curto(depois)}`,
        )

        await desligar()
        desligados = true
        mexeu = true
        if (fora) {
          // Sem a main local, ela nasce acompanhando a do remoto, já no commit novo.
          await trocarPara({ ref: versaoSegura, sha: antes || depois })
        }
        if (antes && antes !== depois) await git('merge', '--ff-only', '--quiet', depois)
        await atualizarSubmodulos()
        const agora = await versaoAtual()
        if (agora.ref !== versaoSegura || agora.sha !== depois) {
          throw new Error(`a cópia ficou em ${agora.ref} (${curto(agora.sha)}), e não em ${versaoSegura} (${curto(depois)})`)
        }
        if (reinstalar) await rodarInstalar()
        religar()

        const motivo = await observar(false)
        if (!motivo) {
          anotar(`[fenix] ${versaoSegura} atualizada para ${curto(depois)}${fora ? ` (saindo de ${onde(origem)})` : ''}`)
          if (!fora) return { ok: true, mensagem: `Atualizei de ${curto(antes)} para ${curto(depois)}, ${mudados.length} arquivos.` }
          const guardada = origem.ref === origem.sha ? '' : ` A ${origem.ref} continua guardada, só fora do ar.`
          const passo = antes === depois ? `, que já estava na versão mais nova (${curto(depois)})` : `, atualizada de ${curto(antes) || 'nada'} para ${curto(depois)}`
          return {
            ok: true,
            mensagem: `Saí de ${onde(origem)} para a ${versaoSegura}${passo}; ${mudados.length} arquivos mudaram no ar.${guardada}`,
          }
        }
        await restaurar()
        religar()
        anotar(`[fenix] a atualização falhou (${motivo}); de volta a ${onde(origem)} (${curto(origem.sha)})`)
        return { ok: false, mensagem: `${motivo} Voltei para a versão de antes, ${onde(origem)} (${curto(origem.sha)}).` }
      } catch (err) {
        anotar(`[fenix] falha ao atualizar: ${err.message}`)
        if (!mexeu) return { ok: false, mensagem: `Não consegui atualizar: ${err.message}. Nada foi trocado.` }
        try {
          await restaurar()
          anotar(`[fenix] de volta a ${onde(origem)} (${curto(origem.sha)}) depois da falha`)
          return { ok: false, mensagem: `Não consegui atualizar: ${err.message}. Voltei para a versão de antes, ${onde(origem)} (${curto(origem.sha)}).` }
        } catch (falha) {
          anotar(`[fenix] ATENÇÃO: não consegui voltar para ${onde(origem)}: ${falha.message}`)
          return {
            ok: false,
            mensagem: `Não consegui atualizar (${err.message}) nem voltar para ${onde(origem)} (${falha.message}). Confira a cópia com git status.`,
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
