/**
 * Uma ponte mínima para scripts/resiliencia.test.mjs (docs/adr/0028).
 *
 * Usa as mesmas peças da ponte de verdade para falar com a F.Ê.N.I.X. e para
 * revivê-la (bridge/fenix.mjs e bridge/renascer.mjs); o resto da ponte (voz,
 * agente, interface) não importa para a resiliência e ficaria lento demais. O
 * teste copia este arquivo para um repositório temporário, trocando os imports
 * relativos por caminhos absolutos.
 *
 *   GET  /health            o que a Fênix confere, e o que o teste precisa ver
 *   POST /quebrar?modo=...  o A.P.O.L.O. gera uma branch que o mata (queda, sintaxe)
 *                           e pede à Fênix para subi-la, como o autodev faz
 *
 * Tudo o que acontece vai, uma linha JSON por evento, para RESILIENCIA_SAIDA.
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { criarClienteFenix } from '../../bridge/fenix.mjs'
import { criarRenascimento, lerReceita } from '../../bridge/renascer.mjs'

const REPO = process.cwd()
const PORTA = Number(process.env.PONTE_PORTA)
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const versao = readFileSync(join(REPO, 'versao.txt'), 'utf8').trim()

const registrar = (evento) =>
  appendFileSync(join(process.env.RESILIENCIA_SAIDA, 'ponte.jsonl'), `${JSON.stringify({ pid: process.pid, ...evento })}\n`)

registrar({ tipo: 'iniciou', branch: git(REPO, 'rev-parse', '--abbrev-ref', 'HEAD'), versao })

let renascimento = null
const fenix = criarClienteFenix({
  url: process.env.FENIX_URL,
  token: process.env.FENIX_TOKEN,
  log: () => {},
  aoMudar: (conectada) => {
    registrar({ tipo: conectada ? 'conectou' : 'perdeu' })
    if (!conectada) renascimento?.vigiar()
  },
  aoReceber: (msg) => {
    if (msg.type === 'versao:resultado') registrar({ tipo: 'resultado', id: msg.id, resultado: msg.tipo, mensagem: msg.mensagem })
  },
})
renascimento = criarRenascimento({
  receita: lerReceita(),
  conectado: () => Boolean(fenix?.conectado()),
  log: (linha) => registrar({ tipo: 'log', linha }),
})

/** O código mal escrito de cada modo: o que um agente poderia entregar. */
const VENENO = {
  // Passa na partida e morre logo depois, como um erro que só aparece rodando.
  queda: "\nsetTimeout(() => { throw new Error('código mal escrito') }, 1500)\n",
  // Nem chega a subir.
  sintaxe: "\nconst = 'código mal escrito'\n",
  // Fica de pé, mas trava: o processo existe e não responde mais.
  trava: '\nsetTimeout(() => { for (;;) {} }, 1500)\n',
}

/** Como o autodev: uma cópia separada a partir do que está no ar, commit, branch e o pedido à Fênix. */
function gerarBranchProblematica(modo) {
  const id = `${Date.now()}`
  const branch = `autodev/${id}`
  const copia = join(mkdtempSync(join(tmpdir(), 'resiliencia-copia-')), 'copia')
  git(REPO, 'worktree', 'add', '-q', '--detach', copia, 'HEAD')
  try {
    appendFileSync(join(copia, 'ponte.mjs'), VENENO[modo])
    git(copia, 'commit', '-qam', `Branch problemática: ${modo}`)
    const sha = git(copia, 'rev-parse', 'HEAD')
    git(REPO, 'branch', branch, sha)
    fenix.enviar({ type: 'versao:aplicar', id, sha, branch, interfaces: 0 })
    registrar({ tipo: 'pediu', id, branch, modo })
    return { ok: true, id, branch }
  } finally {
    git(REPO, 'worktree', 'remove', '--force', copia)
  }
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const json = (status, corpo) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(corpo))
  }
  if (url.pathname === '/health') {
    return json(200, { ok: true, interfaces: 0, pid: process.pid, ppid: process.ppid, versao, fenix: Boolean(fenix?.conectado()) })
  }
  if (url.pathname === '/quebrar' && req.method === 'POST') {
    const modo = url.searchParams.get('modo') ?? 'queda'
    if (!VENENO[modo]) return json(400, { ok: false })
    try {
      return json(200, gerarBranchProblematica(modo))
    } catch (err) {
      return json(500, { ok: false, mensagem: err.message })
    }
  }
  json(404, {})
}).listen(PORTA, '127.0.0.1')
