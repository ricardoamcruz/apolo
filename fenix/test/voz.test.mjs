/** A Fênix recuperando a voz (docs/adr/0035): um degrau por vez, sem girar em falso. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PRAZOS, criarRecuperacaoDaVoz } from '../src/voz.mjs'

function montar(opcoes = {}) {
  let t = 1_000_000
  const feito = []
  const r = criarRecuperacaoDaVoz({
    agora: () => t,
    log() {},
    recarregar: () => feito.push('recarregar'),
    reabrir: () => feito.push('reabrir'),
    avisar: () => feito.push('avisar'),
    ...opcoes,
  })
  const ficar = (estado, ms) => {
    for (let i = 0; i < ms; i += 5000) {
      t += 5000
      r.ver({ estado })
    }
  }
  return { feito, ficar }
}

test('recarrega, reabre e avisa, um por vez, e só recomeça bem depois', () => {
  const { feito, ficar } = montar()
  ficar('falhando', PRAZOS.ruimMs - 5000)
  assert.deepEqual(feito, [])
  ficar('falhando', 10_000)
  assert.deepEqual(feito, ['recarregar'])
  ficar('falhando', PRAZOS.degrauMs + 5000)
  assert.deepEqual(feito, ['recarregar', 'reabrir'])
  ficar('falhando', PRAZOS.degrauMs + 5000)
  assert.deepEqual(feito, ['recarregar', 'reabrir', 'avisar'])
  ficar('falhando', PRAZOS.rearmarMs - 10_000)
  assert.equal(feito.length, 3)
  ficar('falhando', PRAZOS.ruimMs + 20_000)
  assert.equal(feito.at(-1), 'recarregar')
})

test('uma falha curta não faz nada, e voltar firme encerra o episódio', () => {
  const { feito, ficar } = montar()
  ficar('falhando', 30_000)
  ficar('ligada', PRAZOS.ruimMs + 10_000)
  ficar('falhando', 30_000)
  assert.deepEqual(feito, [])
})

test('sem página, reabre direto; fechada de propósito, não mexe', () => {
  const a = montar()
  a.ficar('sem interface', PRAZOS.ruimMs + 5000)
  assert.deepEqual(a.feito, ['reabrir'])
  const b = montar()
  b.ficar('fechada', PRAZOS.ruimMs * 5)
  assert.deepEqual(b.feito, [])
})

test('surda ou por texto só avisa, uma vez', () => {
  const { feito, ficar } = montar()
  ficar('por texto', 10 * 60_000)
  assert.deepEqual(feito, ['avisar'])
})

test('sem comando de reabrir, avisa', () => {
  const { feito, ficar } = montar({ reabrir: null })
  ficar('falhando', PRAZOS.ruimMs + PRAZOS.degrauMs + 15_000)
  assert.deepEqual(feito, ['recarregar', 'avisar'])
})
