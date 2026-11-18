/**
 * Testes do A.T.L.A.S. (ADR 0034): o decodificador dos blocos vetoriais, a terceira
 * cor e a frase que libera a localização.
 *
 * O bloco de teste é um bloco real do OpenFreeMap (14/6127/9306, Ilhabela, SP):
 * © colaboradores do OpenStreetMap (ODbL), esquema OpenMapTiles.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { processarBloco } from '../extensoes/atlas/interface.js'
import { contrastante, terceira } from '../src/lib/cor.ts'
import { pedeLocalizacao } from '../src/lib/comandos.ts'

const R_TERRA = 6371008.8
const BLOCO = { z: 14, x: 6127, y: 9306 }

function pedido({ z, x, y }) {
  const n = 2 ** z
  const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n)))
  const lon = ((x + 0.5) / n) * 2 * Math.PI - Math.PI
  const A = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)]
  const E = [Math.cos(lon), 0, -Math.sin(lon)]
  const N = [-Math.sin(lat) * Math.sin(lon), Math.cos(lat), -Math.sin(lat) * Math.cos(lon)]
  return { z, x, y, ancora: A, base: [...E, ...N, ...A] }
}
const bloco = () => {
  const b = readFileSync(new URL('./fixtures/atlas-14-6127-9306.pbf', import.meta.url))
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}
const contar = (cls) => cls.reduce((a, c) => ((a[c] = (a[c] ?? 0) + 1), a), {})

test('um bloco real vira pontos de rua, de água e de parque, e os nomes dos lugares', () => {
  const r = processarBloco(bloco(), pedido(BLOCO))
  const classes = contar([...r.cls])
  assert.ok(r.cls.length > 500, `só ${r.cls.length} pontos`)
  assert.ok(classes[2] > 0 && classes[4] > 0, 'vias secundárias e ruas')
  assert.ok(classes[6] > 0, 'a costa (água)')
  assert.ok(classes[8] > 0, 'parque')
  assert.equal(r.pos.length, r.cls.length * 3)
  assert.equal(r.seed.length, r.cls.length)
  assert.deepEqual(r.lugares.map((l) => l.nome).sort(), ['Centro', 'Vila'])
  for (const l of r.lugares) assert.ok(Math.abs(l.lat + 23.78) < 0.02 && Math.abs(l.lon + 45.36) < 0.02, `${l.nome} fora de Ilhabela`)
})

test('os pontos ficam dentro do bloco, no plano da âncora, com precisão de metro', () => {
  const r = processarBloco(bloco(), pedido(BLOCO))
  // O bloco 14 tem uns 2,24 km de lado nesta latitude: nada passa de metade, com folga.
  let maior = 0
  let maiorAltura = 0
  for (let k = 0; k < r.pos.length; k += 3) {
    maior = Math.max(maior, Math.abs(r.pos[k]) * R_TERRA, Math.abs(r.pos[k + 1]) * R_TERRA)
    maiorAltura = Math.max(maiorAltura, Math.abs(r.pos[k + 2]) * R_TERRA)
  }
  assert.ok(maior < 1150, `ponto a ${Math.round(maior)} m do centro`)
  assert.ok(maior > 900, 'os pontos cobrem o bloco')
  // A curvatura da Terra a 1,1 km do centro é de uns 10 cm: o plano é a esfera.
  assert.ok(maiorAltura < 1, `curvatura de ${maiorAltura} m`)
})

test('de longe (antes do zoom 13), as ruas de bairro ficam de fora', () => {
  const longe = contar([...processarBloco(bloco(), { ...pedido(BLOCO), z: 12 }).cls])
  assert.equal(longe[4] ?? 0, 0)
  assert.equal(longe[5] ?? 0, 0)
  assert.ok(longe[2] > 0, 'as vias maiores continuam')
})

test('a terceira cor fica longe das outras duas e lê sobre o fundo escuro', () => {
  const matiz = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    const max = Math.max(r, g, b)
    const d = max - Math.min(r, g, b)
    const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    return h * 60
  }
  const distancia = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))
  for (const ui of ['#00e5ff', '#3ef2a8', '#ffd23c', '#c9a2ff', '#ff4d4d']) {
    const t = terceira(ui)
    assert.match(t, /^#[0-9a-f]{6}$/)
    assert.ok(distancia(matiz(t), matiz(ui)) >= 120, `${t} perto demais de ${ui}`)
    assert.ok(distancia(matiz(t), matiz(contrastante(ui))) >= 45, `${t} perto demais do marcador`)
  }
  // O exemplo dele: interface azul, marcador vermelho, localização amarela.
  const amarelo = matiz(terceira('#00e5ff'))
  assert.ok(amarelo > 40 && amarelo < 70, `matiz ${amarelo}`)
})

test('a localização só é liberada quando ele pede a dele', () => {
  for (const fala of ['Apolo, onde eu estou?', 'onde estou agora', 'me mostra no mapa', 'marca a minha localização', 'cadê a minha posição no mapa']) {
    assert.ok(pedeLocalizacao(fala), fala)
  }
  for (const fala of ['marque São Paulo', 'onde fica Tóquio?', 'mostre as cafeterias de Pinheiros', 'feche o mapa']) {
    assert.ok(!pedeLocalizacao(fala), fala)
  }
})
