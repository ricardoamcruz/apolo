/**
 * A identidade escolhida em 12/11/2026 (ADR 0013 revisada): o núcleo Enxame, a
 * marca Lira e um ícone para cada sistema da aba SISTEMAS.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { enxameVertex, particlesFragment, pontosDoEnxame } from '../src/scene/shaders.ts'
import { montarSistemas } from '../src/lib/sistemas.ts'

test('o enxame espalha os pontos por igual na esfera, de polo a polo', () => {
  const { positions, seeds } = pontosDoEnxame(2600, () => 0.5)
  assert.equal(positions.length, 2600 * 3)
  assert.equal(seeds.length, 2600)
  let norte = 0, sul = 0
  for (let i = 0; i < 2600; i++) {
    const [x, y, z] = positions.slice(i * 3, i * 3 + 3)
    assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-5, `ponto ${i} fora da esfera`)
    if (y > 0) norte++
    else sul++
  }
  // Fibonacci: metade em cada hemisfério, sem polo amontoado.
  assert.ok(Math.abs(norte - sul) <= 1)
})

test('o shader do enxame usa o fragmento das partículas e os controles do núcleo', () => {
  for (const u of ['uPhase', 'uAtivo', 'uLevel', 'uOpen', 'uRaio', 'uSize', 'aSeed']) assert.match(enxameVertex, new RegExp(u))
  assert.match(particlesFragment, /uIntensity/)
})

test('o enxame é o núcleo padrão, e o anel continua como estilo', () => {
  const store = readFileSync('src/store.ts', 'utf8')
  assert.match(store, /style: 'enxame', visible: true/)
  const ui = readFileSync('bridge/ui.mjs', 'utf8')
  assert.match(ui, /\.enum\(\['enxame', 'ring', 'sphere', 'wire'\]\)/)
})

test('cada sistema da aba SISTEMAS tem um ícone, e a marca é a Lira', () => {
  const icones = readFileSync('src/ui/icones.tsx', 'utf8')
  const sistemas = montarSistemas([{ nome: 'fenix' }, { nome: 'celular' }, { nome: 'aurora' }], { ponte: true, voz: true })
  for (const { id } of sistemas) assert.match(icones, new RegExp(`^  ${id}: \\{`, 'm'), `falta o ícone de ${id}`)
  assert.match(icones, /export const Lira/)
  // O favicon repete os traços da Lira.
  const favicon = readFileSync('public/favicon.svg', 'utf8')
  assert.match(favicon, /M4\.5 3\.5C4\.5 7 8 8 8 11\.5V17/)
})

test('a Lira fica fora do cabeçalho, mas continua desenhada (revisão de 13/11/2026)', () => {
  const hud = readFileSync('src/ui/Hud.tsx', 'utf8')
  assert.doesNotMatch(hud, /<Lira\b/)
  assert.match(hud, /<span className="brand-mark">A\.P\.O\.L\.O\.<\/span>/)
})
