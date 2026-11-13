/**
 * O H.E.R.M.E.S. sem a F.Ê.N.I.X. (docs/adr/0029): sobe sozinho, responde a
 * saúde, e continua de pé quando quem o subiu morre.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { createServer, get, request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const HERMES = fileURLToPath(new URL('../hermes.mjs', import.meta.url))
const PASTA_DO_MODULO = fileURLToPath(new URL('..', import.meta.url))
const temp = () => realpathSync(mkdtempSync(join(tmpdir(), 'hermes-independente-')))
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

const portaLivre = () =>
  new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })

const obter = (url) =>
  new Promise((resolve) => {
    get(url, (r) => {
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
function ambiente(extra) {
  const casa = temp()
  const env = { PATH: process.env.PATH, HOME: casa, HERMES_PASTA: join(casa, 'hermes'), ...extra }
  return env
}

test('nada do H.E.R.M.E.S. importa código de fora dele nem lê variáveis da Fênix', () => {
  const arquivos = []
  const andar = (d) => {
    for (const n of readdirSync(d)) {
      const c = join(d, n)
      if (n === 'node_modules') continue
      if (statSync(c).isDirectory()) andar(c)
      else if (c.endsWith('.mjs') && !c.includes(`${join('hermes', 'test')}`)) arquivos.push(c)
    }
  }
  andar(PASTA_DO_MODULO)
  for (const arquivo of arquivos) {
    const codigo = readFileSync(arquivo, 'utf8')
    for (const [, alvo] of codigo.matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)) {
      const permitido = alvo.startsWith('node:') || alvo === 'ws' || (alvo.startsWith('./') && !alvo.includes('..'))
      assert.ok(permitido, `${arquivo} importa ${alvo}`)
    }
    assert.equal(/FENIX_/.test(codigo), false, `${arquivo} lê uma variável da Fênix`)
  }
})

test('sobe sem a Fênix e responde a saúde, com e sem notificações', async (t) => {
  const porta = await portaLivre()
  const so = spawn(process.execPath, [HERMES], {
    env: ambiente({ HERMES_NOTIFICAR_TOKEN: 'n'.repeat(40), HERMES_NOTIFICAR_PORTA: String(porta) }),
    stdio: 'ignore',
  })
  t.after(() => so.kill('SIGKILL'))
  const r = await esperarSaude(`http://127.0.0.1:${porta}/saude`)
  assert.deepEqual(r.corpo, { servico: 'hermes', ok: true, celular: false, notificacoes: true, ntfy: false })

  const [local, celular] = [await portaLivre(), await portaLivre()]
  const soCelular = spawn(process.execPath, [HERMES], {
    env: ambiente({ HERMES_TOKEN: 'c'.repeat(40), HERMES_NOTIFICAR_PORTA: String(local), HERMES_PORTA: String(celular) }),
    stdio: 'ignore',
  })
  t.after(() => soCelular.kill('SIGKILL'))
  const s = await esperarSaude(`http://127.0.0.1:${local}/saude`)
  assert.equal(s.corpo.celular, true)
  assert.equal(s.corpo.notificacoes, false)
})

test('continua de pé quando quem o subiu morre, e registra o porquê', async (t) => {
  const porta = await portaLivre()
  const env = ambiente({ HERMES_NOTIFICAR_TOKEN: 'n'.repeat(40), HERMES_NOTIFICAR_PORTA: String(porta) })
  // Um pai que lê a saída por um cano, como a Fênix, e morre sem cerimônia.
  const pai = spawn(
    process.execPath,
    [
      '-e',
      `const f = require('node:child_process').spawn(process.execPath, [${JSON.stringify(HERMES)}], { stdio: ['ignore', 'pipe', 'pipe'] });
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
  await dormir(300)
  // Uma linha de saída logo depois (aqui, a recusa de um token errado): sem a
  // proteção, o cano quebrado derruba o processo no primeiro console.log.
  await new Promise((resolve) => {
    const q = request(`http://127.0.0.1:${porta}/notificacoes`, {
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', Authorization: 'Bearer errado', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGVzdGUtZG8taGVybWVzIQ==' },
    })
    q.on('error', resolve)
    q.on('response', resolve)
    q.on('upgrade', resolve)
    q.on('close', resolve)
    q.end()
  })
  await dormir(3000)
  const depois = await obter(`http://127.0.0.1:${porta}/saude`)
  assert.equal(depois.status, 200, 'o H.E.R.M.E.S. caiu junto com quem o subiu')
  const registro = readFileSync(join(env.HERMES_PASTA, 'hermes.log'), 'utf8')
  assert.match(registro, /\[hermes\] .+; sigo de pé sozinho/)
})
