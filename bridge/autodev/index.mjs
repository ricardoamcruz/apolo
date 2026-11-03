/**
 * Autodesenvolvimento: o A.P.O.L.O. altera o próprio código quando o Ricardo
 * pede e confirma (docs/adr/0011).
 *
 *   proposto → trabalhando → verificando → aplicando → resultado
 *
 * Nada acontece na cópia em execução. O agente trabalha numa worktree separada,
 * a partir da versão que está no ar; a ponte confere o resultado e só então pede
 * ao supervisor (scripts/supervisor.mjs) para trocar a versão. Se quebrar, ele
 * volta sozinho. A ponte nunca é quem faz a troca: ela é o que está sendo trocado.
 */

import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { PASTA_AUTODEV, classificar } from './politica.mjs'
import { rodarAgente } from './agente.mjs'

const exec = promisify(execFile)

const PROPOSTA_MS = 5 * 60_000
const LIMITE_MS = Number(process.env.APOLO_AUTODEV_LIMITE_MIN ?? 30) * 60_000
const CHECAGEM_MS = 5 * 60_000
/** Mais que a subida e a observação do supervisor somadas. */
const TROCA_MS = 5 * 60_000
const EM_CURSO = new Set(['trabalhando', 'verificando', 'aplicando'])

const git = async (cwd, ...args) =>
  (await exec('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 })).stdout.trim()

const ultimasLinhas = (texto, n = 12) =>
  String(texto ?? '').trim().split('\n').slice(-n).join('\n').slice(-1500)

const portaLivre = () =>
  new Promise((resolve, reject) => {
    const s = createServer()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })

/** Sobe a ponte da cópia de trabalho, sem nenhum segredo, numa porta própria. */
async function ponteSobe(pasta) {
  const porta = await portaLivre()
  const { PATH, HOME } = process.env
  const filho = spawn(process.execPath, ['bridge/server.mjs'], {
    cwd: pasta,
    env: { PATH, HOME, JARVIS_BRIDGE_PORT: String(porta) },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let erros = ''
  filho.stderr.on('data', (d) => (erros += d))
  let saiu = false
  filho.on('exit', () => (saiu = true))
  try {
    const limite = Date.now() + 20_000
    while (Date.now() < limite && !saiu) {
      const r = await fetch(`http://127.0.0.1:${porta}/health`).catch(() => null)
      if (r?.ok) return
      await new Promise((ok) => setTimeout(ok, 300))
    }
    throw new Error(`a ponte não subiu\n${ultimasLinhas(erros)}`)
  } finally {
    filho.kill('SIGKILL')
  }
}

/**
 * As checagens antes de trocar a versão.
 *
 * Chamadas direto, sem `npm run`: package.json é sensível, mas é melhor não
 * depender disso para saber o que executa aqui. `--force` porque o cache do tsc
 * fica em node_modules, compartilhado com a cópia em execução.
 */
async function verificarPadrao(pasta) {
  const bin = (nome) => join(pasta, 'node_modules', '.bin', nome)
  const passos = [
    ['lint', bin('oxlint'), []],
    ['tipos', bin('tsc'), ['-b', '--force']],
    ['build', bin('vite'), ['build']],
  ]
  for (const [nome, cmd, args] of passos) {
    try {
      await exec(cmd, args, { cwd: pasta, timeout: CHECAGEM_MS, maxBuffer: 16 * 1024 * 1024 })
    } catch (err) {
      return { ok: false, motivo: `Falhou em ${nome}.\n${ultimasLinhas(err.stdout || err.stderr || err.message)}` }
    }
  }
  try {
    await ponteSobe(pasta)
  } catch (err) {
    return { ok: false, motivo: `Falhou ao iniciar: ${err.message}` }
  }
  return { ok: true }
}

/** Abre a cópia de trabalho no VS Code, para acompanhar. Opcional: sem ele, segue. */
function abrirNoEditor(pasta) {
  if (process.env.APOLO_AUTODEV_VSCODE === '0') return
  const candidatos = [
    process.env.APOLO_VSCODE_BIN,
    '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
    'code',
  ].filter(Boolean)
  const bin = candidatos.find((c) => !c.includes('/') || existsSync(c))
  const filho = spawn(bin, ['-n', pasta], { stdio: 'ignore', detached: true })
  filho.on('error', () => {})
  filho.unref()
}

/**
 * @param repo         a cópia do projeto em execução
 * @param ligado       APOLO_AUTODEV=1; sem isso, tudo é recusado
 * @param supervisor   envia uma mensagem ao supervisor; null fora do `npm start`
 * @param avisar       recebe o estado a cada mudança
 * @param interfaces   quantas interfaces estão conectadas agora
 */
export function criarAutodev({
  repo,
  ligado,
  supervisor,
  avisar,
  interfaces = () => 0,
  pasta = PASTA_AUTODEV,
  agente = rodarAgente,
  verificar = verificarPadrao,
  abrirEditor = abrirNoEditor,
}) {
  mkdirSync(pasta, { recursive: true })
  const arqEstado = join(pasta, 'estado.json')

  let estado = { ligado, fase: 'ocioso' }
  try {
    const salvo = JSON.parse(readFileSync(arqEstado, 'utf8'))
    estado = { ...salvo, ligado }
    // A ponte morreu no meio do trabalho: o agente foi junto. Já 'aplicando' é
    // o caminho normal: quem subiu agora é a versão nova, e o resultado vem aí.
    if (estado.fase === 'trabalhando' || estado.fase === 'verificando') {
      estado = {
        ligado,
        fase: 'ocioso',
        resultado: { id: salvo.id, tipo: 'falhou', mensagem: 'A ponte reiniciou no meio do trabalho.' },
      }
    }
    if (estado.fase === 'aplicando' && !supervisor) estado.fase = 'ocioso'
    if (estado.fase === 'proposto') estado.fase = 'ocioso'
  } catch {
    /* primeira vez */
  }

  let controle = null
  let esperaTroca = null

  const mudar = (patch) => {
    estado = { ...estado, ...patch }
    writeFileSync(arqEstado, JSON.stringify(estado, null, 2))
    avisar(estado)
  }

  const terminar = (id, tipo, mensagem, extra = {}) => {
    console.log(`[autodev] ${id}: ${tipo} — ${mensagem}`)
    controle = null
    mudar({
      fase: 'ocioso',
      id: undefined,
      pedido: undefined,
      criadoEm: undefined,
      etapa: undefined,
      resultado: { id, tipo, mensagem, ...extra },
    })
  }

  /**
   * Uma troca cujo resultado nunca chegou não pode travar os próximos pedidos:
   * o supervisor pode ter morrido entre aceitar e responder.
   */
  const vigiarTroca = () => {
    clearTimeout(esperaTroca)
    esperaTroca = setTimeout(() => {
      if (estado.fase === 'aplicando') {
        terminar(estado.id, 'falhou', 'O supervisor não informou o resultado da troca.')
      }
    }, TROCA_MS)
    esperaTroca.unref?.()
  }
  if (estado.fase === 'aplicando') vigiarTroca()

  /** Só a cópia do último trabalho fica, aberta no VS Code até o próximo. */
  async function limparCopias() {
    const raiz = join(pasta, 'worktrees')
    const lista = await git(repo, 'worktree', 'list', '--porcelain')
    for (const linha of lista.split('\n')) {
      const caminho = linha.startsWith('worktree ') ? linha.slice(9) : ''
      if (caminho.includes(raiz)) await git(repo, 'worktree', 'remove', '--force', caminho)
    }
    await git(repo, 'worktree', 'prune')
    rmSync(raiz, { recursive: true, force: true })
  }

  async function trabalhar(id, pedido) {
    const copia = join(pasta, 'worktrees', id)
    const branch = `autodev/${id}`
    try {
      await limparCopias()
      // Destacada: uma branch presa a uma worktree não pode ir para a cópia em
      // execução. Ela é criada no fim, já apontando para o commit verificado.
      await git(repo, 'worktree', 'add', '--detach', copia, 'HEAD')
      symlinkSync(join(repo, 'node_modules'), join(copia, 'node_modules'))
      if (controle.signal.aborted) return terminar(id, 'cancelado', 'O trabalho foi cancelado.')
      abrirEditor(copia)

      const limite = setTimeout(() => controle?.abort(), LIMITE_MS)
      const r = await agente({
        pedido,
        pasta: copia,
        repo,
        abortController: controle,
        aoProgresso: (etapa) => mudar({ etapa }),
      }).finally(() => clearTimeout(limite))

      if (controle.signal.aborted) return terminar(id, 'cancelado', 'O trabalho foi cancelado.')
      if (!r.ok) return terminar(id, 'falhou', r.texto)

      await git(copia, 'add', '-A')
      const nomes = (await git(copia, 'diff', '--cached', '--name-only')).split('\n').filter(Boolean)
      if (!nomes.length) return terminar(id, 'falhou', r.texto || 'Nenhum arquivo foi alterado.')

      const { proibidos, sensiveis } = classificar(nomes)
      if (proibidos.length) {
        return terminar(id, 'falhou', `A alteração tocou em ${proibidos.join(', ')} e foi descartada.`)
      }

      await git(copia, 'commit', '-m', `Autodesenvolvimento: ${pedido.slice(0, 60)}\n\n${pedido}`)
      const sha = await git(copia, 'rev-parse', 'HEAD')
      await git(repo, 'branch', branch, sha)

      // Código sensível não roda antes de alguém ler, nem nas checagens.
      if (sensiveis.length) {
        return terminar(
          id,
          'revisao',
          `${r.texto} A alteração toca arquivos sensíveis e aguarda revisão na branch.`,
          { branch, sensiveis },
        )
      }

      mudar({ fase: 'verificando', etapa: 'lint, tipos, build e partida' })
      const v = await verificar(copia)
      if (!v.ok) return terminar(id, 'falhou', `As checagens recusaram a alteração. ${v.motivo}`, { branch })

      if (!supervisor) {
        return terminar(id, 'revisao', `${r.texto} Sem o supervisor do npm start, ela ficou na branch.`, { branch })
      }

      controle = null
      mudar({ fase: 'aplicando', etapa: 'reiniciando', branch, resumo: r.texto })
      vigiarTroca()
      supervisor({ type: 'autodev:aplicar', id, sha, branch, interfaces: interfaces() })
    } catch (err) {
      console.error('[autodev] falha:', err)
      terminar(id, 'falhou', `O trabalho falhou: ${err.message}`)
    }
  }

  async function confirmar() {
    if (estado.fase !== 'proposto') return { ok: false, mensagem: 'Não há proposta para confirmar.' }
    if (Date.now() - estado.criadoEm > PROPOSTA_MS) {
      mudar({ fase: 'ocioso', id: undefined, pedido: undefined, criadoEm: undefined })
      return { ok: false, mensagem: 'A proposta expirou.' }
    }
    if (await git(repo, 'status', '--porcelain')) {
      return {
        ok: false,
        mensagem: 'A cópia em execução tem alterações não commitadas. Faça o commit antes.',
      }
    }
    controle = new AbortController()
    mudar({ fase: 'trabalhando', etapa: 'preparando a cópia de trabalho' })
    void trabalhar(estado.id, estado.pedido)
    return { ok: true, mensagem: 'Trabalho iniciado. Você pode continuar usando o assistente.' }
  }

  return {
    estado: () => estado,

    /** Uma ação vinda da interface. */
    async acao(acao, { pedido } = {}) {
      if (!ligado) {
        return { ok: false, mensagem: 'O autodesenvolvimento está desligado. Inicie com npm start -- --autodev.' }
      }
      if (acao === 'estado') {
        const { fase, pedido: p, etapa, resultado } = estado
        if (fase !== 'ocioso') return { ok: true, mensagem: `${fase}: ${p ?? ''} ${etapa ?? ''}`.trim() }
        return { ok: true, mensagem: resultado?.mensagem ?? 'Nenhum trabalho em andamento.' }
      }
      if (acao === 'propor') {
        const texto = String(pedido ?? '').trim()
        if (!texto) return { ok: false, mensagem: 'Pedido vazio.' }
        if (EM_CURSO.has(estado.fase)) return { ok: false, mensagem: 'Já há um trabalho em andamento.' }
        const id = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
        mudar({ fase: 'proposto', id, pedido: texto, criadoEm: Date.now(), etapa: undefined })
        return { ok: true, mensagem: 'Proposta registrada. Falta a confirmação do Ricardo.' }
      }
      if (acao === 'confirmar') return confirmar()
      if (acao === 'cancelar') {
        if (estado.fase === 'proposto') {
          mudar({ fase: 'ocioso', id: undefined, pedido: undefined, criadoEm: undefined })
          return { ok: true, mensagem: 'Proposta descartada.' }
        }
        if (controle) {
          controle.abort()
          return { ok: true, mensagem: 'Cancelando.' }
        }
        return { ok: false, mensagem: 'Não há nada para cancelar.' }
      }
      if (acao === 'reverter') {
        if (!supervisor) return { ok: false, mensagem: 'Reverter exige o supervisor do npm start.' }
        if (EM_CURSO.has(estado.fase)) return { ok: false, mensagem: 'Há um trabalho em andamento.' }
        mudar({ fase: 'aplicando', id: 'reversao', etapa: 'voltando à versão anterior' })
        vigiarTroca()
        supervisor({ type: 'autodev:reverter', id: 'reversao' })
        return { ok: true, mensagem: 'Voltando à versão anterior.' }
      }
      return { ok: false, mensagem: `Ação desconhecida: ${acao}.` }
    },

    /** O resultado de uma troca, vindo do supervisor. */
    resultado({ id, tipo, mensagem }) {
      clearTimeout(esperaTroca)
      const { resumo, branch } = estado
      const texto = tipo === 'concluido' && resumo ? `${resumo} ${mensagem}` : mensagem
      mudar({ resumo: undefined, branch: undefined })
      terminar(id, tipo, texto, branch ? { branch } : {})
    },
  }
}
