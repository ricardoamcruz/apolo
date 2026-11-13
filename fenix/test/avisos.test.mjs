/**
 * O que vai pelo H.E.R.M.E.S. é mensagem para gente: rastro de erro, código e saída
 * de comando ficam no log da Fênix (docs/adr/0029).
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { WebSocketServer } from 'ws'
import { explicacaoDaRotina, textoDoAviso } from '../src/avisos.mjs'
import { lerConfig } from '../src/config.mjs'
import { criarFenix } from '../src/fenix.mjs'

const TOKEN = 't'.repeat(40)
const temp = () => realpathSync(mkdtempSync(join(tmpdir(), 'fenix-avisos-')))
const mudo = { write() {} }

/** O fim da saída da rotina app_iphone que chegou ao iPhone em 12/11/2026. */
const EXCECAO = `ERROR: CoreDeviceService was unable to locate a device matching the requested device identifier.
       DeviceIdentifier = ecid_8507120043933726
node:internal/errors:999
  const err = new Error(message);
              ^

Error: Command failed: xcrun devicectl device install app --device 8D7B /x/APOLO.app
    at genericNodeError (node:internal/errors:999:15)
    at file:///Users/ricardocruz/Projetos/apolo/scripts/iphone.mjs:79:1 {
  status: 1,
  signal: null,
}

Node.js v26.13.0`

test('a exceção do Node não passa: sobra a frase que manda ao log', () => {
  assert.equal(textoDoAviso(EXCECAO), 'DeviceIdentifier = ecid_8507120043933726')
  assert.equal(textoDoAviso(EXCECAO.split('\n').slice(2).join('\n')), 'Os detalhes ficaram no log da Fênix.')
  assert.equal(textoDoAviso('O serviço ponte parou com erro. Já estou subindo de novo.'), 'O serviço ponte parou com erro. Já estou subindo de novo.')
  assert.ok(textoDoAviso('a'.repeat(500)).length <= 300)
})

test('a explicação de uma rotina é a última linha com ✖', () => {
  assert.equal(explicacaoDaRotina(`${EXCECAO}\n\n✖ O app compilou, mas o iPhone não estava ao alcance.`), 'O app compilou, mas o iPhone não estava ao alcance.')
  assert.equal(explicacaoDaRotina(EXCECAO), null)
  assert.equal(explicacaoDaRotina(''), null)
})

test('a rotina que falha deixa a saída no log e manda ao H.E.R.M.E.S. só a explicação', async () => {
  const http = createServer()
  const hub = new WebSocketServer({ server: http })
  const recebidas = []
  hub.on('connection', (ws) =>
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString())
      recebidas.push(m)
      ws.send(JSON.stringify({ type: 'notificar:resposta', resposta: m.id, ok: true, mac: true }))
    }),
  )
  await new Promise((r) => http.listen(0, '127.0.0.1', r))
  const pasta = temp()
  writeFileSync(
    join(pasta, 'quebra.mjs'),
    `console.log(${JSON.stringify(EXCECAO)}); console.error('\\n✖ O iPhone não estava ao alcance.'); process.exit(1)`,
  )
  writeFileSync(join(pasta, 'ok.mjs'), 'process.exit(0)')
  writeFileSync(
    join(pasta, 'fenix.config.json'),
    JSON.stringify({
      nome: 'teste',
      pasta: join(pasta, 'dados'),
      escuta: { porta: 0 },
      notificacoes: { url: `ws://127.0.0.1:${http.address().port}/notificacoes`, token: TOKEN },
      tempos: { rotinas: { avisoMs: 1 } },
      servicos: [{ nome: 'ok', comando: ['node', 'ok.mjs'], opcional: true }],
      rotinas: [{ nome: 'app_iphone', comando: ['node', 'quebra.mjs'] }],
    }),
  )
  const fenix = criarFenix(lerConfig(join(pasta, 'fenix.config.json'), {}), { token: TOKEN, log() {}, saida: mudo })
  await fenix.iniciar()
  try {
    const r = await fenix.atender({ type: 'rotina', nome: 'app_iphone' })
    assert.equal(r.ok, false)
    for (let i = 0; i < 100 && !recebidas.some((m) => /app_iphone falhou/.test(m.titulo)); i++) await new Promise((ok) => setTimeout(ok, 20))
    const aviso = recebidas.find((m) => /app_iphone falhou/.test(m.titulo))
    assert.equal(aviso.texto, 'O iPhone não estava ao alcance. Os detalhes ficaram no log da Fênix.')
    assert.doesNotMatch(JSON.stringify(recebidas), /node:internal|Command failed|status: 1/)
    // O detalhe técnico continua inteiro, no log.
    assert.match(readFileSync(join(pasta, 'dados', 'rotinas', 'app_iphone.log'), 'utf8'), /Command failed: xcrun devicectl/)
  } finally {
    await fenix.encerrar()
    for (const ws of hub.clients) ws.terminate()
    await new Promise((r) => http.close(r))
  }
})
