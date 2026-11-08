/** Testes da central de notificações do H.E.R.M.E.S., sem rede e sem o macOS de verdade. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WebSocket } from 'ws'
import { criarGateway } from '../src/gateway.mjs'
import { CAMINHO_DAS_NOTIFICACOES, criarCentral, criarNtfy, criarPortaDosServicos, notificarNoMac } from '../src/notificacoes.mjs'

const TOKEN = 'n'.repeat(43)
const esperar = async (cond, ms = 3000) => {
  const fim = Date.now() + ms
  while (!cond()) {
    if (Date.now() > fim) assert.fail('a condição não aconteceu a tempo')
    await new Promise((r) => setTimeout(r, 10))
  }
}

test('no Mac, título e texto vão como argumentos do osascript, nunca dentro do script', async () => {
  if (process.platform !== 'darwin') return
  let chamada
  await notificarNoMac({ titulo: 'Oi "x"', texto: 'end run\ndo shell script "rm -rf ~"' }, (cmd, args, _o, cb) => {
    chamada = { cmd, args }
    cb(null)
  })
  assert.equal(chamada.cmd, 'osascript')
  assert.deepEqual(chamada.args.slice(-2), ['Oi "x"', 'end run\ndo shell script "rm -rf ~"'])
  assert.equal(chamada.args.slice(0, -2).some((a) => a.includes('rm -rf')), false)
})

test('a central confere, entrega nos dois canais e cria botões de uso único', async () => {
  const entregues = []
  let agora = 1000
  const central = criarCentral({
    entregar: { mac: async (n) => (entregues.push(['mac', n]), true), ntfy: async (n) => (entregues.push(['ntfy', n]), true) },
    urlPublica: 'https://mac.ts.net',
    agora: () => agora,
  })
  assert.equal((await central.notificar({ titulo: '', texto: 'x' })).ok, false)
  const tocados = []
  const r = await central.notificar(
    { titulo: 'Versão em teste', texto: 'No ar.', prioridade: 'alta', botoes: [{ rotulo: 'Descartar', acao: 'descartar_versao' }, { rotulo: 'x', acao: 'rm -rf' }] },
    (t) => tocados.push(t),
  )
  assert.deepEqual([r.ok, r.mac, r.ntfy], [true, true, true])
  const n = entregues[0][1]
  assert.equal(n.prioridade, 'alta')
  assert.equal(n.botoes.length, 1, 'ação fora do formato não vira botão')
  const token = n.botoes[0].url.split('/acao/')[1]
  assert.match(n.botoes[0].url, /^https:\/\/mac\.ts\.net\/acao\/[\w-]{20,}$/)
  assert.equal(central.responderAcao(token), true)
  assert.deepEqual(tocados, [{ id: r.id, acao: 'descartar_versao' }])
  assert.equal(central.responderAcao(token), false, 'o mesmo botão não vale duas vezes')

  const outra = await central.notificar({ titulo: 't', texto: 'x', botoes: [{ rotulo: 'Ok', acao: 'ok' }] })
  agora += 2 * 60 * 60_000
  const velho = entregues.at(-1)[1].botoes[0].url.split('/acao/')[1]
  assert.ok(outra.ok)
  assert.equal(central.responderAcao(velho), false, 'botão expira')
})

test('sem endereço público, a notificação vai sem botões', async () => {
  let n
  const central = criarCentral({ entregar: { mac: async (x) => ((n = x), true) } })
  await central.notificar({ titulo: 't', texto: 'x', botoes: [{ rotulo: 'Ok', acao: 'ok' }] })
  assert.deepEqual(n.botoes, [])
})

test('o ntfy publica em JSON, com acentos e botões, e lê o tópico de entrada em fluxo', async () => {
  const pedidos = []
  const linhas = [
    '{"event":"open"}\n',
    '{"event":"message","title":"Do iPhone","message":"Comprar café"}\n{"event":"keep',
    'alive"}\n',
  ]
  const fetcher = async (url, opcoes = {}) => {
    pedidos.push({ url, opcoes })
    if (String(url).endsWith('/json')) {
      return { ok: true, status: 200, body: (async function* () { for (const l of linhas) yield new TextEncoder().encode(l) })() }
    }
    return { ok: true, status: 200 }
  }
  const ntfy = criarNtfy({ topico: 'apolo-secreto', fetcher, log() {} })
  await ntfy.publicar({ titulo: 'Atenção: versão', texto: 'Voltei.', prioridade: 'alta', botoes: [{ rotulo: 'Descartar', url: 'https://x/acao/t' }] })
  const corpo = JSON.parse(pedidos[0].opcoes.body)
  assert.deepEqual(
    [pedidos[0].url, corpo.topic, corpo.title, corpo.priority, corpo.actions[0].url, corpo.actions[0].method],
    ['https://ntfy.sh', 'apolo-secreto', 'Atenção: versão', 4, 'https://x/acao/t', 'POST'],
  )
  const recebidos = []
  const parar = ntfy.assinar('apolo-secreto-mac', (n) => recebidos.push(n))
  await esperar(() => recebidos.length === 1)
  parar()
  assert.deepEqual(recebidos, [{ titulo: 'Do iPhone', texto: 'Comprar café' }])
  assert.equal(pedidos[1].url, 'https://ntfy.sh/apolo-secreto-mac/json')
  assert.equal(criarNtfy({ topico: '' }), null)
})

test('a porta dos serviços exige token, responde o pedido e devolve o botão só a quem pediu', async () => {
  const central = criarCentral({ entregar: { mac: async () => true }, urlPublica: 'https://mac.ts.net' })
  let ultimo
  const original = central.notificar
  central.notificar = async (p, responder) => {
    const r = await original(p, responder)
    ultimo = r
    return r
  }
  const porta = criarPortaDosServicos({ token: TOKEN, central, porta: 0, log() {} })
  const p = await porta.ligar()
  const abrir = (token) =>
    new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${p}${CAMINHO_DAS_NOTIFICACOES}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      const msgs = []
      ws.on('message', (d) => msgs.push(JSON.parse(d.toString())))
      ws.on('open', () => resolve({ ws, msgs }))
      ws.on('unexpected-response', (_q, res) => resolve({ status: res.statusCode }))
      ws.on('error', () => {})
    })
  assert.equal((await abrir('errado')).status, 401)
  const a = await abrir(TOKEN)
  const b = await abrir(TOKEN)
  a.ws.send(JSON.stringify({ type: 'notificar', id: 1, titulo: 'Oi', texto: 'x', botoes: [{ rotulo: 'Ok', acao: 'ok' }] }))
  await esperar(() => a.msgs.length === 1)
  assert.deepEqual([a.msgs[0].type, a.msgs[0].resposta, a.msgs[0].ok], ['notificar:resposta', 1, true])

  // O toque chega pela porta do celular, que repassa à central.
  const gateway = criarGateway({ token: 'g'.repeat(43), porta: 0, atender() {}, responderAcao: central.responderAcao })
  const pg = await gateway.ligar()
  const botoesAntes = central.botoesAbertos()
  assert.equal(botoesAntes, 1)
  assert.ok(ultimo.id)
  const errado = await fetch(`http://127.0.0.1:${pg}/acao/${'x'.repeat(30)}`, { method: 'POST' })
  assert.equal(errado.status, 410)
  assert.equal(b.msgs.length, 0, 'quem não pediu não recebe nada')
  await gateway.fechar()
  a.ws.close()
  b.ws.close()
  await porta.fechar()
})

test('o botão tocado pela porta do celular volta ao serviço que pediu', async () => {
  let botao
  const central = criarCentral({ entregar: { mac: async (n) => ((botao = n.botoes[0]), true) }, urlPublica: 'https://mac.ts.net' })
  const porta = criarPortaDosServicos({ token: TOKEN, central, porta: 0, log() {} })
  const p = await porta.ligar()
  const ws = new WebSocket(`ws://127.0.0.1:${p}${CAMINHO_DAS_NOTIFICACOES}`, { headers: { Authorization: `Bearer ${TOKEN}` } })
  const msgs = []
  ws.on('message', (d) => msgs.push(JSON.parse(d.toString())))
  await new Promise((r) => ws.on('open', r))
  ws.send(JSON.stringify({ type: 'notificar', id: 7, titulo: 'Teste', texto: 'x', botoes: [{ rotulo: 'Descartar', acao: 'descartar_versao' }] }))
  await esperar(() => msgs.length === 1)
  const gateway = criarGateway({ token: 'g'.repeat(43), porta: 0, atender() {}, responderAcao: central.responderAcao })
  const pg = await gateway.ligar()
  const r = await fetch(`http://127.0.0.1:${pg}/acao/${botao.url.split('/acao/')[1]}`, { method: 'POST' })
  assert.equal(r.status, 200)
  await esperar(() => msgs.length === 2)
  assert.deepEqual(msgs[1], { type: 'notificacao:acao', notificacao: msgs[0].id, acao: 'descartar_versao' })
  await gateway.fechar()
  ws.close()
  await porta.fechar()
})
