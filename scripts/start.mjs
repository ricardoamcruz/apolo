/**
 * One command to run JARVIS: the bridge (brain) and the Vite dev server (face)
 * together, so a student types `npm start` and nothing else.
 *
 * Two long-running processes normally mean two terminals. This launcher spawns
 * both as children, tags their output so you can tell them apart, and shuts
 * them down together on Ctrl-C — no extra dependency, just Node.
 *
 * Pass --writes to allow JARVIS to take real actions (drive the phone, the
 * browser, send things): `npm start -- --writes`.
 *
 * Passe --autodev para permitir que o A.P.O.L.O. altere o próprio código quando
 * você pedir e confirmar (docs/adr/0011): `npm start -- --autodev`.
 */

// Primeiro de todos: quem sobe o sistema precisa ver as mesmas variáveis que a
// ponte, e o .env.local tem de estar na memória antes de politica.mjs ser
// avaliado (ver bridge/env.mjs). Os filhos herdam este process.env.
import '../bridge/env.mjs'
import { spawn, spawnSync } from 'node:child_process'
import process from 'node:process'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { criarSupervisor, saudeHttp } from './supervisor.mjs'
import { PASTA_AUTODEV } from '../bridge/autodev/politica.mjs'
import { certificadoConfiavel, garantirCertificado } from '../bridge/tls.mjs'

/**
 * Put MediaPipe's WebAssembly where the page can actually load it.
 *
 * Hand tracking needs a WASM runtime, and the usual recipe fetches it from a
 * CDN. That fails here twice over. The page's CSP names no CDN in `script-src`,
 * and the runtime arrives as a script — so it is blocked, and the failure
 * surfaces as gesture control simply never starting. And a CDN import is a live
 * supply-chain dependency: executable code, re-resolved on every load, that we
 * do not control and cannot pin against being changed under us.
 *
 * Copying it out of node_modules solves both. It is served from our own origin,
 * so `'self'` covers it; and it is the exact bytes of the version in the
 * lockfile. It stays out of git — 34 MB of build output does not belong in a
 * repository — and is re-copied whenever it is missing, which costs nothing
 * after the first run.
 */
function vendorWasm() {
  const from = 'node_modules/@mediapipe/tasks-vision/wasm'
  const to = 'public/mediapipe'
  if (!existsSync(from)) return // gesture control is optional; carry on without it
  if (existsSync(`${to}/vision_wasm_internal.wasm`)) return
  try {
    mkdirSync(to, { recursive: true })
    cpSync(from, to, { recursive: true })
    console.log('  runtime de rastreamento das mãos copiado para public/mediapipe.')
  } catch (err) {
    console.warn(`  não foi possível copiar o runtime das mãos: ${err.message}`)
  }
}

const writes = process.argv.includes('--writes')
const selfDev = process.argv.includes('--autodev')

// A dim label per process, so the interleaved logs stay readable.
const paint = (tag, colour) => (line) =>
  line
    .toString()
    .split('\n')
    .filter((l) => l.length)
    .map((l) => `\x1b[${colour}m${tag}\x1b[0m ${l}`)
    .join('\n')

const children = []

function run(name, command, args, colour, env, stdio = ['ignore', 'pipe', 'pipe']) {
  const label = paint(name, colour)
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    shell: false,
    stdio,
  })
  child.stdout.on('data', (d) => process.stdout.write(label(d) + '\n'))
  child.stderr.on('data', (d) => process.stderr.write(label(d) + '\n'))
  child.on('exit', (code) => {
    children.splice(children.indexOf(child), 1)
    if (child === bridge) bridge = null
    // Saída pedida pelo supervisor, ou queda que ele está analisando.
    if (child.planned || (name === 'bridge' && supervisor.ponteSaiu(code))) return
    // If either half dies the other is useless, so take the whole thing down
    // rather than leave a half-running app that looks alive but cannot answer.
    console.log(`\x1b[${colour}m${name}\x1b[0m encerrou (${code}); parando o resto.`)
    shutdown(code ?? 0)
  })
  children.push(child)
  return child
}

let stopping = false
function shutdown(code) {
  if (stopping) return
  stopping = true
  for (const c of children) {
    try {
      c.kill('SIGTERM')
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(code), 300)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

/**
 * Tell the bridge which port the face will actually be on.
 *
 * The bridge only trusts WebSocket origins on localhost:5173-5199 and
 * 4173-4199, which is the right default — a socket that any local page can open
 * is a socket that drives every MCP server on the machine. But a launcher that
 * assigns a port outside that range produces the single most confusing failure
 * this project has: the interface loads, the reactor spins, the microphone
 * hears you, and the brain answers nothing, because the handshake is being 403'd
 * somewhere neither half reports. Passing the port through closes that gap
 * without widening what the bridge trusts by default.
 */
const port = process.env.PORT
const bridgeEnv = {
  ...(writes ? { JARVIS_ALLOW_WRITES: '1' } : {}),
  ...(selfDev ? { APOLO_AUTODEV: '1' } : {}),
}
if (port) {
  bridgeEnv.JARVIS_ALLOWED_ORIGINS = `https://localhost:${port},https://127.0.0.1:${port}`
  console.log(`  interface na porta ${port}; a ponte vai aceitá-la.\n`)
}

/**
 * Encerra um A.P.O.L.O. antigo que tenha ficado rodando.
 *
 * Um `npm start` esquecido num terminal do VS Code segura a porta 8787, a ponte
 * nova não consegue subir e a página continua falando com a versão velha — sem
 * nenhum aviso óbvio. Só mata processos que são nossos: a ponte
 * (bridge/server.mjs) ou o Vite deste projeto. Qualquer outro programa na porta
 * é deixado em paz e o aviso de porta ocupada aparece normalmente.
 */
function stopStale() {
  const ports = [Number(process.env.JARVIS_BRIDGE_PORT ?? 8787), Number(port) || 5173]
  let killed = 0
  for (const p of ports) {
    const found = spawnSync('lsof', ['-ti', `tcp:${p}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
    for (const pid of (found.stdout ?? '').split(/\s+/).filter(Boolean)) {
      if (Number(pid) === process.pid) continue
      const cmd = spawnSync('ps', ['-o', 'command=', '-p', pid], { encoding: 'utf8' }).stdout ?? ''
      const cwd = spawnSync('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'], { encoding: 'utf8' }).stdout ?? ''
      const ours =
        /bridge\/server\.mjs/.test(cmd) ||
        (/vite/.test(cmd) && cwd.includes(process.cwd()))
      if (!ours) continue
      try {
        process.kill(Number(pid), 'SIGTERM')
        killed++
        console.log(`  encerrei um A.P.O.L.O. antigo na porta ${p} (processo ${pid}).`)
      } catch {
        /* já tinha saído */
      }
    }
  }
  // Dá um instante para o sistema liberar as portas antes de subir as novas.
  if (killed) spawnSync('sleep', ['1'])
}

stopStale()
vendorWasm()

// Sem confiança, a página até abre com um aviso, mas a conexão com a ponte falha calada.
if (certificadoConfiavel(garantirCertificado().caminho) === false) {
  console.warn('\n  O sistema ainda não confia no certificado: rode npm run https uma vez.\n')
}

/** A ponte em execução. Ela troca a cada autodesenvolvimento; o Vite fica. */
let bridge = null

function startBridge() {
  // O canal 'ipc' é por onde a ponte pede a troca de versão ao supervisor.
  bridge = run('bridge', 'node', ['bridge/server.mjs'], '36', bridgeEnv, [
    'ignore',
    'pipe',
    'pipe',
    'ipc',
  ])
  bridge.on('message', (msg) => {
    if (msg?.type === 'autodev:aplicar') void supervisor.aplicar(msg)
    if (msg?.type === 'autodev:aprovar') void supervisor.aprovar(msg)
    if (msg?.type === 'autodev:reverter') void supervisor.reverter(msg)
  })
}

function stopBridge() {
  const child = bridge
  if (!child) return Promise.resolve()
  return new Promise((resolve) => {
    child.planned = true
    const force = setTimeout(() => child.kill('SIGKILL'), 5000)
    child.once('exit', () => {
      clearTimeout(force)
      resolve()
    })
    child.kill('SIGTERM')
  })
}

const supervisor = criarSupervisor({
  repo: process.cwd(),
  pasta: PASTA_AUTODEV,
  ligar: startBridge,
  desligar: stopBridge,
  saude: () =>
    saudeHttp({
      portaPonte: Number(process.env.JARVIS_BRIDGE_PORT ?? 8787),
      portaInterface: Number(port) || 5173,
    }),
  notificar: (resultado) => bridge?.send({ type: 'autodev:resultado', ...resultado }, () => {}),
  log: (linha) => console.log(linha),
})

// Antes de subir qualquer coisa: o que não foi aprovado volta para a versão segura.
const interrompida = await supervisor.recuperar().catch((err) => {
  console.error(`Não consegui voltar à versão segura: ${err.message}`)
  console.error('Resolva o que o Git apontou e rode npm run rollback.')
  process.exit(1)
})

console.log('\nA.P.O.L.O. iniciando — o cérebro e a interface.\n')
startBridge()
if (interrompida) {
  bridge.send({
    type: 'autodev:resultado',
    id: interrompida.id,
    tipo: interrompida.aprovada ? 'aprovado' : 'revertido',
    mensagem: interrompida.aprovada
      ? 'A alteração aprovada está guardada na branch e a versão segura voltou ao ar.'
      : 'Uma alteração em teste foi interrompida; a versão segura voltou ao ar.',
  })
}
// npm is a shell script on most systems; call the vite binary directly so we do
// not need shell:true (which would break the argument handling above).
run('face', process.execPath, ['node_modules/vite/bin/vite.js'], '35', {})

console.log(
  '\nQuando o servidor de desenvolvimento estiver pronto, abra no Chrome o endereço\n' +
    'que ele mostrar e fale normalmente: a interface liga sozinha.\n' +
    'Ctrl-C encerra tudo.\n',
)
