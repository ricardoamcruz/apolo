/**
 * Testes do H.E.R.M.E.S.: a porta do celular e o relé até o assistente.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { WebSocket, WebSocketServer } from 'ws'
import { createServer } from 'node:http'
import { CAMINHO, chaveDeMidia, criarGateway, tokenConfere } from '../src/gateway.mjs'
import { CAMINHO_NO_ASSISTENTE, criarRele, tokenDerivado } from '../src/rele.mjs'

const TOKEN = 'a'.repeat(43)
let gateway
let porta
const conexoes = []
const midia = []

before(async () => {
  gateway = criarGateway({
    token: TOKEN,
    porta: 0,
    atender: (ws) => conexoes.push(ws),
    servirMidia: (req, res, base) => {
      midia.push({ url: req.url, origem: req.headers.origin, base })
      res.end('ok')
    },
  })
  porta = await gateway.ligar()
})
after(() => gateway.fechar())

const abrir = (headers = {}, caminho = CAMINHO) =>
  new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${porta}${caminho}`, { headers })
    ws.on('open', () => {
      ws.close()
      resolve('aberto')
    })
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode))
    ws.on('error', () => {})
  })

test('sem o token certo, o canal não abre', async () => {
  const antes = conexoes.length
  assert.equal(await abrir(), 401)
  assert.equal(await abrir({ Authorization: 'Bearer errado' }), 401)
  assert.equal(await abrir({ Authorization: `Basic ${TOKEN}` }), 401)
  assert.equal(conexoes.length, antes)
})

test('com o token certo, o canal abre, com qualquer Origin', async () => {
  const antes = conexoes.length
  const headers = { Authorization: `Bearer ${TOKEN}`, Origin: 'https://mac.ts.net' }
  assert.equal(await abrir(headers), 'aberto')
  assert.equal(conexoes.length, antes + 1)
})

test('a mídia dos popups passa só com a chave, só por GET e só nas quatro rotas', async () => {
  const chave = chaveDeMidia(TOKEN)
  const obter = (caminho, opcoes) => fetch(`http://127.0.0.1:${porta}${caminho}`, opcoes)
  midia.length = 0

  const certo = await obter(`/m/${chave}/img?url=x`, {
    headers: { Origin: 'https://mac.ts.net', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'mac.ts.net' },
  })
  assert.equal(certo.status, 200)
  assert.deepEqual(midia, [
    { url: '/img?url=x', origem: undefined, base: `https://mac.ts.net/m/${chave}` },
  ])

  midia.length = 0
  assert.equal((await obter('/m/errada/img?url=x')).status, 404)
  assert.equal((await obter(`/m/${TOKEN}/img?url=x`)).status, 404)
  assert.equal((await obter(`/m/${chave}/health?x=1`)).status, 404)
  assert.equal((await obter(`/m/${chave}/realtime/sessao?x=1`)).status, 404)
  assert.equal((await obter(`/m/${chave}/img?url=x`, { method: 'POST' })).status, 404)
  assert.equal(midia.length, 0)
})

test('a chave de mídia não revela o token', () => {
  assert.notEqual(chaveDeMidia(TOKEN), TOKEN)
  assert.equal(chaveDeMidia(TOKEN).includes(TOKEN), false)
})

test('o gateway só tem o canal e a mídia: o resto da ponte não existe aqui', async () => {
  assert.equal(await abrir({ Authorization: `Bearer ${TOKEN}` }, '/'), 404)
  for (const rota of ['/health', '/file?path=/etc/hosts', '/media?url=x', '/realtime/sessao']) {
    const resposta = await fetch(`http://127.0.0.1:${porta}${rota}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    assert.equal(resposta.status, 404, rota)
  }
})

test('o gateway se recusa a subir com token fraco', () => {
  assert.throws(() => criarGateway({ token: 'curto', atender() {} }), /32 caracteres/)
  assert.throws(() => criarGateway({ token: '', atender() {} }), /32 caracteres/)
})

test('tokenConfere exige Bearer e o valor exato', () => {
  assert.equal(tokenConfere(`Bearer ${TOKEN}`, TOKEN), true)
  assert.equal(tokenConfere(`Bearer ${TOKEN}x`, TOKEN), false)
  assert.equal(tokenConfere(undefined, TOKEN), false)
  assert.equal(tokenConfere('Bearer ', TOKEN), false)
})

test('um socket que parou de responder é derrubado pelo pulso', async () => {
  let servidorFechou
  const fechado = new Promise((resolve) => (servidorFechou = resolve))
  const curto = criarGateway({
    token: TOKEN,
    porta: 0,
    pulsoMs: 20,
    atender: (ws) => ws.on('close', servidorFechou),
  })
  const p = await curto.ligar()
  const ws = new WebSocket(`ws://127.0.0.1:${p}${CAMINHO}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    autoPong: false,
  })
  ws.on('error', () => {})
  await fechado
  await curto.fechar()
})

test('com certificado, só fala HTTPS', async () => {
  const { execFileSync } = await import('node:child_process')
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const pasta = mkdtempSync(join(tmpdir(), 'hermes-tls-'))
  const [cert, key] = [join(pasta, 'c.pem'), join(pasta, 'k.pem')]
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
    '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost',
  ], { stdio: 'ignore' })
  const seguro = criarGateway({ token: TOKEN, porta: 0, atender: () => {}, tls: { cert: readFileSync(cert), key: readFileSync(key) } })
  const p = await seguro.ligar()
  const { request } = await import('node:https')
  const status = await new Promise((resolve, reject) =>
    request(`https://localhost:${p}/`, { ca: readFileSync(cert) }, (r) => resolve(r.statusCode)).on('error', reject).end(),
  )
  assert.equal(status, 404)
  await assert.rejects(fetch(`http://localhost:${p}/`))
  await seguro.fechar()
})

// ── o relé ───────────────────────────────────────────────────────────────────

/** Um assistente de mentira: confere o token, ecoa a conversa e serve a mídia. */
async function assistente(token) {
  const pedidosDeMidia = []
  const http = createServer((req, res) => {
    pedidosDeMidia.push({ url: req.url, autorizacao: req.headers.authorization, base: req.headers['x-hermes-base'] })
    res.writeHead(200, { 'content-type': 'image/png', 'x-extra': 'sim' })
    res.end('png')
  })
  const sockets = new WebSocketServer({
    server: http,
    verifyClient: ({ req }, ok) =>
      (req.url === CAMINHO_NO_ASSISTENTE && req.headers.authorization === `Bearer ${token}`) ? ok(true) : ok(false, 401),
  })
  const conectados = []
  sockets.on('connection', (ws) => {
    conectados.push(ws)
    ws.on('message', (d) => ws.send(JSON.stringify({ eco: JSON.parse(d.toString()) })))
  })
  await new Promise((r) => http.listen(0, '127.0.0.1', r))
  return {
    porta: http.address().port,
    pedidosDeMidia,
    conectados,
    fechar: () => new Promise((r) => {
      for (const ws of sockets.clients) ws.terminate()
      http.close(r)
    }),
  }
}

const esperar = async (cond, ms = 3000) => {
  const fim = Date.now() + ms
  while (!cond()) {
    if (Date.now() > fim) assert.fail('a condição não aconteceu a tempo')
    await new Promise((r) => setTimeout(r, 10))
  }
}

test('o relé leva a conversa ao assistente com o token derivado, e traz a resposta', async () => {
  const doAssistente = tokenDerivado(TOKEN)
  const a = await assistente(doAssistente)
  const rele = criarRele({ apolo: `ws://127.0.0.1:${a.porta}`, token: doAssistente, log() {} })
  const g = criarGateway({ token: TOKEN, porta: 0, atender: rele.atender, servirMidia: rele.servirMidia })
  const p = await g.ligar()

  const celular = new WebSocket(`ws://127.0.0.1:${p}${CAMINHO}`, { headers: { Authorization: `Bearer ${TOKEN}` } })
  const recebidas = []
  celular.on('message', (d) => recebidas.push(d.toString()))
  await new Promise((r) => celular.on('open', r))
  // Antes de o assistente atender, a mensagem espera na fila.
  celular.send(JSON.stringify({ type: 'ask', text: 'oi' }))
  await esperar(() => recebidas.some((m) => m.includes('eco')))
  assert.deepEqual(JSON.parse(recebidas[0]).type, 'midia')
  assert.deepEqual(JSON.parse(recebidas.find((m) => m.includes('eco'))), { eco: { type: 'ask', text: 'oi' } })

  // O ping é respondido pelo H.E.R.M.E.S., e só com o assistente de pé.
  celular.send('{"type":"ping"}')
  await esperar(() => recebidas.includes('{"type":"pong"}'))
  assert.equal(recebidas.filter((m) => m.includes('ping')).length, 0, 'o ping não vai ao assistente')

  // Mídia: a chave no caminho vira o token do assistente e o endereço público.
  const chave = chaveDeMidia(TOKEN)
  const r = await fetch(`http://127.0.0.1:${p}/m/${chave}/img?url=x`, {
    headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'mac.ts.net' },
  })
  assert.equal(r.status, 200)
  assert.equal(await r.text(), 'png')
  assert.equal(r.headers.get('x-extra'), 'sim')
  assert.deepEqual(a.pedidosDeMidia, [
    { url: '/hermes/midia/img?url=x', autorizacao: `Bearer ${doAssistente}`, base: `https://mac.ts.net/m/${chave}` },
  ])

  // O assistente caiu: o celular é avisado para tentar de novo.
  const fechou = new Promise((r) => celular.on('close', (codigo) => r(codigo)))
  await a.fechar()
  assert.equal(await fechou, 1013)
  await g.fechar()
})

test('com o token errado, o assistente recusa e o celular não fica preso', async () => {
  const a = await assistente('certo'.repeat(10))
  const rele = criarRele({ apolo: `ws://127.0.0.1:${a.porta}`, token: 'errado'.repeat(10), log() {} })
  const g = criarGateway({ token: TOKEN, porta: 0, atender: rele.atender })
  const p = await g.ligar()
  const celular = new WebSocket(`ws://127.0.0.1:${p}${CAMINHO}`, { headers: { Authorization: `Bearer ${TOKEN}` } })
  const recebidas = []
  celular.on('message', (d) => recebidas.push(d.toString()))
  const fechou = new Promise((r) => celular.on('close', r))
  await new Promise((r) => celular.on('open', r))
  celular.send('{"type":"ping"}')
  await fechou
  assert.equal(recebidas.includes('{"type":"pong"}'), false)
  assert.equal(a.conectados.length, 0)
  await g.fechar()
  await a.fechar()
})

test('o H.E.R.M.E.S. não importa nada de fora da própria pasta, a não ser o Node e o ws', () => {
  const raiz = fileURLToPath(new URL('..', import.meta.url))
  const arquivos = []
  const varrer = (pasta) => {
    for (const nome of readdirSync(pasta)) {
      if (nome === 'node_modules') continue
      const caminho = join(pasta, nome)
      if (statSync(caminho).isDirectory()) varrer(caminho)
      else if (nome.endsWith('.mjs')) arquivos.push(caminho)
    }
  }
  varrer(raiz)
  for (const arquivo of arquivos) {
    for (const [, alvo] of readFileSync(arquivo, 'utf8').matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)) {
      const permitido = alvo.startsWith('node:') || alvo === 'ws' || alvo.startsWith('./') || /^\.\.\/src\//.test(alvo)
      assert.ok(permitido, `${arquivo} importa ${alvo}`)
    }
  }
})
