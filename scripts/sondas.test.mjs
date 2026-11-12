/**
 * A ponte mede sozinha a saúde do H.E.R.M.E.S. e da A.U.R.O.R.A. (docs/adr/0029):
 * com a Fênix fora do ar, a aba SISTEMAS continua sabendo quem está de pé.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { criarSondas, sondar } from '../bridge/sondas.mjs'

const servidor = (status, corpo) =>
  new Promise((resolve) => {
    const s = createServer((_q, r) => {
      r.writeHead(status, { 'content-type': 'application/json' })
      r.end(JSON.stringify(corpo))
    }).listen(0, '127.0.0.1', () => resolve(s))
  })

test('sondar: de pé, recusando e fora do ar, sem nunca rejeitar', async (t) => {
  const bom = await servidor(200, { ok: true, servico: 'aurora' })
  const ruim = await servidor(503, { ok: false })
  t.after(() => {
    bom.close()
    ruim.close()
  })
  assert.deepEqual(await sondar(`http://127.0.0.1:${bom.address().port}/saude`), { ok: true, dados: { ok: true, servico: 'aurora' } })
  assert.deepEqual(await sondar(`http://127.0.0.1:${ruim.address().port}/saude`), { ok: false, motivo: 'respondeu 503' })
  const porta = ruim.address().port
  ruim.close()
  await new Promise((r) => setTimeout(r, 50))
  assert.deepEqual(await sondar(`http://127.0.0.1:${porta}/saude`), { ok: false, motivo: 'não está no ar' })
  assert.equal((await sondar('isto não é url')).ok, false)
})

test('criarSondas: só os configurados, estado por serviço e aviso quando muda', async () => {
  assert.equal(criarSondas({ alvos: [false, null, undefined] }), null)
  const respostas = { hermes: { ok: true }, aurora: { ok: false, motivo: 'não está no ar' } }
  let avisos = 0
  const s = criarSondas({
    alvos: [
      { nome: 'hermes', url: 'https://h/saude' },
      { nome: 'aurora', url: 'https://a/saude' },
    ],
    sondarUrl: async (url) => respostas[url.includes('//h/') ? 'hermes' : 'aurora'],
    aoMudar: () => avisos++,
    intervaloMs: 60_000,
  })
  await s.checar()
  assert.equal(s.estado('hermes'), 'connected')
  assert.equal(s.estado('aurora'), 'failed')
  assert.equal(s.motivo('aurora'), 'não está no ar')
  assert.equal(s.estado('fenix'), null)
  const antes = avisos
  await s.checar()
  assert.equal(avisos, antes, 'sem mudança, sem aviso')
  respostas.aurora = { ok: true }
  await s.checar()
  assert.equal(s.estado('aurora'), 'connected')
  assert.equal(avisos, antes + 1)
  s.parar()
})
