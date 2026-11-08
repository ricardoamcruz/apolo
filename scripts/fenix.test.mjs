/**
 * O lado do A.P.O.L.O. na F.Ê.N.I.X. e no H.E.R.M.E.S. (docs/adr/0025): o que o
 * fenix.config.json declara, o cliente da Fênix na ponte e a independência dos
 * três. Nada aqui importa código de fenix/ ou de hermes/: o config é lido como
 * JSON, como qualquer outro programa leria.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { test } from 'node:test'
import { WebSocketServer } from 'ws'
import { PROIBIDOS, SENSIVEIS, classificar, gateIntacto } from '../bridge/autodev/politica.mjs'
import { branchValida } from '../bridge/autodev/entrega.mjs'
import { criarClienteFenix } from '../bridge/fenix.mjs'

const config = JSON.parse(readFileSync('fenix.config.json', 'utf8'))
const padrao = (item) => (typeof item === 'string' ? new RegExp(item) : new RegExp(item.re, item.flags ?? ''))
const daFenix = config.protecao.revisao.map(padrao)

test('a Fênix protege exatamente o que a política do autodesenvolvimento protege', () => {
  const nossos = [...PROIBIDOS, ...SENSIVEIS].map((re) => `${re.source}/${re.flags}`).sort()
  const dela = daFenix.map((re) => `${re.source}/${re.flags}`).sort()
  assert.deepEqual(dela, nossos)
  assert.deepEqual(config.protecao.liberados, ['.env.example'])
  // O que a política deixa passar, a Fênix também deixa.
  assert.deepEqual(classificar(['.env.example']), { proibidos: [], sensiveis: [] })
})

test('a invariante da Fênix sobre bridge/server.mjs é a mesma do gateIntacto', () => {
  const [invariante] = config.protecao.invariantes
  assert.equal(invariante.arquivo, 'bridge/server.mjs')
  const confere = (codigo) => invariante.contem.map(padrao).every((re) => re.test(codigo))
  const atual = readFileSync('bridge/server.mjs', 'utf8')
  const semGate = atual.replace('canUseTool: podeUsarFerramenta,', "canUseTool: async () => ({ behavior: 'allow' }),")
  const semOrigem = atual.replace('if (!originAllowed(origin))', 'if (false)')
  for (const codigo of [atual, semGate, semOrigem]) assert.equal(confere(codigo), gateIntacto(codigo))
  assert.equal(confere(atual), true)
})

test('a branch que a Fênix aceita é a mesma que o autodev entrega', () => {
  const re = padrao(config.protecao.branch)
  for (const nome of ['fase-2.6/das-cinzas', 'fase-3/x', 'main', 'autodev/1', 'fase-2/../main', 'fase-2.1/Maiuscula']) {
    assert.equal(re.test(nome), branchValida(nome), nome)
  }
})

test('cada rotina aponta para um programa que existe e tem prazo', () => {
  for (const r of config.rotinas) {
    const [comando, arquivo] = r.comando
    if (comando === 'node' && !arquivo.startsWith('-')) assert.ok(existsSync(arquivo), `${r.nome}: ${arquivo}`)
    assert.ok(r.prazoMs > 0, r.nome)
    for (const [nome, p] of Object.entries(r.parametros ?? {})) {
      assert.ok(p.formato && p.descricao, `${r.nome}.${nome}`)
      // Nada que vire shell: só letras, dígitos e poucos sinais.
      assert.equal(new RegExp(`^(?:${p.formato})$`).test('1; rm -rf ~'), false, `${r.nome}.${nome}`)
    }
  }
  for (const [comando, arquivo] of config.preparar) if (comando === 'node') assert.ok(existsSync(arquivo), arquivo)
})

test('os serviços da Fênix são a ponte, a interface e o H.E.R.M.E.S., e só a ponte troca de versão', () => {
  assert.deepEqual(config.servicos.map((s) => s.nome), ['ponte', 'interface', 'hermes', 'aurora'])
  assert.deepEqual(config.servicos.filter((s) => s.versionado).map((s) => s.nome), ['ponte'])
  assert.equal(config.servicos.find((s) => s.nome === 'hermes').opcional, true)
  assert.equal(config.servicos.find((s) => s.nome === 'aurora').opcional, true)
  assert.equal(config.flags['--writes'].comandosLivres, true, 'comando livre só com --writes')
  assert.equal(config.flags['--autodev'].comandosLivres, undefined)
})

/**
 * A.P.O.L.O., F.Ê.N.I.X. e H.E.R.M.E.S. só conversam pela rede: nenhum importa
 * código do outro. É o que deixa cada um ir para um repositório próprio.
 */
test('nada do A.P.O.L.O. importa a Fênix, o H.E.R.M.E.S. ou um módulo', () => {
  const arquivos = []
  const varrer = (pasta) => {
    for (const nome of readdirSync(pasta)) {
      if (['node_modules', 'ios', 'android', 'dist'].includes(nome)) continue
      const caminho = join(pasta, nome)
      if (statSync(caminho).isDirectory()) varrer(caminho)
      else if (/\.(mjs|ts|tsx)$/.test(nome)) arquivos.push(caminho)
    }
  }
  for (const pasta of ['bridge', 'src', 'scripts', 'apps/mobile/src']) varrer(pasta)
  for (const arquivo of arquivos) {
    for (const [, alvo] of readFileSync(arquivo, 'utf8').matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)) {
      assert.equal(/(^|\/)(fenix|hermes|modules)\//.test(alvo), false, `${arquivo} importa ${alvo}`)
    }
  }
})

// ── o cliente da Fênix na ponte ─────────────────────────────────────────────

const TOKEN = 't'.repeat(43)
const esperar = async (cond, ms = 4000) => {
  const fim = Date.now() + ms
  while (!cond()) {
    if (Date.now() > fim) assert.fail('a condição não aconteceu a tempo')
    await new Promise((r) => setTimeout(r, 10))
  }
}

/** Uma Fênix de mentira: confere o token e responde o que lhe pedem. */
async function fenixFalsa(porta = 0) {
  const http = createServer()
  const wss = new WebSocketServer({
    server: http,
    verifyClient: ({ req }, ok) => ok(req.headers.authorization === `Bearer ${TOKEN}`, 401),
  })
  const recebidas = []
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'estado', inicial: true, versao: { troca: null } }))
    ws.on('message', (d) => {
      const msg = JSON.parse(d.toString())
      recebidas.push(msg)
      if (msg.type === 'rotina') ws.send(JSON.stringify({ type: 'rotina:resposta', resposta: msg.id, ok: true, saida: msg.nome }))
    })
  })
  await new Promise((r) => http.listen(porta, '127.0.0.1', r))
  return {
    porta: http.address().port,
    recebidas,
    fechar: () =>
      new Promise((r) => {
        for (const ws of wss.clients) ws.terminate()
        http.close(r)
      }),
  }
}

test('sem FENIX_URL e FENIX_TOKEN, a ponte roda sozinha', () => {
  assert.equal(criarClienteFenix({ url: '', token: TOKEN }), null)
  assert.equal(criarClienteFenix({ url: 'wss://localhost:8790/fenix', token: '' }), null)
})

test('o cliente pede, recebe a resposta pelo id e repassa o resto', async () => {
  const f = await fenixFalsa()
  const outras = []
  const mudancas = []
  const c = criarClienteFenix({
    url: `ws://127.0.0.1:${f.porta}/fenix`,
    token: TOKEN,
    aoReceber: (m) => outras.push(m),
    aoMudar: (v) => mudancas.push(v),
    log() {},
  })
  const r = await c.pedir({ type: 'rotina', nome: 'testes' })
  assert.deepEqual([r.ok, r.saida], [true, 'testes'])
  // O tipo e o id do canal com a Fênix não podem vazar para quem repassa a resposta:
  // foi isso que fez a interface nunca reconhecer a resposta de uma rotina.
  assert.equal('type' in r, false)
  assert.equal('resposta' in r, false)
  await esperar(() => outras.length === 1)
  assert.equal(outras[0].inicial, true)
  assert.deepEqual(mudancas, [true])
  c.fechar()
  await f.fechar()
})

test('o cliente volta sozinho quando a Fênix reinicia, e o pedido sem resposta não trava', async () => {
  const f = await fenixFalsa()
  const porta = f.porta
  const mudancas = []
  const c = criarClienteFenix({ url: `ws://127.0.0.1:${porta}/fenix`, token: TOKEN, aoMudar: (v) => mudancas.push(v), log() {} })
  await esperar(() => c.conectado())
  await f.fechar()
  await esperar(() => !c.conectado())
  const semResposta = await c.pedir({ type: 'estado' }, 50)
  assert.equal(semResposta.ok, false)
  const outra = await fenixFalsa(porta)
  await esperar(() => c.conectado(), 8000)
  assert.deepEqual(mudancas, [true, false, true])
  c.fechar()
  await outra.fechar()
})

test('token recusado não trava o cliente: ele segue tentando', async () => {
  const f = await fenixFalsa()
  const logs = []
  const c = criarClienteFenix({ url: `ws://127.0.0.1:${f.porta}/fenix`, token: 'errado'.repeat(8), log: (l) => logs.push(l) })
  await esperar(() => logs.length >= 2, 6000)
  assert.match(logs[0], /recusou a conexão \(401\)/)
  assert.equal(c.conectado(), false)
  c.fechar()
  await f.fechar()
})
