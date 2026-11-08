/** Testes da aba SISTEMAS e da cor de alerta (ADR 0018). */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { contrastante } from '../src/lib/cor.ts'
import { montarSistemas, resumoSistemas } from '../src/lib/sistemas.ts'

const ok = { ponte: true, voz: true }
const matiz = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return h * 60
}

test('tudo o que o A.P.O.L.O. usa para rodar vira uma linha só: C.O.R.E.', () => {
  const lista = montarSistemas(
    [{ nome: 'apolo' }, { nome: 'apolo_git', estado: 'pending' }, { nome: 'claude.ai Claude Docs', estado: 'connected' }],
    ok,
  )
  assert.deepEqual(lista.map((s) => s.nome), ['C.O.R.E.'])
  assert.equal(lista[0].degradado, false)
})

test('uma parte com falha degrada o C.O.R.E. e diz qual foi', () => {
  const [core] = montarSistemas([{ nome: 'apolo_git', estado: 'failed' }], ok)
  assert.equal(core.degradado, true)
  assert.deepEqual(core.problemas, ['apolo_git: falhou'])
})

test('ponte ou voz fora do ar degradam o C.O.R.E.; voz ainda não ligada, não', () => {
  assert.deepEqual(montarSistemas([], { ponte: false, voz: false })[0].problemas, ['ponte desconectada', 'voz desconectada'])
  assert.equal(montarSistemas([], { ponte: true, voz: null })[0].degradado, false)
})

test('o que é plugável aparece à parte, com nome próprio, e não degrada o C.O.R.E.', () => {
  const [core, celular] = montarSistemas([{ nome: 'celular', estado: 'failed' }], ok)
  assert.equal(core.degradado, false)
  assert.deepEqual([celular.nome, celular.tipo, celular.degradado], ['H.E.R.M.E.S.', 'conector', true])
})

test('um conector qualquer faz parte do C.O.R.E., e não vira linha à parte', () => {
  const lista = montarSistemas([{ nome: 'outro', estado: 'connected' }], ok)
  assert.deepEqual(lista.map((s) => s.nome), ['C.O.R.E.'])
})

test('o resumo narra o que está errado, ou que está tudo bem', () => {
  assert.match(resumoSistemas(montarSistemas([], ok)), /operacionais/)
  assert.equal(resumoSistemas(montarSistemas([], { ponte: true, voz: false })), 'C.O.R.E. degradado: voz desconectada.')
})

test('o alerta é o oposto da cor da interface, em qualquer cor dela', () => {
  for (const cor of ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#a97bff', '#19d8d2', '#f0a93c', '#3ef2a8']) {
    const distancia = Math.abs(matiz(cor) - matiz(contrastante(cor)))
    assert.ok(Math.abs(Math.min(distancia, 360 - distancia) - 180) < 3, `${cor} → ${contrastante(cor)}`)
  }
})

test('o alerta nunca é um vermelho fixo: acompanha a cor', () => {
  assert.notEqual(contrastante('#ff0000'), contrastante('#00ffff'))
  assert.match(contrastante('#0f0'), /^#[0-9a-f]{6}$/)
})

test('o alerta é legível sobre o fundo escuro mesmo quando o oposto é azul', () => {
  const luz = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  for (const cor of ['#ffe000', '#ffff00', '#ff8000', '#00ff00', '#ff2020']) {
    assert.ok(luz(contrastante(cor)) >= 0.34, `${cor} → ${contrastante(cor)}`)
  }
})

test('cinza não tem oposto: o alerta cai no âmbar, e cor ilegível também', () => {
  assert.equal(contrastante('#808080'), contrastante('#ffffff'))
  assert.equal(contrastante('cor-estranha'), contrastante('#808080'))
})
