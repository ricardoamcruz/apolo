import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { classificar } from './autodev/politica.mjs'
import { historicoDeBranches, proximaFase } from './branches.mjs'

/**
 * Sub-módulo git (RF-17, ADR 0014): o A.P.O.L.O. faz commits do próprio código
 * e abre pull requests para a própria `main`.
 *
 * Duas coisas que este arquivo NÃO é:
 *
 *   - Não é o autodesenvolvimento. Lá (`bridge/autodev/`) o agente escreve
 *     código numa cópia separada, a ponte confere e o supervisor troca a versão
 *     no ar, com rollback. O commit que acontece lá é um detalhe interno desse
 *     ciclo, numa branch `autodev/<id>`.
 *   - Não é um atalho para a `main`. Aqui só existem dois gestos: guardar o
 *     trabalho que está na cópia em execução (commit numa branch que não é a
 *     `main`) e pedir revisão (pull request). Não há merge, não há push na
 *     `main`, não há `--force`. O merge continua sendo do Ricardo, como manda o
 *     AGENTS.md.
 *
 * O gate de permissões (RNF/ADR 0011) vale aqui pelo mesmo caminho do
 * `chrome.mjs`: as ferramentas que agem só são construídas quando
 * `JARVIS_ALLOW_WRITES=1`. Em modo somente leitura elas não existem, e o
 * modelo não tem o que pedir. Ler o estado do repositório continua liberado.
 */

const exec = promisify(execFile)

/** A branch que recebe os pull requests. Nada é commitado nela direto. */
export const BASE = 'main'

const LOCAL_MS = 15_000
/** Push e `gh` falam com a rede: o dobro do fôlego, e ainda assim com teto. */
const REDE_MS = 60_000
const MAX_TEXTO = 4000

const texto = (text) => ({ content: [{ type: 'text', text }] })
const recusa = (text) => ({ isError: true, content: [{ type: 'text', text }] })

const cortar = (t, n = MAX_TEXTO) => {
  const s = String(t ?? '').trim()
  return s.length > n ? `${s.slice(0, n)}\n… (cortado)` : s
}

const ultimasLinhas = (t, n = 8) =>
  String(t ?? '').trim().split('\n').slice(-n).join('\n').slice(-800)

/**
 * Nome de branch aceitável. Mais restrito que o do Git de propósito: o nome vai
 * para a linha de comando do `git` e do `gh`, e um nome começando com `-` viraria
 * uma opção. Sem `..`, sem `//`, sem terminar em `/`, `.` ou `.lock`.
 */
const FORMATO_BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/
export const branchValida = (nome) =>
  typeof nome === 'string' &&
  nome.length > 0 &&
  nome.length <= 100 &&
  FORMATO_BRANCH.test(nome) &&
  !nome.includes('..') &&
  !nome.includes('//') &&
  !/[/.]$/.test(nome) &&
  !nome.endsWith('.lock')

/** `dono/nome` de uma URL do GitHub (https ou ssh); null para qualquer outra. */
export const repositorioGithub = (url) =>
  String(url ?? '').trim().match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/)?.[1] ?? null

/**
 * Cria o pull request de verdade, pelo `gh`. Injetável porque é a única parte
 * que precisa de rede e de uma conta — os testes passam outra no lugar.
 */
async function prPeloGh({ repo, branch, titulo, corpo }) {
  try {
    // Sempre o `origin`, nomeado: sem `--repo`, o `gh` usa o repositório padrão
    // dele, que neste fork é o `upstream` — um projeto público de terceiros.
    const { stdout: origem } = await exec('git', ['remote', 'get-url', 'origin'], { cwd: repo })
    const destino = repositorioGithub(origem)
    if (!destino) return { ok: false, motivo: 'O remoto origin não é um repositório do GitHub.' }
    const { stdout } = await exec(
      'gh',
      ['pr', 'create', '--repo', destino, '--base', BASE, '--head', branch, '--title', titulo, '--body', corpo],
      { cwd: repo, timeout: REDE_MS },
    )
    // O `gh` imprime a URL do pull request na última linha útil.
    const url = stdout.trim().split('\n').filter(Boolean).pop() ?? ''
    return { ok: true, url }
  } catch (err) {
    if (err.code === 'ENOENT') return { ok: false, semGh: true }
    return { ok: false, motivo: ultimasLinhas(err.stderr || err.stdout || err.message) }
  }
}

/**
 * As operações, sem nada de MCP: dá para testar uma a uma.
 *
 * @param repo        a cópia do projeto em execução
 * @param ocupado     devolve o motivo para não mexer no repositório agora, ou null
 * @param criarPr     abre o pull request; o padrão usa o `gh`
 */
export function criarGit({ repo, ocupado = () => null, criarPr = prPeloGh }) {
  const git = async (args, timeout = LOCAL_MS) => {
    const { stdout } = await exec('git', args, { cwd: repo, timeout, maxBuffer: 8 * 1024 * 1024 })
    return stdout.trim()
  }
  /** Para o que pode não existir: um remoto, uma branch, a própria `main`. */
  const talvez = async (args, timeout = LOCAL_MS) => {
    try {
      return await git(args, timeout)
    } catch {
      return null
    }
  }

  const branchAtual = () => git(['rev-parse', '--abbrev-ref', 'HEAD'])
  const existe = async (branch) =>
    (await talvez(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])) !== null
  const adiante = async (ref) => {
    const n = await talvez(['rev-list', '--count', `${BASE}..${ref}`])
    return n === null ? null : Number(n)
  }
  const pendentes = async () =>
    (await git(['status', '--porcelain'])).split('\n').filter(Boolean)

  /** Comum a tudo o que escreve: o repositório tem de estar livre. */
  const livre = () => {
    const motivo = ocupado()
    return motivo ? { ok: false, texto: `Não dá para mexer no repositório agora: ${motivo}.` } : null
  }

  async function status() {
    const atual = await branchAtual()
    const sujo = await pendentes()
    const frente = atual === 'HEAD' ? await adiante('HEAD') : await adiante(atual)

    // As branches que já têm trabalho e ainda não entraram na main — as do
    // autodesenvolvimento e as que o commit abaixo cria.
    const refs = (await git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'])).split('\n')
    const esperando = []
    for (const ref of refs.filter((r) => r && r !== BASE)) {
      const n = await adiante(ref)
      if (n) esperando.push(`${ref} (${n} ${n === 1 ? 'commit' : 'commits'})`)
    }

    const remoto = await talvez(['remote', 'get-url', 'origin'])
    const gh = await temGh()
    const fase = proximaFase(await historicoDeBranches(git, BASE))

    const linhas = [
      atual === 'HEAD'
        ? 'A cópia em execução está com a HEAD destacada, fora de qualquer branch.'
        : `Branch atual: ${atual}` +
          (atual === BASE
            ? ' (é a main: nada é commitado nela direto).'
            : frente === null
              ? '.'
              : ` (${frente} ${frente === 1 ? 'commit' : 'commits'} à frente da ${BASE}).`),
      sujo.length
        ? `Alterações não commitadas: ${sujo.length}. ${sujo.slice(0, 12).join(', ')}` +
          (sujo.length > 12 ? ', …' : '')
        : 'Nada pendente: a cópia em execução está limpa.',
      esperando.length
        ? `Branches à espera de revisão: ${esperando.join('; ')}.`
        : `Nenhuma branch à frente da ${BASE}.`,
      `Uma branch nova agora se chamaria fase-${fase}/<nome-criativo>.`,
      remoto
        ? 'Remoto origin: configurado.'
        : 'Remoto origin: ausente — sem ele não dá para abrir pull request, só guardar em branch local.',
      gh ? 'GitHub CLI: disponível.' : 'GitHub CLI: ausente — o pull request teria de ser aberto à mão.',
    ]
    return { ok: true, texto: linhas.join('\n') }
  }

  async function diff({ branch } = {}) {
    if (branch !== undefined && branch !== null && branch !== '') {
      if (!branchValida(branch)) return { ok: false, texto: `Nome de branch inválido: ${branch}.` }
      if (!(await existe(branch))) return { ok: false, texto: `A branch ${branch} não existe aqui.` }
      const commits = await git(['log', '--oneline', '--no-decorate', `${BASE}..${branch}`])
      if (!commits) {
        return { ok: true, texto: `A branch ${branch} não tem nada à frente da ${BASE}.` }
      }
      const stat = await git(['diff', '--stat', `${BASE}...${branch}`])
      return { ok: true, texto: cortar(`Commits em ${branch}:\n${commits}\n\nArquivos:\n${stat}`) }
    }

    const sujo = await pendentes()
    if (!sujo.length) return { ok: true, texto: 'A cópia em execução está limpa: nada para mostrar.' }
    const stat = await git(['diff', '--stat', 'HEAD'])
    return {
      ok: true,
      texto: cortar(
        `Alterações não commitadas (${sujo.length}):\n${sujo.join('\n')}\n\n${stat || '(só arquivos novos)'}`,
      ),
    }
  }

  async function commit({ message, branch } = {}) {
    const bloqueio = livre()
    if (bloqueio) return bloqueio

    const mensagem = String(message ?? '').replace(/\r/g, '').trim()
    if (!mensagem) return { ok: false, texto: 'Falta a mensagem do commit.' }
    if (mensagem.length > 2000) return { ok: false, texto: 'A mensagem do commit é longa demais.' }

    const sujo = await pendentes()
    if (!sujo.length) return { ok: false, texto: 'Não há nada para commitar: a cópia está limpa.' }

    const atual = await branchAtual()
    const nova = branch ? String(branch) : null
    if (nova && !branchValida(nova)) return { ok: false, texto: `Nome de branch inválido: ${nova}.` }
    if (nova === BASE) return { ok: false, texto: `Nada é commitado na ${BASE} direto.` }
    if (!nova && (atual === BASE || atual === 'HEAD')) {
      return {
        ok: false,
        texto:
          atual === BASE
            ? `A cópia em execução está na ${BASE}, e nada é commitado nela direto. Peça o commit informando o nome de uma branch nova.`
            : 'A cópia em execução está com a HEAD destacada. Peça o commit informando o nome de uma branch nova.',
      }
    }
    // Uma branch que já existe não serve: trocar para ela mudaria os arquivos
    // debaixo do processo que está no ar. Criar uma nova a partir daqui só move
    // uma referência — o disco fica igual.
    if (nova && nova !== atual && (await existe(nova))) {
      return {
        ok: false,
        texto: `A branch ${nova} já existe. Escolha um nome novo, ou peça o commit sem nomear branch para ficar na atual.`,
      }
    }

    if (nova && nova !== atual) await git(['switch', '-c', nova])
    const destino = nova ?? atual

    await git(['add', '-A'])
    const nomes = (await git(['diff', '--cached', '--name-only'])).split('\n').filter(Boolean)
    const { proibidos, sensiveis } = classificar(nomes)
    if (proibidos.length) {
      // Um segredo que entra num commit continua no histórico depois de
      // apagado. Nada é commitado antes desta conferência.
      await git(['reset'])
      return {
        ok: false,
        texto: `O commit foi descartado: ele incluía ${proibidos.join(', ')}, que nunca vão para o repositório.`,
      }
    }
    if (!nomes.length) {
      return { ok: false, texto: 'Depois de conferir, não restou nada para commitar.' }
    }

    await git(['commit', '-m', mensagem])
    const sha = (await git(['rev-parse', '--short', 'HEAD'])).trim()
    const aviso = sensiveis.length
      ? ` Ele toca arquivos sensíveis (${sensiveis.join(', ')}), então a revisão do Ricardo é obrigatória antes de entrar na ${BASE}.`
      : ''
    return {
      ok: true,
      texto:
        `Commit ${sha} feito na branch ${destino}, com ${nomes.length} ${nomes.length === 1 ? 'arquivo' : 'arquivos'}.` +
        aviso,
    }
  }

  async function pullRequest({ title, body, branch } = {}) {
    const bloqueio = livre()
    if (bloqueio) return bloqueio

    const titulo = String(title ?? '').replace(/\r?\n/g, ' ').trim()
    if (!titulo) return { ok: false, texto: 'Falta o título do pull request.' }
    if (titulo.length > 200) return { ok: false, texto: 'O título do pull request é longo demais.' }

    const atual = await branchAtual()
    const alvo = branch ? String(branch) : atual
    if (alvo === 'HEAD') {
      return { ok: false, texto: 'A HEAD está destacada: informe a branch do pull request.' }
    }
    if (!branchValida(alvo)) return { ok: false, texto: `Nome de branch inválido: ${alvo}.` }
    if (alvo === BASE) return { ok: false, texto: `A ${BASE} não abre pull request para si mesma.` }
    if (!(await existe(alvo))) return { ok: false, texto: `A branch ${alvo} não existe aqui.` }

    const frente = await adiante(alvo)
    if (!frente) {
      return {
        ok: false,
        texto: `A branch ${alvo} não tem nenhum commit à frente da ${BASE}: não há o que revisar.`,
      }
    }

    const sujo = alvo === atual ? await pendentes() : []
    const sobrou = sujo.length
      ? ` Ficaram de fora ${sujo.length} ${sujo.length === 1 ? 'alteração' : 'alterações'} não commitadas.`
      : ''

    const remoto = await talvez(['remote', 'get-url', 'origin'])
    if (!remoto) {
      return {
        ok: false,
        texto:
          `Este repositório não tem o remoto origin, então não há para onde enviar o pull request. ` +
          `A branch ${alvo} está pronta aqui, com ${frente} ${frente === 1 ? 'commit' : 'commits'}, e o Ricardo pode revisá-la localmente.${sobrou}`,
      }
    }

    try {
      // Sem `--force`, nunca: ele reescreve o que já foi enviado.
      await git(['push', '--set-upstream', 'origin', alvo], REDE_MS)
    } catch (err) {
      return {
        ok: false,
        texto: `O envio da branch ${alvo} falhou.\n${ultimasLinhas(err.stderr || err.stdout || err.message)}`,
      }
    }

    const corpo =
      String(body ?? '').trim() ||
      // Sem corpo, o histórico serve: é o que o revisor leria primeiro.
      (await git(['log', '--format=- %s', `${BASE}..${alvo}`]))

    const pr = await criarPr({ repo, branch: alvo, titulo, corpo })
    if (pr.ok) {
      return {
        ok: true,
        texto: `Pull request aberto de ${alvo} para a ${BASE}: ${pr.url}. O merge é revisão do Ricardo.${sobrou}`,
      }
    }
    if (pr.semGh) {
      return {
        ok: true,
        texto:
          `A branch ${alvo} foi enviada para o origin, mas o GitHub CLI não está instalado nesta máquina, ` +
          `então o pull request precisa ser aberto à mão. O merge é revisão do Ricardo de todo jeito.${sobrou}`,
      }
    }
    return {
      ok: false,
      texto: `A branch ${alvo} foi enviada, mas o pull request não foi criado.\n${pr.motivo}`,
    }
  }

  return { status, diff, commit, pullRequest }
}

/** O `gh` existe nesta máquina? Só isso — a conta é problema do próprio `gh`. */
async function temGh() {
  try {
    await exec('gh', ['--version'], { timeout: LOCAL_MS })
    return true
  } catch {
    return false
  }
}

const STATUS_DESCRIPTION = `Report the state of A.P.O.L.O.'s own git repository.

Current branch, whether the running copy has uncommitted work, which branches
are ahead of main and still waiting for review, and whether this machine can
open a pull request at all (an \`origin\` remote plus the GitHub CLI).

Call it before committing or opening a pull request, and whenever the user asks
what is pending in the code. It changes nothing.`

const DIFF_DESCRIPTION = `Show what changed in A.P.O.L.O.'s own repository.

With no argument: the uncommitted work in the running copy — the files, plus a
per-file summary. With \`branch\`: the commits that branch has ahead of main and
the files they touch, which is what a reviewer would read first.

Read-only, and the right call before writing a commit message or a pull request
body: describe what is actually there, not what you assume.`

const COMMIT_DESCRIPTION = `Commit the uncommitted work in A.P.O.L.O.'s own repository.

Never on main — nothing goes into main directly, only through a pull request.
If the running copy is on main (or on a detached HEAD), pass \`branch\` with a
NEW name and the commit lands there instead.

Everything currently modified is committed together, so say in one sentence what
you are about to commit before calling. Files that never belong in the
repository (\`.env*\`, keys, certificates) abort the whole commit.

Write the message in Brazilian Portuguese: a short subject line that says what
changed, in the imperative or as a plain statement of fact.`

const PR_DESCRIPTION = `Open a pull request from a branch to main, for the user to review.

This is how A.P.O.L.O.'s own code gets proposed for merge. It pushes the branch
to \`origin\` and opens the pull request with the GitHub CLI. It never merges,
never pushes to main and never force-pushes: the merge is the user's decision,
always.

\`branch\` defaults to the branch the running copy is on; name it explicitly to
propose one of the \`autodev/*\` branches a previous job left behind. Without a
\`body\`, the branch's commit subjects are used.

Say what you are proposing before calling, and report the outcome afterwards —
including the cases where the branch was pushed but no pull request could be
opened.`

/**
 * @param {{ repo: string, allowWrites: boolean, ocupado?: () => string | null }} opcoes
 */
export function gitServer({ repo, allowWrites, ocupado, criarPr }) {
  const g = criarGit({ repo, ocupado, criarPr })
  const responder = (r) => (r.ok ? texto(r.texto) : recusa(r.texto))
  /** Uma falha do `git` não derruba o turno: ela volta como recusa, em texto. */
  const proteger = (fn) => async (args) => {
    try {
      return responder(await fn(args))
    } catch (err) {
      return recusa(`O git falhou: ${ultimasLinhas(err.stderr || err.message)}`)
    }
  }

  const tools = [
    tool('git_status', STATUS_DESCRIPTION, {}, proteger(() => g.status())),
    tool(
      'git_diff',
      DIFF_DESCRIPTION,
      {
        branch: z
          .string()
          .optional()
          .catch(undefined)
          .describe('Compare this branch against main. Omit for the uncommitted work.'),
      },
      proteger((args) => g.diff({ branch: args.branch })),
    ),
  ]

  // O gate de permissões: commitar e propor merge mudam algo de verdade, então
  // as duas ferramentas só existem com a escrita liberada. Ver ADR 0014.
  if (allowWrites) {
    tools.push(
      tool(
        'git_commit',
        COMMIT_DESCRIPTION,
        {
          message: z.string().describe('Commit message, in Brazilian Portuguese.'),
          branch: z
            .string()
            .optional()
            .catch(undefined)
            .describe('Create this NEW branch and commit there. Required when on main. Use the name git_status suggests: fase-x.y/<broad-creative-name>.'),
        },
        proteger((args) => g.commit({ message: args.message, branch: args.branch })),
      ),
      tool(
        'git_pull_request',
        PR_DESCRIPTION,
        {
          title: z.string().describe('Pull request title, in Brazilian Portuguese.'),
          body: z
            .string()
            .optional()
            .catch(undefined)
            .describe('Pull request body. Omit to use the commit subjects.'),
          branch: z
            .string()
            .optional()
            .catch(undefined)
            .describe('Branch to propose. Defaults to the one the running copy is on.'),
        },
        proteger((args) =>
          g.pullRequest({ title: args.title, body: args.body, branch: args.branch }),
        ),
      ),
    )
  }

  return createSdkMcpServer({
    name: 'apolo_git',
    version: '1.0.0',
    instructions:
      "A.P.O.L.O.'s own repository: read its state, commit the work in progress " +
      'and open a pull request to main for the user to review. Never merges.',
    // "O que está pendente no código?" tem de ser um fato, não um palpite — e a
    // busca de ferramentas transformaria em palpite.
    alwaysLoad: true,
    tools,
  })
}
