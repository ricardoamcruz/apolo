/** Testes do canal do app, do lado do celular na ponte e da telemetria (ADR 0019 e 0025). */

import assert from 'node:assert/strict'
import { X509Certificate } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { createServer } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import { MENSAGENS_DO_CELULAR, basePublicaValida, hermesAutorizado, tokenDoHermes } from '../bridge/hermes.mjs'
import { classificar } from '../bridge/autodev/politica.mjs'
import { Canal, baseDeMidia, nomeDaFerramenta } from '../apps/mobile/src/canal.ts'
import { lerCodigo } from '../apps/mobile/src/pareamento.ts'
import { Telemetria } from '../apps/mobile/src/telemetria.ts'
import { garantirCertificado } from '../bridge/tls.mjs'
import { criarCentral } from '../bridge/extensoes.mjs'
import { originAllowed } from '../bridge/gate.mjs'
import { atividadeDaFerramenta } from '../src/lib/estados.ts'
import { MAX_EVENTOS, criarTelemetria, lerEventos, limparEvento, resumir } from '../bridge/telemetria.mjs'

const TOKEN = 'a'.repeat(43)
const CAMINHO = '/canal'
const CHAVE = 'chave-de-midia'

/**
 * O H.E.R.M.E.S. como o app o vê: /canal com o token, a chave da mídia ao abrir e
 * o pong do ping. É o contrato do app; o H.E.R.M.E.S. de verdade tem os testes
 * dele em hermes/test/.
 */
function criarGateway({ token, atender }) {
  const http = createServer((_req, res) => {
    res.writeHead(404)
    res.end()
  })
  const wss = new WebSocketServer({ noServer: true })
  http.on('upgrade', (req, socket, cabeca) => {
    if (req.url !== CAMINHO || req.headers.authorization !== `Bearer ${token}`) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      return socket.destroy()
    }
    wss.handleUpgrade(req, socket, cabeca, (ws) => {
      ws.on('message', (bruto) => {
        if (bruto.toString() === '{"type":"ping"}') ws.send('{"type":"pong"}')
      })
      ws.send(JSON.stringify({ type: 'midia', chave: CHAVE }))
      atender(ws)
    })
  })
  return {
    ligar: () => new Promise((r) => http.listen(0, '127.0.0.1', () => r(http.address().port))),
    fechar: () =>
      new Promise((r) => {
        for (const ws of wss.clients) ws.terminate()
        http.close(r)
      }),
  }
}

let gateway
let porta
before(async () => {
  gateway = criarGateway({ token: TOKEN, atender() {} })
  porta = await gateway.ligar()
})
after(() => gateway.fechar())

test('o celular conversa, manda medições e pede ao core como o PC (ADR 0030)', () => {
  assert.deepEqual([...MENSAGENS_DO_CELULAR].sort(), ['ask', 'autodev', 'extensao', 'fenix', 'interrupt', 'telemetria', 'voz_sessao'])
})

test('o H.E.R.M.E.S. e o lado dele na ponte são sensíveis: não entram em teste sem revisão', () => {
  const arquivos = ['hermes/src/gateway.mjs', 'hermes/hermes.mjs', 'bridge/hermes.mjs']
  assert.deepEqual(classificar(arquivos).sensiveis, arquivos)
})

test('o token do H.E.R.M.E.S. na ponte: o próprio, ou derivado do token do celular', () => {
  const celular = 'c'.repeat(43)
  const derivado = tokenDoHermes({ APOLO_GATEWAY_TOKEN: celular })
  assert.ok(derivado && derivado !== celular && !derivado.includes(celular))
  assert.equal(tokenDoHermes({ APOLO_HERMES_TOKEN: 'h'.repeat(40), APOLO_GATEWAY_TOKEN: celular }), 'h'.repeat(40))
  assert.equal(tokenDoHermes({ APOLO_HERMES_TOKEN: 'curto' }), null)
  assert.equal(tokenDoHermes({}), null)
  assert.equal(hermesAutorizado(`Bearer ${derivado}`, derivado), true)
  assert.equal(hermesAutorizado(`Bearer ${celular}`, derivado), false)
  assert.equal(hermesAutorizado(`Bearer ${derivado}`, null), false)
})

test('a base pública da mídia só aceita um endereço simples', () => {
  assert.equal(basePublicaValida('https://mac.tail1234.ts.net/m/abc_-9'), true)
  assert.equal(basePublicaValida('https://mac.ts.net/m/x"><script>'), false)
  assert.equal(basePublicaValida('javascript:alert(1)'), false)
  assert.equal(basePublicaValida(undefined), false)
})

test('lerCodigo aceita o que o npm run celular copia', () => {
  assert.deepEqual(lerCodigo(` https://mac.tail1.ts.net#${TOKEN} \n`), {
    url: 'wss://mac.tail1.ts.net/canal',
    token: TOKEN,
  })
})

test('lerCodigo nunca manda o token às claras para fora do aparelho', () => {
  assert.equal(lerCodigo(`http://mac.tail1.ts.net#${TOKEN}`), null)
  assert.equal(lerCodigo(`ws://192.168.0.10:8788#${TOKEN}`), null)
  assert.deepEqual(lerCodigo(`http://127.0.0.1:8788#${TOKEN}`), {
    url: 'ws://127.0.0.1:8788/canal',
    token: TOKEN,
  })
})

test('lerCodigo recusa código incompleto', () => {
  assert.equal(lerCodigo('https://mac.ts.net'), null)
  assert.equal(lerCodigo('https://mac.ts.net#curto'), null)
  assert.equal(lerCodigo(TOKEN), null)
})

test('baseDeMidia sai do endereço do canal', () => {
  assert.equal(baseDeMidia('wss://mac.ts.net/canal', 'k'), 'https://mac.ts.net/m/k')
  assert.equal(baseDeMidia('ws://127.0.0.1:8788/canal', 'k'), 'http://127.0.0.1:8788/m/k')
})

test('nomeDaFerramenta vira rótulo legível', () => {
  assert.equal(nomeDaFerramenta('mcp__apolo_navegador__chrome_open'), 'navegador · chrome open')
  assert.equal(nomeDaFerramenta('WebSearch'), 'WebSearch')
})

/** Um app inteiro falando com um gateway de verdade, sobre o pacote `ws`. */
function canalDeTeste(pulsoMs) {
  const eventos = []
  const medidas = []
  const anotar = (nome) => (valor) => eventos.push([nome, valor])
  const canal = new Canal(
    {
      aoMudarEstado: anotar('estado'),
      aoTexto: anotar('texto'),
      aoFerramenta: anotar('ferramenta'),
      aoPainel: anotar('painel'),
      aoPopup: anotar('popup'),
      aoMidia: anotar('midia'),
      aoTerminar: anotar('fim'),
      aoFalhar: anotar('falha'),
      aoCredencial: (id, sessao, erro) => eventos.push(['credencial', { id, sessao, erro }]),
      aoMedir: (nome, ms, info) => medidas.push({ nome, ms, info }),
      aoCore: anotar('core'),
    },
    ({ url, token: t }) => new WebSocket(url, { headers: { Authorization: `Bearer ${t}` } }),
    pulsoMs,
  )
  return { canal, eventos, medidas }
}

const ate = async (condicao) => {
  while (!condicao()) await new Promise((r) => setTimeout(r, 5))
}

test('o canal entrega a resposta e ignora sobras de outro pedido', async () => {
  const recebidas = []
  const gw = criarGateway({
    token: TOKEN,
    porta: 0,
    atender: (ws) =>
      ws.on('message', (bruto) => {
        const msg = JSON.parse(bruto.toString())
        recebidas.push(msg)
        const enviar = (quadro) => ws.send(JSON.stringify({ ...quadro, ask: msg.id }))
        ws.send(JSON.stringify({ type: 'text', delta: 'sobra', ask: 'antigo' }))
        ws.send(JSON.stringify({ type: 'blade', blade: { id: 'b1' } }))
        ws.send(JSON.stringify({ type: 'panel', panel: { id: 'p1' } }))
        enviar({ type: 'tool', name: 'WebSearch' })
        enviar({ type: 'text', delta: 'Oi' })
        enviar({ type: 'done', text: 'Oi, Ricardo.' })
      }),
  })
  const p = await gw.ligar()
  const { canal, eventos } = canalDeTeste()
  canal.ligar({ url: `ws://127.0.0.1:${p}${CAMINHO}`, token: TOKEN })
  await ate(() => eventos.some(([n, v]) => n === 'estado' && v === 'conectado'))

  assert.equal(canal.perguntar('oi'), true)
  await ate(() => eventos.some(([n]) => n === 'fim'))
  assert.deepEqual(eventos.find(([n]) => n === 'midia'), [
    'midia',
    `http://127.0.0.1:${p}/m/${CHAVE}`,
  ])
  assert.equal(recebidas[0].type, 'ask')
  assert.equal(recebidas[0].text, 'oi')
  assert.deepEqual(eventos.slice(-5), [
    ['popup', { id: 'b1' }],
    ['painel', { id: 'p1' }],
    ['ferramenta', 'WebSearch'],
    ['texto', 'Oi'],
    ['fim', 'Oi, Ricardo.'],
  ])
  canal.desligar()
  await gw.fechar()
})

test('token recusado para de tentar e avisa', async () => {
  const { canal, eventos } = canalDeTeste()
  canal.ligar({ url: `ws://127.0.0.1:${porta}${CAMINHO}`, token: 'errado' })
  await ate(() => eventos.some(([, v]) => v === 'recusado'))
  canal.desligar()
})

test('cair no meio de uma tarefa avisa e reconecta sozinho', async () => {
  const sockets = []
  const gw = criarGateway({ token: TOKEN, porta: 0, atender: (ws) => sockets.push(ws) })
  const p = await gw.ligar()
  const { canal, eventos } = canalDeTeste()
  canal.ligar({ url: `ws://127.0.0.1:${p}${CAMINHO}`, token: TOKEN })
  await ate(() => sockets.length === 1)
  await ate(() => eventos.some(([, v]) => v === 'conectado'))

  canal.perguntar('tarefa longa')
  sockets[0].terminate()
  await ate(() => eventos.some(([n]) => n === 'falha'))
  await ate(() => sockets.length === 2)
  canal.desligar()
  await gw.fechar()
})

test('conectado só depois de o backend falar, e o ping mantém o estado', async () => {
  const gw = criarGateway({ token: TOKEN, porta: 0, atender() {} })
  const p = await gw.ligar()
  const { canal, eventos } = canalDeTeste(15)
  canal.ligar({ url: `ws://127.0.0.1:${p}${CAMINHO}`, token: TOKEN })
  await ate(() => eventos.some(([, v]) => v === 'conectado'))
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(eventos.at(-1)[1] === 'conectando', false)
  canal.desligar()
  await gw.fechar()
})

test('sem resposta ao ping, deixa de estar conectado mesmo com o socket aberto', async () => {
  const mudo = new WebSocketServer({ port: 0 })
  await new Promise((r) => mudo.once('listening', r))
  mudo.on('connection', (ws) => ws.send(JSON.stringify({ type: 'midia', chave: 'k' })))
  const { canal, eventos } = canalDeTeste(15)
  canal.ligar({ url: `ws://127.0.0.1:${mudo.address().port}${CAMINHO}`, token: TOKEN })
  await ate(() => eventos.some(([, v]) => v === 'conectado'))
  const depois = eventos.findIndex(([, v]) => v === 'conectado')
  await ate(() => eventos.slice(depois).some(([, v]) => v === 'conectando'))
  canal.desligar()
  mudo.close()
})

test('os pedidos ao core vão pelo canal, e a resposta e o estado voltam para a voz', async () => {
  const recebidas = []
  const gw = criarGateway({
    token: TOKEN,
    porta: 0,
    atender: (ws) =>
      ws.on('message', (bruto) => {
        const msg = JSON.parse(bruto.toString())
        if (msg.type === 'ping') return
        recebidas.push(msg)
        if (msg.type === 'fenix') {
          ws.send(JSON.stringify({ type: 'fenix', estado: { conectada: true, propostas: [{ id: 'p1', script: 'ls', motivo: 'listar' }] } }))
          ws.send(JSON.stringify({ ok: true, mensagem: 'proposta', type: 'fenix', resposta: msg.id }))
        }
      }),
  })
  const p = await gw.ligar()
  const { canal, eventos } = canalDeTeste()
  // Desconectado, o pedido não sai: quem chamou responde à voz.
  assert.equal(canal.pedirAoCore({ tipo: 'fenix', id: 'f0', acao: 'estado' }), false)
  canal.ligar({ url: `ws://127.0.0.1:${p}${CAMINHO}`, token: TOKEN })
  await ate(() => eventos.some(([, v]) => v === 'conectado'))
  // Só os tipos do core: nada de usar o caminho para outra mensagem.
  assert.equal(canal.pedirAoCore({ tipo: 'preferencias', id: 'x', acao: 'gravar' }), false)
  assert.equal(canal.pedirAoCore({ tipo: 'fenix', id: 'f1', acao: 'comando', script: 'ls', motivo: 'listar' }), true)
  await ate(() => eventos.filter(([n]) => n === 'core').length === 2)
  assert.deepEqual(recebidas, [{ id: 'f1', acao: 'comando', script: 'ls', motivo: 'listar', type: 'fenix' }])
  const doCore = eventos.filter(([n]) => n === 'core').map(([, v]) => v)
  assert.equal(doCore[0].estado.propostas[0].id, 'p1')
  assert.deepEqual(doCore[1], { ok: true, mensagem: 'proposta', type: 'fenix', resposta: 'f1' })
  canal.desligar()
  await gw.fechar()
})

test('a credencial da voz volta pelo canal', async () => {
  const gw = criarGateway({
    token: TOKEN,
    porta: 0,
    atender: (ws) =>
      ws.on('message', (bruto) => {
        const msg = JSON.parse(bruto.toString())
        if (msg.type === 'voz_sessao') {
          ws.send(JSON.stringify({ type: 'voz_sessao', id: msg.id, sessao: { token: 't' } }))
        }
      }),
  })
  const p = await gw.ligar()
  const { canal, eventos } = canalDeTeste()
  canal.ligar({ url: `ws://127.0.0.1:${p}${CAMINHO}`, token: TOKEN })
  await ate(() => eventos.some(([, v]) => v === 'conectado'))
  assert.equal(canal.pedirCredencial('v1'), true)
  await ate(() => eventos.some(([n]) => n === 'credencial'))
  assert.deepEqual(eventos.at(-1), [
    'credencial',
    { id: 'v1', sessao: { token: 't' }, erro: undefined },
  ])
  canal.desligar()
  await gw.fechar()
})

test('o canal mede o ping e a abertura, e só manda telemetria conectado', async () => {
  const { canal, medidas } = canalDeTeste(20)
  assert.equal(canal.enviarTelemetria([{ nome: 'x' }]), false)
  canal.ligar({ url: `ws://127.0.0.1:${porta}${CAMINHO}`, token: TOKEN })
  await ate(() => medidas.some((m) => m.nome === 'ping'))
  assert.ok(medidas.some((m) => m.nome === 'canal_conectou' && m.ms >= 0))
  assert.equal(canal.enviarTelemetria([{ nome: 'x' }]), true)
  canal.desligar()
})

test('do log só passam nome, duração e rótulos curtos', () => {
  const limpo = limparEvento({
    nome: 'ping',
    ms: 14.6,
    t: 5,
    rede: 'wifi',
    info: 'token=abc/def',
    texto: 'o que foi dito',
    url: 'https://x',
  })
  assert.deepEqual(limpo, { t: 5, nome: 'ping', ms: 15, rede: 'wifi' })
  assert.equal(limparEvento({ nome: '../../etc' }), null)
  assert.equal(limparEvento({ nome: 'x', ms: -1 }).ms, undefined)
  assert.equal(limparEvento(null), null)
})

test('a telemetria grava em JSONL privado, limita o lote e respeita o teto do dia', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'apolo-telemetria-'))
  const log = criarTelemetria({ pasta })
  log.registrar([{ nome: 'ping', ms: 10 }, { nome: 'INVALIDO' }, 'lixo'])
  log.registrar('nem é lista')
  log.registrar(Array.from({ length: MAX_EVENTOS + 50 }, () => ({ nome: 'ping', ms: 1 })))
  log.evento('tarefa_agente', 900)
  const [arquivo] = readdirSync(pasta)
  assert.equal(statSync(join(pasta, arquivo)).mode & 0o777, 0o600)
  const linhas = readFileSync(join(pasta, arquivo), 'utf8').trim().split('\n')
  assert.equal(linhas.length, 1 + MAX_EVENTOS + 1)

  const cheia = mkdtempSync(join(tmpdir(), 'apolo-telemetria-'))
  const pequena = criarTelemetria({ pasta: cheia, maxBytes: 10 })
  pequena.registrar([{ nome: 'ping', ms: 1 }])
  pequena.registrar([{ nome: 'ping', ms: 2 }])
  assert.equal(lerEventos({ pasta: cheia }).length, 1)
})

test('o resumo separa as medidas por rede', () => {
  const linhas = resumir([
    { nome: 'ping', ms: 10, rede: 'wifi' },
    { nome: 'ping', ms: 30, rede: 'wifi' },
    { nome: 'ping', ms: 200, rede: 'celular' },
    { nome: 'app_mudou', info: 'active' },
  ])
  assert.deepEqual(linhas.map((l) => [l.nome, l.rede, l.vezes, l.max]), [
    ['ping', 'celular', 1, 200],
    ['ping', 'wifi', 2, 30],
  ])
})

test('sem conexão a fila espera, tem limite e sai inteira depois', () => {
  const lotes = []
  let online = false
  const fila = new Telemetria((eventos) => {
    if (online) lotes.push(eventos.length)
    return online
  })
  for (let i = 0; i < 700; i++) fila.registrar('ping', i)
  fila.descarregar()
  assert.deepEqual(lotes, [])
  online = true
  fila.descarregar()
  assert.equal(lotes.reduce((a, b) => a + b, 0), 500)
  assert.ok(lotes.every((n) => n <= MAX_EVENTOS))
})

test('cada ferramenta cai na cor certa', () => {
  for (const nome of ['WebSearch', 'Read', 'Grep', 'mcp__apolo_navegador__chrome_open', 'mcp__apolo_git__git_status']) {
    assert.equal(atividadeDaFerramenta(nome), 'processando', nome)
  }
  for (const nome of ['Bash', 'mcp__maquina__run_shell', 'PowerShell']) {
    assert.equal(atividadeDaFerramenta(nome), 'executando', nome)
  }
  for (const nome of ['Edit', 'Write', 'NotebookEdit', 'mcp__apolo_git__git_commit']) {
    assert.equal(atividadeDaFerramenta(nome), 'codificando', nome)
  }
})

test('a ponte só aceita páginas em HTTPS', () => {
  assert.equal(originAllowed('https://localhost:5173'), true)
  assert.equal(originAllowed('http://localhost:5173'), false)
  assert.equal(originAllowed('https://exemplo.com:5173'), false)
})

test('o certificado local fica só com o usuário e não vira autoridade certificadora', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'apolo-tls-'))
  const { cert, caminho } = garantirCertificado(pasta)
  assert.equal(statSync(join(pasta, 'apolo-chave.pem')).mode & 0o777, 0o600)
  assert.equal(new X509Certificate(cert).ca, false)
  assert.ok(new X509Certificate(cert).subjectAltName.includes('localhost'))
  assert.equal(garantirCertificado(pasta).caminho, caminho)
})

test('sem extensão registrada, nada chega a lugar nenhum', () => {
  const central = criarCentral()
  const web = central.conectar({ tipo: 'web', enviar: () => assert.fail('não devia enviar') })
  assert.equal(web.receber({ type: 'extensao', extensao: 'dispositivos', dados: {} }), false)
  assert.deepEqual(central.registradas(), [])
})

test('uma extensão registrada recebe de um dispositivo e fala com outro', () => {
  const central = criarCentral()
  const chegou = []
  central.registrar({
    id: 'dispositivos',
    aoMensagem: (mensagem, api) => assert.equal(api.enviar('web', mensagem.dados), 1),
  })
  const celular = central.conectar({ tipo: 'celular', enviar: () => {} })
  const web = central.conectar({ tipo: 'web', enviar: (m) => chegou.push(m) })
  assert.equal(celular.receber({ extensao: 'dispositivos', dados: { comando: 'x' } }), true)
  assert.deepEqual(chegou, [{ type: 'extensao', extensao: 'dispositivos', dados: { comando: 'x' } }])
  web.sair()
  assert.equal(celular.receber({ extensao: 'dispositivos', dados: 'y'.repeat(70_000) }), false)
  assert.throws(() => central.registrar({ id: 'dispositivos', aoMensagem() {} }))
  assert.throws(() => central.registrar({ id: '../x', aoMensagem() {} }))
})
