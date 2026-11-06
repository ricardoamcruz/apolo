/** Testes da memória das preferências de exibição (RF-57). */

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { criarPreferencias } from '../bridge/preferencias.mjs'

const arquivo = () => join(mkdtempSync(join(tmpdir(), 'apolo-pref-')), 'sub', 'preferencias.json')

test('por padrão, ponte e chat ficam desativados', () => {
  assert.deepEqual(criarPreferencias(arquivo()).valores(), { exibirPonte: false, exibirChat: false })
})

test('o que foi ativado continua ativo ao religar', () => {
  const a = arquivo()
  criarPreferencias(a).gravar({ exibirPonte: true })
  assert.deepEqual(criarPreferencias(a).valores(), { exibirPonte: true, exibirChat: false })
})

test('o que foi desativado continua desativado ao religar', () => {
  const a = arquivo()
  const p = criarPreferencias(a)
  p.gravar({ exibirPonte: true, exibirChat: true })
  p.gravar({ exibirPonte: false, exibirChat: false })
  assert.deepEqual(criarPreferencias(a).valores(), { exibirPonte: false, exibirChat: false })
})

test('só guarda chaves conhecidas e valores verdadeiro ou falso', () => {
  const a = arquivo()
  const p = criarPreferencias(a)
  p.gravar({ exibirChat: 'sim', __proto__: { x: 1 }, intruso: true, exibirPonte: true })
  assert.deepEqual(JSON.parse(readFileSync(a, 'utf8')), { exibirPonte: true, exibirChat: false })
})

test('arquivo corrompido cai no padrão', () => {
  const a = arquivo()
  criarPreferencias(a).gravar({ exibirChat: true })
  writeFileSync(a, '{ quebrado')
  assert.deepEqual(criarPreferencias(a).valores(), { exibirPonte: false, exibirChat: false })
})
