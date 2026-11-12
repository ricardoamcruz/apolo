/**
 * O lado do A.P.O.L.O. no pacto com a F.Ê.N.I.X. (docs/adr/0028): quando ela
 * morre, a ponte a revive. Aqui com o relógio, o processo e o spawn de mentira; o
 * ciclo com processos de verdade está em scripts/resiliencia.test.mjs.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  LIMITE,
  ambienteDoRenascimento,
  criarRenascimento,
  lerReceita,
  processoVivo,
  renascimentosRecentes,
} from '../bridge/renascer.mjs'

const pasta = () => realpathSync(mkdtempSync(join(tmpdir(), 'renascer-')))
const esperar = async (cond, ms = 2000) => {
  const fim = Date.now() + ms
  while (!cond()) {
    if (Date.now() > fim) assert.fail('a condição não aconteceu a tempo')
    await new Promise((r) => setTimeout(r, 5))
  }
}

function receita(dir = pasta()) {
  return {
    pid: 4242,
    comando: ['/usr/bin/node', '/x/fenix/fenix.mjs', '--config', '/x/fenix.config.json', '--writes'],
    cwd: '/x',
    saida: join(dir, 'fenix.log'),
    registro: join(dir, 'renascimentos.log'),
    limpar: ['JARVIS_ALLOW_WRITES', 'FENIX_TOKEN'],
  }
}

/** Um renascimento com tudo de mentira, que registra o que faria. */
function montar({ vivo = () => false, conectado = () => false, r = receita() } = {}) {
  const chamadas = []
  let saiu = 0
  const logs = []
  const ren = criarRenascimento({
    receita: r,
    conectado,
    vivo,
    log: (l) => logs.push(l),
    sair: () => saiu++,
    spawn: (comando, args, opcoes) => {
      chamadas.push({ comando, args, opcoes })
      return { pid: 777, unref() {} }
    },
    intervaloMs: 5,
    saidaMs: 5,
  })
  return { ren, chamadas, logs, saidas: () => saiu, r }
}

test('sem a receita da Fênix, nada liga', () => {
  assert.equal(lerReceita({}), null)
  assert.equal(lerReceita({ FENIX_PID: '12', FENIX_RENASCER: '{"comando":"node"}' }), null)
  assert.equal(lerReceita({ FENIX_PID: 'x', FENIX_RENASCER: JSON.stringify(receita()) }), null)
  assert.equal(criarRenascimento({ receita: null, conectado: () => false }), null)
  const { pid: _pid, ...dela } = receita()
  const r = lerReceita({ FENIX_PID: '4242', FENIX_RENASCER: JSON.stringify(dela) })
  assert.equal(r.pid, 4242)
  assert.deepEqual(r.comando, dela.comando)
})

test('o processo vivo é o deste teste; um que não existe, não', () => {
  assert.equal(processoVivo(process.pid), true)
  assert.equal(processoVivo(2 ** 22 + 12345), false)
})

test('a Fênix morta é revivida, solta, com as mesmas opções, e a ponte sai do caminho', async () => {
  const { ren, chamadas, saidas, r } = montar()
  ren.vigiar()
  await esperar(() => saidas() === 1)
  assert.equal(chamadas.length, 1)
  const [{ comando, args, opcoes }] = chamadas
  assert.equal(comando, r.comando[0])
  assert.deepEqual(args, r.comando.slice(1))
  assert.equal(opcoes.detached, true)
  assert.equal(opcoes.cwd, '/x')
  assert.equal(opcoes.env.FENIX_RENASCIDA, '1')
  assert.match(readFileSync(r.registro, 'utf8'), /renascida pelo A\.P\.O\.L\.O\. \(a anterior era o processo 4242\)/)
  assert.deepEqual(ren.estado(), { vigiando: false, desistiu: false, renasceu: true })
  // Uma vez basta: quem vigia agora é a Fênix nova.
  ren.vigiar()
  assert.equal(ren.estado().vigiando, false)
})

test('Fênix viva só caiu a conexão: espera o cliente reconectar, sem reviver', async () => {
  let conectado = false
  const { ren, chamadas } = montar({ vivo: () => true, conectado: () => conectado })
  ren.vigiar()
  await new Promise((r) => setTimeout(r, 60))
  assert.equal(chamadas.length, 0)
  conectado = true
  await esperar(() => !ren.estado().vigiando)
  assert.equal(chamadas.length, 0)
})

test('uma checagem com o processo sumido não basta: precisam ser duas seguidas', async () => {
  const respostas = [false, true, false, true, false, false]
  const { ren, chamadas } = montar({ vivo: () => respostas.shift() ?? true })
  ren.vigiar()
  await esperar(() => respostas.length === 0)
  await esperar(() => chamadas.length === 1)
})

test('três renascimentos em dez minutos é um laço: a ponte desiste e fica de pé', async () => {
  const r = receita()
  const agora = Date.now()
  writeFileSync(
    r.registro,
    [3, 2, 1].map((min) => `${new Date(agora - min * 60_000).toISOString()} renascida\n`).join('') +
      `${new Date(agora - 60 * 60_000).toISOString()} renascida há uma hora: não conta\n`,
  )
  assert.equal(renascimentosRecentes(r.registro, agora), LIMITE)
  const { ren, chamadas, saidas, logs } = montar({ r })
  ren.vigiar()
  await esperar(() => ren.estado().desistiu)
  assert.equal(chamadas.length, 0)
  assert.equal(saidas(), 0)
  assert.match(logs.at(-1), /não vou revivê-la de novo/)
})

test('a Fênix nova não herda o que a antiga pôs no ambiente', () => {
  const env = ambienteDoRenascimento(receita(), {
    PATH: '/bin',
    GEMINI_API_KEY: 'do terminal',
    FENIX_URL: 'wss://localhost:8790/fenix',
    FENIX_PID: '4242',
    FENIX_RENASCER: '{}',
    FENIX_TOKEN: 'da antiga',
    JARVIS_ALLOW_WRITES: '1',
    FENIX_PASTA: '/do/terminal',
  })
  assert.deepEqual(env, { PATH: '/bin', GEMINI_API_KEY: 'do terminal', FENIX_PASTA: '/do/terminal', FENIX_RENASCIDA: '1' })
})

test('se o spawn falhar, a ponte não sai: sem Fênix, mas de pé', async () => {
  const { pid: _p, ...semComando } = receita()
  const chamadas = []
  let saiu = false
  const logs = []
  const ren = criarRenascimento({
    receita: { ...semComando, pid: 4242 },
    conectado: () => false,
    vivo: () => false,
    spawn: () => {
      chamadas.push(1)
      throw new Error('ENOENT')
    },
    sair: () => (saiu = true),
    log: (l) => logs.push(l),
    intervaloMs: 5,
    saidaMs: 5,
  })
  ren.vigiar()
  await esperar(() => chamadas.length === 1)
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(saiu, false)
  assert.match(logs.at(-1), /não consegui reviver/)
})
