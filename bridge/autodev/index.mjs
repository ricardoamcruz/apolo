/**
 * Autodesenvolvimento: o A.P.O.L.O. altera o próprio código quando o Ricardo
 * pede e confirma (docs/adr/0011).
 *
 *   proposto → trabalhando → verificando → aplicando → testando → resultado
 *
 * Nada acontece na cópia em execução. O agente trabalha numa worktree separada,
 * a partir da main; a ponte confere o resultado e só então pede ao supervisor
 * (scripts/supervisor.mjs) para colocá-lo em teste. O Ricardo aprova ou descarta,
 * e se quebrar ele volta sozinho (docs/adr/0015). A ponte nunca é quem faz a
 * troca: ela é o que está sendo trocado.
 */

import { execFile, spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { BASE, PASTA_AUTODEV, classificar, gateIntacto } from './politica.mjs'
import { rodarAgente } from './agente.mjs'
import { abrirEditor as abrirEditorPadrao, fecharEditor as fecharEditorPadrao } from './editor.mjs'
import { historicoDeBranches, proximaFase } from '../branches.mjs'
import { lerEntrega, nomeLivre, pedidoVago } from './entrega.mjs'

const exec = promisify(execFile)

const PROPOSTA_MS = 5 * 60_000
const LIMITE_MS = Number(process.env.APOLO_AUTODEV_LIMITE_MIN ?? 30) * 60_000
const CHECAGEM_MS = 5 * 60_000
/** Mais que a subida e a observação do supervisor somadas. */
const TROCA_MS = 5 * 60_000
const BUSCA_MS = 15_000
const EM_CURSO = new Set(['trabalhando', 'verificando', 'aplicando', 'testando'])

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
  if (!gateIntacto(readFileSync(join(pasta, 'bridge/server.mjs'), 'utf8'))) {
    return { ok: false, motivo: 'A alteração tirou bridge/server.mjs do gate.' }
  }
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
  abrirEditor = abrirEditorPadrao,
  fecharEditor = fecharEditorPadrao,
}) {
  mkdirSync(pasta, { recursive: true })
  const arqEstado = join(pasta, 'estado.json')
  const arqTransicao = join(pasta, 'transicao.json')
  const arqEventos = join(pasta, 'eventos.log')

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
    // Sem transição em disco não há nada em teste: o rollback manual já voltou.
    const emTroca = estado.fase === 'aplicando' || estado.fase === 'testando'
    if (emTroca && (!supervisor || !existsSync(arqTransicao))) estado.fase = 'ocioso'
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
    const linha = `[autodev] ${id}: ${tipo} — ${mensagem}`
    console.log(linha)
    try {
      appendFileSync(arqEventos, `${new Date().toISOString()} ${linha}\n`)
    } catch {
      /* o registro nunca interrompe o trabalho */
    }
    controle = null
    mudar({
      fase: 'ocioso',
      id: undefined,
      pedido: undefined,
      ultimoPedido: estado.pedido ?? estado.ultimoPedido,
      criadoEm: undefined,
      etapa: undefined,
      entrega: undefined,
      testeDesde: undefined,
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

  /** O que sobrou de uma execução interrompida: nada de autodev fica para trás. */
  async function limparRestos() {
    if (!ligado || estado.fase !== 'ocioso') return
    fecharEditor()
    await limparCopias()
    const branches = await git(repo, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/autodev')
    for (const branch of branches.split('\n').filter(Boolean)) {
      await git(repo, 'branch', '-D', branch).catch(() => {})
    }
  }
  const pronto = limparRestos().catch((err) => console.error('[autodev] limpeza:', err.message))

  const existeBranch = (nome) =>
    git(repo, 'rev-parse', '--verify', '-q', `refs/heads/${nome}`).then(
      () => true,
      () => false,
    )

  /** O nome escolhido pelo agente, com o número da próxima branch. */
  const nomeDaBranch = async (nome) => {
    const historico = await historicoDeBranches((args) => git(repo, ...args), BASE)
    return nomeLivre(`fase-${proximaFase(historico)}/${nome}`, existeBranch)
  }

  const encerrarCopia = async () => {
    fecharEditor()
    await limparCopias()
  }

  /** Devolve como terminou, ou nada se seguiu para o supervisor. */
  async function executar(id, pedido, sinal) {
    const copia = join(pasta, 'worktrees', id)
    const branch = `autodev/${id}`
    await limparCopias()
    await git(repo, 'worktree', 'add', '--detach', copia, 'HEAD')
    symlinkSync(join(repo, 'node_modules'), join(copia, 'node_modules'))
    if (sinal.aborted) return ['cancelado', 'O trabalho foi cancelado.']
    abrirEditor(copia)

    const limite = setTimeout(() => controle?.abort(), LIMITE_MS)
    const r = await agente({
      pedido,
      pasta: copia,
      repo,
      abortController: controle,
      aoProgresso: (etapa) => mudar({ etapa }),
    }).finally(() => clearTimeout(limite))

    if (sinal.aborted) return ['cancelado', 'O trabalho foi cancelado.']
    const entrega = lerEntrega(r.texto, pedido)
    if (!r.ok) return ['falhou', entrega.resumo]

    await git(copia, 'add', '-A')
    const nomes = (await git(copia, 'diff', '--cached', '--name-only')).split('\n').filter(Boolean)
    if (!nomes.length) return ['falhou', entrega.resumo || 'Nenhum arquivo foi alterado.']

    const { proibidos, sensiveis } = classificar(nomes)
    if (proibidos.length) {
      return ['falhou', `A alteração tocou em ${proibidos.join(', ')} e foi descartada.`]
    }

    await git(copia, 'commit', '-m', entrega.titulo, '-m', `${entrega.resumo}\n\nPedido: ${pedido}`)
    const sha = await git(copia, 'rev-parse', 'HEAD')

    // Código sensível não roda antes de alguém ler, nem nas checagens. Vai
    // direto para a branch definitiva: não há o que testar aqui.
    const guardar = async (motivo, extra = {}) => {
      const final = await nomeDaBranch(entrega.branch)
      await git(repo, 'branch', final, sha)
      return ['revisao', `${entrega.resumo} ${motivo}`, { branch: final, ...extra }]
    }
    if (sensiveis.length) {
      return guardar('A alteração toca arquivos sensíveis e aguarda revisão na branch.', { sensiveis })
    }

    mudar({ fase: 'verificando', etapa: 'lint, tipos, build e partida' })
    const v = await verificar(copia)
    if (!v.ok) return ['falhou', `As checagens recusaram a alteração. ${v.motivo}`]

    if (!supervisor) return guardar('Sem o supervisor do npm start, ela ficou na branch.')

    await encerrarCopia()
    await git(repo, 'branch', branch, sha)
    controle = null
    mudar({ fase: 'aplicando', etapa: 'reiniciando', branch, resumo: entrega.resumo, entrega })
    vigiarTroca()
    supervisor({ type: 'autodev:aplicar', id, sha, branch, interfaces: interfaces() })
  }

  async function trabalhar(id, pedido) {
    const sinal = controle.signal
    let fim
    try {
      fim = await executar(id, pedido, sinal)
    } catch (err) {
      console.error('[autodev] falha:', err)
      fim = sinal.aborted
        ? ['cancelado', 'O trabalho foi cancelado.']
        : ['falhou', `O trabalho falhou: ${err.message}`]
    }
    if (!fim) return
    // Limpa antes de anunciar: um pedido novo não pode cruzar com esta limpeza.
    await encerrarCopia().catch((err) => console.error('[autodev] limpeza:', err.message))
    terminar(id, ...fim)
  }

  /** A main local atrás do GitHub faria o trabalho partir de código velho. */
  async function mainAtrasada() {
    try {
      await exec('git', ['fetch', '-q', 'origin', BASE], { cwd: repo, timeout: BUSCA_MS })
      return Number(await git(repo, 'rev-list', '--count', `${BASE}..origin/${BASE}`)) > 0
    } catch {
      return false // sem rede ou sem origin: trabalha com o que tem
    }
  }

  async function confirmar() {
    if (estado.fase !== 'proposto') return { ok: false, mensagem: 'Não há proposta para confirmar.' }
    if (Date.now() - estado.criadoEm > PROPOSTA_MS) {
      mudar({ fase: 'ocioso', id: undefined, pedido: undefined, criadoEm: undefined })
      return { ok: false, mensagem: 'A proposta expirou.' }
    }
    const atual = await git(repo, 'symbolic-ref', '--short', '-q', 'HEAD').catch(() => '')
    if (atual !== BASE) {
      return {
        ok: false,
        mensagem: `Estou rodando em ${atual || 'um commit solto'}. Volte à ${BASE} e reinicie: todo trabalho parte dela.`,
      }
    }
    if (await git(repo, 'status', '--porcelain')) {
      return {
        ok: false,
        mensagem: 'A cópia em execução tem alterações não commitadas. Faça o commit antes.',
      }
    }
    if (await mainAtrasada()) {
      return { ok: false, mensagem: `A ${BASE} local está atrás do GitHub. Atualize e reinicie antes.` }
    }
    controle = new AbortController()
    mudar({ fase: 'trabalhando', etapa: 'preparando a cópia de trabalho' })
    void trabalhar(estado.id, estado.pedido)
    return { ok: true, mensagem: 'Trabalho iniciado. Você pode continuar usando o assistente.' }
  }

  return {
    estado: () => estado,
    /** Resolve quando a limpeza da partida terminar. */
    pronto,

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
        if (pedidoVago(texto)) {
          const ultimo = estado.ultimoPedido ? ` O último pedido foi: ${estado.ultimoPedido}` : ''
          return { ok: false, mensagem: `Isso não descreve uma alteração. Diga o pedido completo.${ultimo}` }
        }
        if (estado.fase === 'proposto') {
          return { ok: false, mensagem: 'Já há uma proposta aguardando. Confirme ou cancele antes.' }
        }
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
      if (acao === 'aprovar') {
        if (estado.fase !== 'testando') return { ok: false, mensagem: 'Não há alteração em teste.' }
        const branch = await nomeDaBranch(estado.entrega.branch)
        mudar({ fase: 'aplicando', etapa: `guardando em ${branch}`, resultado: undefined })
        vigiarTroca()
        supervisor({ type: 'autodev:aprovar', id: estado.id, branch })
        return { ok: true, mensagem: `Guardando na branch ${branch}.` }
      }
      if (acao === 'reverter') {
        if (!supervisor) return { ok: false, mensagem: 'Reverter exige o supervisor do npm start.' }
        if (estado.fase !== 'testando') {
          return { ok: false, mensagem: EM_CURSO.has(estado.fase) ? 'Há um trabalho em andamento.' : 'Já estou na versão segura.' }
        }
        mudar({ fase: 'aplicando', etapa: 'voltando à versão segura', resultado: undefined })
        vigiarTroca()
        supervisor({ type: 'autodev:reverter', id: estado.id })
        return { ok: true, mensagem: 'Voltando à versão segura.' }
      }
      return { ok: false, mensagem: `Ação desconhecida: ${acao}.` }
    },

    /** O resultado de uma troca, vindo do supervisor. */
    resultado({ id, tipo, mensagem, branch }) {
      clearTimeout(esperaTroca)
      if (tipo === 'em_teste') {
        mudar({ fase: 'testando', etapa: 'aguardando sua avaliação', testeDesde: Date.now() })
        return
      }
      // Recusou com a alteração ainda no ar: ela continua em teste.
      if (tipo === 'recusado' && existsSync(arqTransicao)) {
        mudar({ fase: 'testando', etapa: 'aguardando sua avaliação', resultado: { id, tipo, mensagem } })
        return
      }
      const { resumo } = estado
      const texto = tipo === 'aprovado' && resumo ? `${resumo} ${mensagem}` : mensagem
      mudar({ resumo: undefined, branch: undefined })
      terminar(id, tipo, texto, branch ? { branch } : {})
    },
  }
}
