/**
 * Teste de ponta a ponta do autodesenvolvimento: `npm run test:autodev:e2e`.
 *
 * Roda o ciclo de verdade — F.Ê.N.I.X., ponte, Vite, git e um Chrome headless com
 * a página real — num clone temporário, em portas próprias. Só o agente é falso,
 * trocado no clone: nenhum código de produção sabe deste teste. O Chrome fica mudo.
 *
 * Fora do `npm test` porque leva minutos e depende do Chrome instalado.
 */

import { obterLocal } from '../../bridge/tls.mjs'
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME =
  process.env.APOLO_CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PONTE = 18787
const PAGINA = 15173
const DEPURACAO = 19222

const AGENTE_FALSO = `
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
export async function rodarAgente({ pedido, pasta }) {
  const somar = (arquivo, texto) => appendFileSync(join(pasta, arquivo), texto)
  if (pedido.includes('QUEBRAR-NA-OBSERVACAO')) somar('bridge/ui.mjs', "\\nsetTimeout(() => { throw new Error('quebra') }, 12000)\\n")
  else if (pedido.includes('QUEBRAR-NO-TESTE')) somar('bridge/ui.mjs', "\\nsetTimeout(() => { throw new Error('quebra') }, 40000)\\n")
  else if (pedido.includes('ERRO-DE-TIPOS')) somar('src/ui/Hud.tsx', "\\nexport const quebrado: number = 'texto'\\n")
  else somar('src/index.css', '\\n.e2e-' + Date.now() + ' { color: red; }\\n')
  return { ok: true, texto: 'Mudei a tela.\\nBRANCH: teste-e2e\\nCOMMIT: Altera a tela no teste de ponta a ponta' }
}
`

const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms))

async function ate(descricao, cond, ms = 90_000) {
  const limite = Date.now() + ms
  for (;;) {
    const valor = await cond().catch(() => null)
    if (valor) return valor
    if (Date.now() > limite) throw new Error(`Não aconteceu a tempo: ${descricao}`)
    await dormir(300)
  }
}

const raiz = realpathSync(mkdtempSync(join(tmpdir(), 'apolo-e2e-')))
const clone = join(raiz, 'clone')
const pasta = join(raiz, 'autodev')
/** Onde a F.Ê.N.I.X. guarda a transição e os eventos (docs/adr/0025). */
const pastaDaFenix = join(raiz, 'fenix')
const projeto = process.cwd()

const git = (...args) => execFileSync('git', args, { cwd: clone, encoding: 'utf8' }).trim()
const branchAtual = () => git('branch', '--show-current')
const autodevs = () => git('for-each-ref', '--format=%(refname:short)', 'refs/heads/autodev')

function prepararClone() {
  execFileSync('git', ['clone', '-q', projeto, clone])
  git('switch', '-q', '-C', 'main', execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projeto, encoding: 'utf8' }).trim())
  git('remote', 'remove', 'origin')
  git('config', 'user.email', 'e2e@apolo.local')
  git('config', 'user.name', 'Teste E2E')
  // O que está na cópia de trabalho, mesmo sem commit: é isso que se quer testar.
  const arquivos = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: projeto, encoding: 'utf8' })
  for (const arquivo of arquivos.split('\n').filter(Boolean)) {
    if (existsSync(join(projeto, arquivo))) cpSync(join(projeto, arquivo), join(clone, arquivo))
  }
  symlinkSync(join(projeto, 'node_modules'), join(clone, 'node_modules'))
  writeFileSync(join(clone, 'bridge/autodev/agente.mjs'), AGENTE_FALSO)
  git('add', '-A')
  git('commit', '-qm', 'Agente falso do teste')
}

const ambiente = {
  ...process.env,
  JARVIS_BRIDGE_PORT: String(PONTE),
  PORT: String(PAGINA),
  VITE_BRIDGE_URL: `wss://localhost:${PONTE}`,
  APOLO_AUTODEV_PASTA: pasta,
  FENIX_PASTA: pastaDaFenix,
  FENIX_PORTA: '18790',
  APOLO_AUTODEV_VSCODE: '0',
}

let apolo = null

async function subir() {
  apolo = spawn(process.execPath, ['fenix/fenix.mjs', '--autodev'], {
    cwd: clone,
    env: ambiente,
    stdio: 'ignore',
  })
  await ate('a ponte subir', async () => (await obterLocal(`https://localhost:${PONTE}/health`)).ok)
  await ate('o Vite subir', async () => (await obterLocal(`https://localhost:${PAGINA}/`)).ok)
}

async function descer(sinal = 'SIGTERM') {
  const filho = apolo
  apolo = null
  if (filho && filho.exitCode === null) {
    const saiu = new Promise((ok) => filho.once('exit', ok))
    filho.kill(sinal)
    await saiu
  }
  await dormir(1000)
}

// ---- Chrome e página, por CDP -------------------------------------------------

let chrome = null
let cdp = null

async function abrirChrome() {
  chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--mute-audio',
      '--ignore-certificate-errors',
      `--remote-debugging-port=${DEPURACAO}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${join(raiz, 'chrome')}`,
      '--use-fake-ui-for-media-stream',
      '--enable-unsafe-swiftshader',
      '--no-first-run',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  const alvos = await ate('o Chrome subir', async () => {
    const lista = await (await fetch(`http://127.0.0.1:${DEPURACAO}/json`)).json()
    return lista.find((a) => a.type === 'page')
  })
  const ws = new WebSocket(alvos.webSocketDebuggerUrl)
  await new Promise((ok) => (ws.onopen = ok))
  let seq = 0
  const pendentes = new Map()
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data)
    pendentes.get(m.id)?.(m)
    pendentes.delete(m.id)
  }
  cdp = (method, params = {}) =>
    new Promise((ok) => {
      const id = ++seq
      pendentes.set(id, ok)
      ws.send(JSON.stringify({ id, method, params }))
    })
  await cdp('Page.enable')
}

async function naPagina(expressao) {
  const r = await cdp('Runtime.evaluate', {
    expression: expressao,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text)
  return r.result?.result?.value
}

async function abrirPagina() {
  await cdp('Page.navigate', { url: `https://localhost:${PAGINA}/` })
  // A página liga sozinha, sem tela de INICIAR.
  await ate('a página conectar', async () => (await saude()).interfaces > 0)
}

const saude = async () => (await obterLocal(`https://localhost:${PONTE}/health`)).json()
const estado = async () =>
  JSON.parse(
    (await naPagina(`import('/src/store.ts').then((m) => JSON.stringify(m.useStore.getState().autodev))`)) ?? 'null',
  )
const acao = async (nome, extra = {}) =>
  JSON.parse(
    await naPagina(
      `import('/src/lib/bridge.ts').then((m) => m.autodev(${JSON.stringify(nome)}, ${JSON.stringify(extra)})).then(JSON.stringify)`,
    ),
  )
const naFase = (fase, ms) =>
  ate(`a página mostrar a fase ${fase}`, async () => {
    const e = await estado()
    return e?.fase === fase ? e : null
  }, ms)

async function pedir(pedido) {
  // A ponte pode estar reiniciando depois do cenário anterior, e a página, reconectando.
  await ate('a ponte e a página estarem no ar', async () => (await saude()).interfaces > 0)
  assert.equal((await acao('propor', { pedido })).ok, true)
  assert.equal((await acao('confirmar')).ok, true)
}

async function ociosoCom(tipo, id) {
  return ate(`o resultado ${tipo} chegar à página`, async () => {
    const e = await estado()
    return e?.fase === 'ocioso' && e.resultado?.tipo === tipo && e.resultado.id !== id ? e : null
  })
}

function naVersaoSegura() {
  assert.equal(branchAtual(), 'main')
  assert.equal(autodevs(), '')
  assert.equal(existsSync(join(pastaDaFenix, 'transicao.json')), false)
  assert.equal(git('worktree', 'list').split('\n').length, 1)
}

// ---- Cenários -----------------------------------------------------------------

const cenarios = {
  async 'a voz não transforma "confirmo" em pedido'() {
    assert.equal((await acao('propor', { pedido: 'confirmo' })).ok, false)
  },
  async 'erro de tipos é recusado e não deixa branch'() {
    await pedir('ERRO-DE-TIPOS')
    const e = await ociosoCom('falhou')
    assert.match(e.resultado.mensagem, /tipos/)
    naVersaoSegura()
  },
  async 'aprovar gera fase-x.x/nome e volta à main'() {
    await pedir('alteracao simples')
    await naFase('testando')
    assert.match(branchAtual(), /^autodev\//)
    assert.equal((await acao('aprovar')).ok, true)
    const e = await ociosoCom('aprovado')
    assert.match(e.resultado.branch, /^fase-\d+(\.\d+)?\/teste-e2e$/)
    assert.equal(git('log', '-1', '--format=%s', e.resultado.branch), 'Altera a tela no teste de ponta a ponta')
    naVersaoSegura()
  },
  async 'descartar volta à main e apaga a alteração'() {
    await pedir('alteracao simples')
    await naFase('testando')
    await acao('reverter')
    await ociosoCom('revertido')
    naVersaoSegura()
  },
  async 'queda na observação: rollback, e a página fica sabendo'() {
    await pedir('QUEBRAR-NA-OBSERVACAO')
    const antes = (await estado()).resultado?.id
    const e = await ociosoCom('revertido', antes)
    assert.match(e.resultado.mensagem, /caiu/)
    assert.ok((await saude()).interfaces > 0)
    naVersaoSegura()
  },
  async 'queda durante o teste: volta sozinha e continua no ar'() {
    await pedir('QUEBRAR-NO-TESTE')
    await naFase('testando')
    const e = await ociosoCom('revertido', (await estado()).resultado?.id)
    assert.match(e.resultado.mensagem, /caiu/)
    assert.ok((await saude()).ok)
    naVersaoSegura()
  },
  async 'npm start sem aprovação volta à main'() {
    await pedir('alteracao simples')
    await naFase('testando')
    await descer('SIGKILL')
    await subir()
    await abrirPagina()
    await ate('voltar à main', async () => branchAtual() === 'main' && autodevs() === '')
    naVersaoSegura()
  },
  async 'npm run rollback volta direto à main'() {
    await pedir('alteracao simples')
    await naFase('testando')
    await descer()
    assert.match(branchAtual(), /^autodev\//)
    execFileSync(process.execPath, ['fenix/fenix.mjs', 'rollback'], { cwd: clone, env: ambiente, stdio: 'ignore' })
    naVersaoSegura()
    await subir()
    await abrirPagina()
    assert.equal((await naFase('ocioso')).fase, 'ocioso')
  },
}

// ---- Execução -----------------------------------------------------------------

if (!existsSync(CHROME)) {
  console.error(`Chrome não encontrado em ${CHROME}. Indique outro com APOLO_CHROME_BIN.`)
  process.exit(1)
}

let falhas = 0
try {
  prepararClone()
  await abrirChrome()
  await subir()
  await abrirPagina()
  for (const [nome, cenario] of Object.entries(cenarios)) {
    const inicio = Date.now()
    try {
      await cenario()
      console.log(`✔ ${nome} (${Math.round((Date.now() - inicio) / 1000)} s)`)
    } catch (err) {
      falhas++
      console.log(`✖ ${nome}: ${err.message}`)
      break // o próximo cenário herdaria um estado desconhecido
    }
  }
} finally {
  await descer().catch(() => {})
  chrome?.kill('SIGKILL')
  for (const porta of [PONTE, PAGINA]) {
    const pids = spawnSync('lsof', ['-ti', `tcp:${porta}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).stdout
    for (const pid of pids.split(/\s+/).filter(Boolean)) process.kill(Number(pid), 'SIGTERM')
  }
  await dormir(500)
  if (falhas) console.log(`Clone mantido para investigação: ${clone}`)
  else rmSync(raiz, { recursive: true, force: true })
}
process.exit(falhas ? 1 : 0)
