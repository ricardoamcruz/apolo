/** Testes da voz que se recupera sozinha (docs/adr/0035). */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { criarDonaDaVoz } from '../bridge/donaDaVoz.mjs'
import { criarLogDaVoz } from '../bridge/logDaVoz.mjs'
import { SEM_INTERFACE_MS, criarRelatoDaVoz } from '../bridge/relatoDaVoz.mjs'
import { RECRIACOES_ATE_MUDA, VIGIA_MS, ouvirNome, reiniciarEscutaParaTestes, transcrever } from '../src/lib/chamada.ts'
import {
  ESPERA_DA_COTA_MS,
  ESPERA_MAXIMA_MS,
  SEM_RETORNO_MS,
  criarOuvidoSurdo,
  esperaDeReligar,
  remedioDaSurdez,
  reservaDaTentativa,
  semCota,
} from '../src/lib/voz/surdez.ts'

const relogio = () => {
  let t = 1_000_000
  return { agora: () => t, andar: (ms) => (t += ms) }
}
/** Passa `ms` de microfone em blocos de 40 ms; devolve se ensurdeceu. */
const passar = (o, c, rms, ms) => {
  let surda = false
  for (let i = 0; i < ms; i += 40) {
    c.andar(40)
    surda = o.trecho(typeof rms === 'function' ? rms(i) : rms, 40) || surda
  }
  return surda
}

const dizer = (o, c, ms = 1500) => passar(o, c, 0.08, ms) || passar(o, c, 0.004, 3000)

test('duas frases inteiras sem retorno são surdez; uma só, não', () => {
  const c = relogio()
  const o = criarOuvidoSurdo(c.agora)
  passar(o, c, 0.004, 3000)
  assert.equal(dizer(o, c), false)
  assert.equal(passar(o, c, 0.004, 15_000), false)
  assert.equal(dizer(o, c), true)
  // Avisa uma vez só.
  assert.equal(passar(o, c, 0.004, SEM_RETORNO_MS * 2), false)
})

test('uma fala longa não é surdez: o 3.8 só responde quando ela termina', () => {
  const c = relogio()
  const o = criarOuvidoSurdo(c.agora)
  passar(o, c, 0.004, 3000)
  // 40 s falando, com pausas curtas entre as palavras.
  assert.equal(passar(o, c, (i) => (i % 2000 < 1400 ? 0.08 : 0.004), 40_000), false)
})

test('silêncio, estalos, sala, ventilador e fala respondida não são surdez', () => {
  const c = relogio()
  const novo = () => criarOuvidoSurdo(c.agora)
  assert.equal(passar(novo(), c, 0.004, 60_000), false)
  assert.equal(passar(novo(), c, (i) => (i % 8000 === 0 ? 0.3 : 0.004), 120_000), false)
  assert.equal(passar(novo(), c, (i) => (i % 6000 < 2000 ? 0.03 : 0.004), 120_000), false)
  const vento = novo()
  passar(vento, c, 0.06, 20_000)
  vento.zerar()
  assert.equal(passar(vento, c, 0.06, 120_000), false)
  const o = novo()
  for (let n = 0; n < 8; n++) {
    assert.equal(dizer(o, c), false)
    o.zerar()
  }
  // Duas frases perdidas com muito tempo entre elas não se somam.
  const longe = novo()
  dizer(longe, c)
  passar(longe, c, 0.004, 60_000)
  assert.equal(dizer(longe, c), false)
})

test('a recusa da retomada não é falta de cota', () => {
  assert.equal(semCota('BidiGenerateContent session is already connected to an existing client'), false)
  assert.equal(semCota('BidiGenerateContent session not found or expired'), false)
  assert.equal(semCota('You exceeded your current quota'), true)
  assert.equal(semCota('RESOURCE_EXHAUSTED'), true)
  assert.equal(semCota('rate limit exceeded'), true)
})

test('os remédios: mesma conversa, reservas, e então acabou', () => {
  assert.deepEqual(remedioDaSurdez(1, 2), { acao: 'retomar' })
  assert.deepEqual(remedioDaSurdez(2, 2), { acao: 'trocar', reserva: 1 })
  assert.deepEqual(remedioDaSurdez(3, 2), { acao: 'esgotou' })
  assert.deepEqual(remedioDaSurdez(2, 1), { acao: 'esgotou' })
})

test('religar espera cada vez mais, até o teto, e não insiste contra a cota', () => {
  assert.deepEqual([0, 1, 2, 9, 5000].map((n) => esperaDeReligar(n)), [1000, 2000, 4000, ESPERA_MAXIMA_MS, ESPERA_MAXIMA_MS])
  assert.equal(esperaDeReligar(0, 'O limite gratuito do Gemini foi atingido: x'), ESPERA_DA_COTA_MS)
  assert.deepEqual([0, 1, 2, 3, 4].map(reservaDaTentativa), [0, 0, 1, 1, 2])
})

test('a voz é da janela que assumiu por último; ao fechar, volta à outra', () => {
  const avisos = []
  const d = criarDonaDaVoz((id) => avisos.push(id))
  d.assumir('s1', 'safari', 100)
  d.assumir('c1', 'chrome', 200)
  assert.equal(d.ehDona('c1'), true)
  assert.equal(d.ehDona('s1'), false)
  // O Safari religa à ponte com a mesma hora: não rouba.
  d.saiu('s1')
  d.assumir('s2', 'safari', 100)
  assert.equal(d.ehDona('c1'), true)
  d.assumir('s2', 'safari', 300)
  assert.equal(d.ehDona('s2'), true)
  d.saiu('s2')
  assert.equal(d.ehDona('c1'), true)
  assert.equal(avisos.at(-1), 'chrome')
})

test('a surdez só se desfaz quando ele volta a ouvir, ou numa página nova', () => {
  const r = criarRelatoDaVoz()
  r.interfaceEntrou()
  r.registrar('voz por texto: x')
  r.registrar('sessão confirmada pelo Google em 1 ms')
  assert.equal(r.paraSaude().estado, 'por texto')
  r.registrar('o Google voltou a ouvir')
  assert.equal(r.paraSaude().estado, 'ligada')
  r.registrar('voz surda: x')
  r.registrar('pedindo a sessão de voz à ponte')
  r.registrar('sessão confirmada pelo Google em 1 ms')
  assert.equal(r.paraSaude().estado, 'ligada')
})

test('escuta muda aparece no /health; janela fechada de propósito não é queda', () => {
  const c = relogio()
  const r = criarRelatoDaVoz({ agora: c.agora })
  r.interfaceEntrou()
  r.registrar('sessão confirmada pelo Google em 1 ms')
  r.registrar('a escuta da espera não dá partida')
  assert.equal(r.paraSaude().estado, 'escuta muda')
  r.registrar('a escuta da espera voltou')
  assert.equal(r.paraSaude().estado, 'ligada')
  r.despedida()
  r.interfaceSaiu()
  c.andar(SEM_INTERFACE_MS * 2)
  assert.equal(r.paraSaude().estado, 'fechada')
  r.interfaceEntrou()
  r.interfaceSaiu()
  c.andar(SEM_INTERFACE_MS)
  assert.equal(r.paraSaude().estado, 'sem interface')
})

test('o log da voz vai para um arquivo do dia, só do usuário', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'voz-'))
  criarLogDaVoz({ pasta }).registrar('sessão confirmada')
  const [nome] = readdirSync(pasta)
  assert.match(nome, /^voz-\d{4}-\d\d-\d\d\.log$/)
  assert.match(readFileSync(join(pasta, nome), 'utf8'), /sessão confirmada\n$/)
})

const reconhecedor = (daPartida) => {
  const criados = []
  globalThis.window = {
    SpeechRecognition: class {
      constructor() { criados.push(this) }
      start() { if (daPartida()) queueMicrotask(() => this.onstart?.()) }
      stop() { this.onend?.() }
      abort() {}
    },
  }
  return criados
}
const andar = async (t, ms) => {
  for (let i = 0; i < ms; i += 500) {
    t.mock.timers.tick(500)
    await new Promise((r) => setImmediate(r))
  }
}

test('a escuta que não dá partida é relatada; parada em silêncio, não', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
  let parte = true
  reconhecedor(() => parte)
  reiniciarEscutaParaTestes()
  const relatos = []
  const escuta = ouvirNome(() => {}, () => {}, (x) => relatos.push(x))
  await andar(t, (VIGIA_MS + 6000) * (RECRIACOES_ATE_MUDA + 1))
  assert.equal(relatos.some((x) => /não dá partida/.test(x)), false)
  parte = false
  await andar(t, (VIGIA_MS + 6000) * (RECRIACOES_ATE_MUDA + 1))
  assert.equal(relatos.filter((x) => /não dá partida/.test(x)).length, 1)
  parte = true
  await andar(t, VIGIA_MS + 6000)
  assert.equal(relatos.filter((x) => /voltou/.test(x)).length, 1)
  escuta.stop()
})

test('por texto, toda frase é transcrita, com ou sem o nome', async () => {
  const criados = reconhecedor(() => true)
  reiniciarEscutaParaTestes()
  const falas = []
  const escuta = transcrever((fala, final) => falas.push([fala, final]), () => {})
  await new Promise((r) => setImmediate(r))
  criados.at(-1).onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: ' que horas são ' } }] })
  assert.deepEqual(falas, [['que horas são', true]])
  escuta.stop()
  reiniciarEscutaParaTestes()
})

test('a sessão entrega o modelo de reserva pedido, e o celular fica no principal', async () => {
  process.env.GEMINI_API_KEY ||= 'teste'
  process.env.APOLO_VOZ_PROVEDOR = 'gemini'
  process.env.APOLO_GEMINI_MODELO = 'principal'
  process.env.APOLO_GEMINI_RESERVAS = 'reserva-a'
  const { createRealtimeSession } = await import('../bridge/realtime.mjs')
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ name: 't' }))
  try {
    const modelo = async (o) => (({ model, modelos, setup }) => [model, modelos, setup.model])(await createRealtimeSession(o))
    assert.deepEqual(await modelo({}), ['principal', 2, 'models/principal'])
    assert.deepEqual(await modelo({ reserva: 1 }), ['reserva-a', 2, 'models/reserva-a'])
    assert.deepEqual(await modelo({ reserva: 2 }), ['principal', 2, 'models/principal'])
    assert.deepEqual(await modelo({ reserva: NaN }), ['principal', 2, 'models/principal'])
    assert.deepEqual(await modelo({ celular: true }), ['principal', 1, 'models/principal'])
  } finally {
    globalThis.fetch = original
  }
})

const { ANTES_MS, FALA_MAXIMA_MS, criarDetectorDeFala } = await import('../src/lib/voz/detectorDeFala.ts')
const detectar = (trechos, silencio = 1200) => {
  const d = criarDetectorDeFala(silencio, 40)
  const passos = []
  let t = 0
  for (const [rms, ms] of trechos)
    for (let i = 0; i < ms; i += 40, t += 40) {
      const p = d.bloco(typeof rms === 'function' ? rms(i) : rms)
      if (p === 'comeca' || p === 'termina') passos.push([p, t])
    }
  return passos
}

test('a fala abre antes de o começo guardado acabar e fecha depois do silêncio', () => {
  const p = detectar([[0.004, 2000], [0.06, 2000], [0.004, 3000]])
  assert.deepEqual(p.map((x) => x[0]), ['comeca', 'termina'])
  assert.ok(p[0][1] - 2000 < ANTES_MS)
  assert.ok(Math.abs(p[1][1] - 5200) < 100)
})

test('pausas entre palavras não partem a fala; duas frases são duas falas', () => {
  const palavras = (i) => (i % 900 < 500 ? 0.06 : 0.005)
  assert.equal(detectar([[0.004, 1000], [palavras, 9000], [0.004, 2000]]).length, 2)
  assert.equal(detectar([[0.004, 1000], [0.06, 1500], [0.004, 2000], [0.06, 1500], [0.004, 2000]]).length, 4)
})

test('silêncio, estalos e ventilador não abrem fala; voz baixa abre', () => {
  assert.deepEqual(detectar([[0.005, 30_000]]), [])
  assert.deepEqual(detectar([[(i) => (i % 2000 === 0 ? 0.4 : 0.004), 30_000]]), [])
  assert.equal(detectar([[(i) => 0.012 + (i % 80 ? 0.003 : 0), 30_000]]).length, 0)
  assert.deepEqual(detectar([[0.004, 2000], [0.025, 1500], [0.004, 2000]]).map((x) => x[0]), ['comeca', 'termina'])
})

test('som sem pausa fecha no teto', () => {
  const p = detectar([[0.004, 2000], [(i) => 0.06 + (i % 400 ? 0 : 0.02), FALA_MAXIMA_MS + 2000]])
  assert.equal(p[1][0], 'termina')
  assert.ok(p[1][1] <= 2000 + FALA_MAXIMA_MS + 1000)
})
