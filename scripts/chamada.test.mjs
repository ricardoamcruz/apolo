/** Testes de como o A.P.O.L.O. reconhece que foi chamado em espera (ADR 0017). */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chamouPeloNome, decidirChamada } from '../src/lib/chamada.ts'

test('o nome sozinho ou abrindo a frase é um chamado', () => {
  for (const fala of ['Apolo', 'Apolo!', 'ei, Apolo', 'Oi Apollo', 'bom dia, Apolo', 'a polo']) {
    assert.deepEqual(chamouPeloNome(fala), { chamou: true, pedido: '' }, fala)
  }
  assert.deepEqual(chamouPeloNome('Apolo, que horas são?'), { chamou: true, pedido: 'que horas sao' })
  assert.deepEqual(chamouPeloNome('Apolo está aí?'), { chamou: true, pedido: 'esta ai' })
})

test('o nome fechando a frase também é um chamado', () => {
  assert.deepEqual(chamouPeloNome('que horas são, Apolo?'), { chamou: true, pedido: 'que horas sao' })
})

test('falar do Apolo não é chamá-lo', () => {
  for (const fala of [
    'o Apolo travou de novo',
    'pergunta para o Apolo',
    'isso é coisa do Apolo',
    'Apolo é um deus grego',
    'Apolo foi lançado ontem',
    'tinha um templo de Apolo perto da praia',
  ]) {
    assert.equal(chamouPeloNome(fala).chamou, false, fala)
  }
})

test('sem o nome, nada acorda', () => {
  for (const fala of ['', 'que horas são', 'boa noite', 'polo aquático', 'apolinário']) {
    assert.equal(chamouPeloNome(fala).chamou, false, fala)
  }
})

test('o nome sozinho acorda antes de a frase fechar; com pedido, espera fechar', () => {
  assert.equal(decidirChamada('Apolo', false), 'se_parar')
  assert.equal(decidirChamada('Apolo', true), 'agora')
  assert.equal(decidirChamada('Apolo, que horas são', false), 'nao')
  assert.equal(decidirChamada('Apolo, que horas são', true), 'agora')
  assert.equal(decidirChamada('o Apolo', false), 'nao')
  assert.equal(decidirChamada('o Apolo travou', true), 'nao')
})

test('bom dia acorda com a rotina do bom dia, mesmo sem outro pedido', async () => {
  const { deuBomDia, chamouPeloNome } = await import('../src/lib/chamada.ts')
  assert.equal(deuBomDia('Bom dia, Apolo!'), true)
  assert.equal(deuBomDia('Apolo, bom dia'), true)
  assert.equal(deuBomDia('boa tarde Apolo'), false)
  assert.deepEqual(chamouPeloNome('bom dia apolo'), { chamou: true, pedido: '' })
})

/* ------------------------------------------------------------------------
 * A escuta da espera (bug de 18/11/2026): um reconhecedor de mentira, no lugar
 * do Chrome, e relógio falso. Cada teste começa como numa página nova.
 */
import { ESPERA_MAX_MS, VIGIA_MS, ouvirNome, reiniciarEscutaParaTestes } from '../src/lib/chamada.ts'

function reconhecedorDeMentira() {
  const criados = []
  let ativos = 0
  let maiorAtivos = 0
  /** Quantas vezes o próximo start() lança um erro inesperado. */
  const comportamento = { falharStart: 0 }
  class Falso {
    constructor() {
      this.ativo = false
      criados.push(this)
    }
    start() {
      if (comportamento.falharStart > 0) {
        comportamento.falharStart--
        const err = new Error('audio-capture busy')
        err.name = 'NotReadableError'
        throw err
      }
      if (this.ativo) {
        const err = new Error('já começou')
        err.name = 'InvalidStateError'
        throw err
      }
      this.ativo = true
      ativos++
      maiorAtivos = Math.max(maiorAtivos, ativos)
      queueMicrotask(() => this.onstart?.())
    }
    encerrar() {
      if (!this.ativo) return
      this.ativo = false
      ativos--
      this.onend?.()
    }
    stop() {
      // Como no Chrome: o fim chega depois.
      setTimeout(() => this.encerrar(), 50)
    }
    abort() {
      this.encerrar()
    }
    falar(texto, final = true) {
      this.onresult?.({ resultIndex: 0, results: [{ isFinal: final, 0: { transcript: texto } }] })
    }
  }
  globalThis.window = { SpeechRecognition: Falso }
  return { criados, comportamento, maiorAtivos: () => maiorAtivos, atual: () => criados.at(-1) }
}

const microtarefas = () => new Promise((r) => setImmediate(r))
/** O relógio falso não dispara, no mesmo avanço, o que foi agendado durante ele: anda aos poucos. */
async function avancar(t, ms) {
  for (let feito = 0; feito < ms; feito += 100) {
    t.mock.timers.tick(Math.min(100, ms - feito))
    await microtarefas()
  }
}

test('a escuta acorda pelo nome e fica parada até ser chamada de novo', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
  reiniciarEscutaParaTestes()
  const falso = reconhecedorDeMentira()
  const chamados = []
  const escuta = ouvirNome((fala) => chamados.push(fala), () => {})
  await microtarefas()
  falso.atual().falar('Apolo, que horas são')
  assert.deepEqual(chamados, ['Apolo, que horas são'])
  escuta.stop()
})

test('um start que lança erro inesperado não mata a escuta: recria e religa', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
  reiniciarEscutaParaTestes()
  const falso = reconhecedorDeMentira()
  falso.comportamento.falharStart = 2
  const relatos = []
  const chamados = []
  const escuta = ouvirNome((fala) => chamados.push(fala), () => {}, (r) => relatos.push(r))
  // Duas falhas seguidas: espera crescente, mas com teto, e um reconhecedor novo a cada vez.
  await avancar(t, ESPERA_MAX_MS * 3)
  assert.ok(relatos.some((r) => r.includes('não religou')), relatos.join(' | '))
  assert.ok(falso.criados.length >= 3, `só ${falso.criados.length} reconhecedores`)
  assert.equal(falso.atual().ativo, true, 'voltou a ouvir')
  falso.atual().falar('Apolo')
  await avancar(t, 500)
  assert.deepEqual(chamados, ['Apolo'])
  escuta.stop()
})

test('erros de rede não deixam a escuta surda por mais que o teto', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
  reiniciarEscutaParaTestes()
  const falso = reconhecedorDeMentira()
  const relatos = []
  const escuta = ouvirNome(() => {}, () => {}, (r) => relatos.push(r))
  await microtarefas()
  for (let i = 0; i < 10; i++) {
    const r = falso.atual()
    r.onerror({ error: 'network' })
    r.encerrar()
    await avancar(t, ESPERA_MAX_MS)
    assert.equal(falso.atual().ativo, true, `na volta ${i}, ainda surda depois de ${ESPERA_MAX_MS} ms`)
  }
  assert.ok(relatos.every((r) => !/em (\d+) ms/.test(r) || Number(r.match(/em (\d+) ms/)[1]) <= ESPERA_MAX_MS))
  // Um início bem-sucedido zera a espera: o próximo erro volta a religar rápido.
  falso.atual().onstart()
  falso.atual().onerror({ error: 'network' })
  falso.atual().encerrar()
  await avancar(t, 700)
  assert.equal(falso.atual().ativo, true)
  escuta.stop()
})

test('um reconhecedor que para de dar sinal é recriado pelo vigia', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
  reiniciarEscutaParaTestes()
  const falso = reconhecedorDeMentira()
  const relatos = []
  const escuta = ouvirNome(() => {}, () => {}, (r) => relatos.push(r))
  await microtarefas()
  const travado = falso.atual()
  // Travado: ativo, sem nenhum evento, para sempre.
  await avancar(t, VIGIA_MS + 6000)
  assert.notEqual(falso.atual(), travado, 'recriou')
  assert.equal(falso.atual().ativo, true)
  assert.ok(relatos.some((r) => r.includes('sem sinal')))
  escuta.stop()
})

test('trocas rápidas de fase não deixam dois reconhecedores capturando ao mesmo tempo', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
  reiniciarEscutaParaTestes()
  const falso = reconhecedorDeMentira()
  const chamados = []
  let escuta = ouvirNome((f) => chamados.push(`1:${f}`), () => {})
  await microtarefas()
  // Sai da espera e volta antes de o Chrome encerrar a anterior (o stop demora 50 ms).
  escuta.stop()
  escuta = ouvirNome((f) => chamados.push(`2:${f}`), () => {})
  await avancar(t, 60)
  await avancar(t, ESPERA_MAX_MS)
  assert.equal(falso.maiorAtivos(), 1)
  assert.equal(falso.atual().ativo, true, 'a escuta nova começou depois do fim da anterior')
  falso.atual().falar('Apolo')
  assert.deepEqual(chamados, ['2:Apolo'], 'o resultado vai para a escuta atual')
  escuta.stop()
})
