/**
 * O pacto entre A.P.O.L.O. e F.Ê.N.I.X. (docs/adr/0028), com processos de verdade:
 * a Fênix de fenix/fenix.mjs, um repositório Git e uma ponte mínima que usa o
 * mesmo cliente e o mesmo renascimento da ponte real (scripts/resiliencia/ponte.mjs).
 *
 *   1. O A.P.O.L.O. gera uma branch que o mata; a Fênix sobe, percebe e volta à main.
 *   2. A Fênix morre; o A.P.O.L.O. a traz de volta das cinzas.
 *   3. A Fênix renascida ainda guarda: outra branch problemática, outra volta à main.
 *
 * Tudo em portas livres e pastas temporárias, com prazos curtos no fenix.config.json
 * do teste. Leva uns 30 segundos. `npm run test:resiliencia` roda só este.
 */
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PROJETO = fileURLToPath(new URL('..', import.meta.url))
const raiz = realpathSync(mkdtempSync(join(tmpdir(), 'apolo-resiliencia-')))
const repo = join(raiz, 'repo')
const pastaDaFenix = join(raiz, 'fenix')
const saida = join(raiz, 'saida')

const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

const portaLivre = () =>
  new Promise((resolve, reject) => {
    const s = createServer()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })

const vivo = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

let portaDaPonte
let fenix = null
let logDaFenix = ''

async function ate(descricao, cond, ms = 30_000) {
  const limite = Date.now() + ms
  for (;;) {
    const valor = await cond().catch(() => null)
    if (valor) return valor
    if (Date.now() > limite) {
      throw new Error(`Não aconteceu a tempo: ${descricao}\n--- fenix ---\n${logDaFenix.slice(-3000)}\n--- ponte ---\n${eventosDaPonte().map(JSON.stringify).join('\n').slice(-3000)}`)
    }
    await dormir(150)
  }
}

const saude = async () => {
  const r = await fetch(`http://127.0.0.1:${portaDaPonte}/health`, { signal: AbortSignal.timeout(1000) })
  return r.ok ? r.json() : null
}

const eventosDaPonte = () => {
  try {
    return readFileSync(join(saida, 'ponte.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  } catch {
    return []
  }
}

const eventosDaFenix = () => {
  try {
    return readFileSync(join(pastaDaFenix, 'eventos.log'), 'utf8')
  } catch {
    return ''
  }
}

/** A ponte de pé, falando com a Fênix. */
const ponteNoAr = (descricao = 'a ponte subir e conectar à Fênix') =>
  ate(descricao, async () => {
    const s = await saude()
    return s?.fenix ? s : null
  })

function naVersaoSegura() {
  assert.equal(git('branch', '--show-current'), 'main')
  assert.equal(git('for-each-ref', '--format=%(refname:short)', 'refs/heads/autodev'), '')
  assert.equal(git('status', '--porcelain'), '')
  assert.equal(existsSync(join(pastaDaFenix, 'transicao.json')), false)
}

/** O A.P.O.L.O. gera a branch, a Fênix sobe, percebe e volta: o resultado chega à ponte nova. */
async function branchProblematicaVoltaAMain(modo) {
  const pedido = await (await fetch(`http://127.0.0.1:${portaDaPonte}/quebrar?modo=${modo}`, { method: 'POST' })).json()
  assert.equal(pedido.ok, true, JSON.stringify(pedido))
  assert.match(pedido.branch, /^autodev\//)
  const resultado = await ate(`o rollback da branch ${modo} chegar à ponte`, async () =>
    eventosDaPonte().find((e) => e.tipo === 'resultado' && e.id === pedido.id && e.resultado === 'revertido'),
  )
  const s = await ponteNoAr('a versão segura voltar ao ar')
  assert.equal(s.versao, 'main')
  naVersaoSegura()
  assert.match(eventosDaFenix(), new RegExp(`descartada|rollback para main`))
  return { pedido, resultado }
}

/** O ambiente do teste, sem nada da Fênix ou do A.P.O.L.O. que esteja rodando este teste. */
function ambiente(extra) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(FENIX_|JARVIS_|APOLO_|HERMES_)/.test(k)))
  return { ...env, ...extra }
}

before(async () => {
  mkdirSync(repo)
  mkdirSync(saida)
  portaDaPonte = await portaLivre()
  const portaDaFenix = await portaLivre()

  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'resiliencia@apolo.local')
  git('config', 'user.name', 'Teste de resiliência')
  const ponte = readFileSync(join(PROJETO, 'scripts/resiliencia/ponte.mjs'), 'utf8').replace(
    /'\.\.\/\.\.\/(bridge\/[a-z]+\.mjs)'/g,
    (_, arquivo) => `'${pathToFileURL(join(PROJETO, arquivo)).href}'`,
  )
  writeFileSync(join(repo, 'ponte.mjs'), ponte)
  writeFileSync(join(repo, 'versao.txt'), 'main\n')
  writeFileSync(
    join(repo, 'fenix.config.json'),
    JSON.stringify(
      {
        nome: 'Resiliência',
        repositorio: '.',
        versaoSegura: 'main',
        pasta: pastaDaFenix,
        escuta: { host: '127.0.0.1', porta: portaDaFenix },
        servicos: [
          {
            nome: 'ponte',
            comando: ['node', 'ponte.mjs'],
            versionado: true,
            portas: [String(portaDaPonte)],
            saude: { urls: [`http://127.0.0.1:${portaDaPonte}/health`], clientes: 'interfaces', prazoMs: 800 },
          },
        ],
        protecao: { revisao: [], branch: '^fase-\\d+(\\.\\d+)*\\/[a-z0-9]+(-[a-z0-9]+)*$' },
        tempos: {
          servicos: { esperasMs: [200, 400, 800, 1500], intervaloMs: 300, subidaMs: 8000 },
          versoes: { subidaMs: 6000, estabilidadeMs: 3000, intervaloMs: 200, vigiaMs: 400 },
        },
      },
      null,
      2,
    ),
  )
  git('add', '-A')
  git('commit', '-qm', 'Versão segura')

  fenix = spawn(process.execPath, [join(PROJETO, 'fenix/fenix.mjs'), '--config', join(repo, 'fenix.config.json')], {
    cwd: repo,
    env: ambiente({ PONTE_PORTA: String(portaDaPonte), RESILIENCIA_SAIDA: saida }),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  fenix.stdout.on('data', (d) => (logDaFenix += d))
  fenix.stderr.on('data', (d) => (logDaFenix += d))
  await ponteNoAr()
})

after(async () => {
  // Quem estiver guardando agora (a original ou a renascida) encerra a ponte junto.
  const guardia = await saude().then((s) => s?.ppid).catch(() => null)
  for (const pid of [fenix?.pid, guardia]) if (pid && vivo(pid)) process.kill(pid, 'SIGTERM')
  await ate('tudo encerrar', async () => ![fenix?.pid, guardia].some((p) => p && vivo(p)), 10_000).catch(() => {})
  rmSync(raiz, { recursive: true, force: true })
})

test('o A.P.O.L.O. gera uma branch que o derruba depois de subir; a Fênix percebe e volta à main', { timeout: 60_000 }, async () => {
  const { pedido, resultado } = await branchProblematicaVoltaAMain('queda')
  // A Fênix subiu mesmo a branch: a ponte dela chegou a iniciar antes de morrer.
  assert.ok(eventosDaPonte().some((e) => e.tipo === 'iniciou' && e.branch === pedido.branch))
  assert.match(resultado.mensagem, /caiu/)
})

test('o A.P.O.L.O. gera uma branch com erro de sintaxe; ela nem sobe, e a Fênix volta à main', { timeout: 60_000 }, async () => {
  const { pedido, resultado } = await branchProblematicaVoltaAMain('sintaxe')
  assert.equal(eventosDaPonte().some((e) => e.tipo === 'iniciou' && e.branch === pedido.branch), false)
  assert.match(resultado.mensagem, /rollback/)
})

test('a Fênix morre e o A.P.O.L.O. a traz de volta das cinzas', { timeout: 60_000 }, async () => {
  const antes = await ponteNoAr()
  assert.equal(antes.ppid, fenix.pid, 'a ponte é filha da Fênix original')
  const saiu = new Promise((r) => fenix.once('exit', r))
  fenix.kill('SIGKILL')
  await saiu

  const depois = await ate('uma Fênix nova subir uma ponte nova', async () => {
    const s = await saude()
    return s?.fenix && s.pid !== antes.pid && s.ppid !== fenix.pid ? s : null
  })
  assert.ok(vivo(depois.ppid), 'a Fênix renascida está viva')
  assert.equal(vivo(antes.pid), false, 'a ponte antiga, filha da morta, saiu do caminho')
  assert.match(readFileSync(join(pastaDaFenix, 'renascimentos.log'), 'utf8'), new RegExp(`processo ${fenix.pid}\\)`))
  assert.match(eventosDaFenix(), /renasci: o A\.P\.O\.L\.O\. me trouxe de volta/)
  // A saída dela vai para um arquivo: o terminal morreu com a anterior.
  await ate('a Fênix renascida escrever no próprio log', async () => /guardando Resiliência/.test(readFileSync(join(pastaDaFenix, 'fenix.log'), 'utf8')))
  naVersaoSegura()
})

test('a Fênix renascida continua guardando: outra branch que trava volta à main', { timeout: 60_000 }, async () => {
  const { resultado } = await branchProblematicaVoltaAMain('trava')
  assert.match(resultado.mensagem, /parou de responder|caiu/)
})
