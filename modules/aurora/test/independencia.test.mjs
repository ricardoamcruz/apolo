/**
 * A A.U.R.O.R.A. sem a F.Ê.N.I.X. (docs/adr/0029): sobe sozinha, responde a
 * saúde e o bom dia protegido por token, e continua de pé quando quem a subiu morre.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { createServer, get } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const AURORA = fileURLToPath(new URL('../aurora.mjs', import.meta.url))
const PASTA_DO_MODULO = fileURLToPath(new URL('..', import.meta.url))
const TOKEN = 'a'.repeat(40)
const temp = () => realpathSync(mkdtempSync(join(tmpdir(), 'aurora-independente-')))
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

const portaLivre = () =>
  new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })

const obter = (url, headers = {}) =>
  new Promise((resolve) => {
    get(url, { headers }, (r) => {
      let corpo = ''
      r.on('data', (p) => (corpo += p))
      r.on('end', () => resolve({ status: r.statusCode, corpo: JSON.parse(corpo || 'null') }))
    }).on('error', (err) => resolve({ status: 0, erro: err.code }))
  })

async function esperarSaude(url) {
  for (let i = 0; i < 100; i++) {
    const r = await obter(url)
    if (r.status === 200) return r
    await dormir(50)
  }
  throw new Error(`${url} não respondeu`)
}

/** Um ambiente limpo: nada da Fênix, nada do .env.local, uma casa vazia. */
const ambiente = (porta) => {
  const casa = temp()
  return { PATH: process.env.PATH, HOME: casa, AURORA_PASTA: join(casa, 'aurora'), AURORA_TOKEN: TOKEN, AURORA_PORTA: String(porta) }
}

test('nada da A.U.R.O.R.A. importa código de fora dela nem lê variáveis da Fênix', () => {
  const arquivos = []
  const andar = (d) => {
    for (const n of readdirSync(d)) {
      const c = join(d, n)
      if (n === 'node_modules' || n === 'test') continue
      if (statSync(c).isDirectory()) andar(c)
      else if (c.endsWith('.mjs')) arquivos.push(c)
    }
  }
  andar(PASTA_DO_MODULO)
  assert.ok(arquivos.length > 3)
  for (const arquivo of arquivos) {
    const codigo = readFileSync(arquivo, 'utf8')
    for (const [, alvo] of codigo.matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)) {
      const permitido = alvo.startsWith('node:') || (alvo.startsWith('./') && !alvo.includes('..'))
      assert.ok(permitido, `${arquivo} importa ${alvo}`)
    }
    assert.equal(/FENIX_/.test(codigo), false, `${arquivo} lê uma variável da Fênix`)
  }
})

test('sobe sem a Fênix: saúde aberta, bom dia só com token', async (t) => {
  const porta = await portaLivre()
  const a = spawn(process.execPath, [AURORA], { env: ambiente(porta), stdio: 'ignore' })
  t.after(() => a.kill('SIGKILL'))
  const r = await esperarSaude(`http://127.0.0.1:${porta}/saude`)
  assert.equal(r.corpo.ok, true)
  assert.equal(r.corpo.servico, 'aurora')
  assert.equal((await obter(`http://127.0.0.1:${porta}/bom-dia`)).status, 401)
})

test('continua de pé quando quem a subiu morre, e registra o porquê', async (t) => {
  const porta = await portaLivre()
  const env = ambiente(porta)
  const pai = spawn(
    process.execPath,
    [
      '-e',
      `const f = require('node:child_process').spawn(process.execPath, [${JSON.stringify(AURORA)}], { stdio: ['ignore', 'pipe', 'pipe'] });
       f.stdout.on('data', () => {}); console.log(f.pid)`,
    ],
    { env, stdio: ['ignore', 'pipe', 'ignore'] },
  )
  const pid = Number(await new Promise((r) => pai.stdout.once('data', (d) => r(String(d).trim()))))
  t.after(() => {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* já saiu */
    }
  })
  await esperarSaude(`http://127.0.0.1:${porta}/saude`)
  pai.kill('SIGKILL')
  await dormir(3000)
  assert.equal((await obter(`http://127.0.0.1:${porta}/saude`)).status, 200, 'a A.U.R.O.R.A. caiu junto com quem a subiu')
  assert.match(readFileSync(join(env.AURORA_PASTA, 'aurora.log'), 'utf8'), /\[aurora\] .+; sigo de pé sozinha/)
})
