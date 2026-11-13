/** Testes da densidade de pixels da tela (ADR 0032). */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DENSIDADE_MAXIMA, aoMudarDensidade, densidadeDaTela } from '../src/lib/densidade.ts'

/**
 * Uma tela de mentira: só `devicePixelRatio` e o tanto de `matchMedia` que o
 * módulo usa. Guarda as consultas feitas para o teste poder disparar a mudança.
 */
function tela(densidade) {
  const consultas = []
  globalThis.window = {
    devicePixelRatio: densidade,
    matchMedia(pergunta) {
      const consulta = {
        pergunta,
        ouvintes: new Set(),
        addEventListener: (_, fn) => consulta.ouvintes.add(fn),
        removeEventListener: (_, fn) => consulta.ouvintes.delete(fn),
      }
      consultas.push(consulta)
      return consulta
    },
  }
  return {
    consultas,
    /** Troca a densidade e avisa quem estava ouvindo a consulta de antes. */
    mudar(nova) {
      globalThis.window.devicePixelRatio = nova
      for (const fn of [...consultas.at(-1).ouvintes]) fn()
    },
  }
}

test('a densidade do iPhone chega inteira, sem o teto de 2 de antes', () => {
  tela(3)
  assert.equal(densidadeDaTela(), 3)
})

test('acima do teto, o desenho para de crescer', () => {
  tela(4)
  assert.equal(densidadeDaTela(), DENSIDADE_MAXIMA)
})

test('tela sem densidade declarada vale 1', () => {
  tela(0)
  assert.equal(densidadeDaTela(), 1)
})

test('mudar de monitor avisa, e segue avisando depois disso', () => {
  const t = tela(2)
  const vistas = []
  aoMudarDensidade((d) => vistas.push(d))
  t.mudar(3)
  t.mudar(1)
  assert.deepEqual(vistas, [3, 1])
  // Uma consulta por densidade observada: a de agora e as duas refeitas.
  assert.equal(t.consultas.length, 3)
  assert.match(t.consultas[0].pergunta, /2dppx/)
})

test('cancelar para de avisar e não deixa ouvinte na tela', () => {
  const t = tela(2)
  let avisos = 0
  const cancelar = aoMudarDensidade(() => avisos++)
  cancelar()
  t.mudar(3)
  assert.equal(avisos, 0)
  assert.equal(t.consultas[0].ouvintes.size, 0)
})

test('sem navegador, a densidade é 1 e observar não quebra', () => {
  delete globalThis.window
  assert.equal(densidadeDaTela(), 1)
  assert.doesNotThrow(() => aoMudarDensidade(() => {})())
})
