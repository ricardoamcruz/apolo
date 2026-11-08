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
