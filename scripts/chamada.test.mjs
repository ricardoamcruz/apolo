/** Testes de como o A.P.O.L.O. reconhece que foi chamado em espera (ADR 0017). */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chamouPeloNome } from '../src/lib/chamada.ts'

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
