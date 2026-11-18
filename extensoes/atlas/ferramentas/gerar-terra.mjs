/**
 * Gera `terra.bin`, a máscara de terra do A.T.L.A.S., a partir do Natural Earth.
 *
 *   node extensoes/atlas/ferramentas/gerar-terra.mjs <land-50m.json>
 *
 * A entrada é o TopoJSON `land-50m.json` do pacote world-atlas (Natural Earth
 * 1:50m, domínio público). A saída diz, para cada ponto de duas esferas de
 * Fibonacci (160 mil e 640 mil pontos), se ele cai em terra e se é costa: um bit
 * cada. A extensão refaz as esferas e acende só os pontos de terra.
 *
 * Formato: "ATL1", n1 e n2 (uint32, little-endian), e então os bits de terra e de
 * costa da primeira esfera, depois os da segunda (ceil(n / 8) bytes cada).
 *
 * Só roda quando os dados mudarem; o resultado vai para o repositório.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ESFERAS = [160_000, 640_000]
/** Até onde olhar, em graus, para decidir que um ponto de terra é costa. */
const VIZINHANCA = { 160000: 0.55, 640000: 0.3 }
const W = 8192
const H = 4096

const [, , entrada] = process.argv
if (!entrada) {
  console.error('uso: node gerar-terra.mjs <land-50m.json>')
  process.exit(1)
}

// O TopoJSON guarda arcos quantizados e em delta; um anel é uma sequência de arcos.
const topo = JSON.parse(readFileSync(entrada, 'utf8'))
const [sx, sy] = topo.transform.scale
const [tx, ty] = topo.transform.translate
const arcos = topo.arcs.map((arco) => {
  let x = 0
  let y = 0
  return arco.map(([dx, dy]) => [(x += dx) * sx + tx, (y += dy) * sy + ty])
})
const anel = (ids) => {
  const pontos = []
  for (const id of ids) {
    const a = id < 0 ? arcos[~id].slice().reverse() : arcos[id]
    pontos.push(...(pontos.length ? a.slice(1) : a))
  }
  return pontos
}
const objeto = topo.objects.land
const geometrias = objeto.type === 'GeometryCollection' ? objeto.geometries : [objeto]
const aneis = []
for (const g of geometrias) {
  const poligonos = g.type === 'Polygon' ? [g.arcs] : g.arcs
  for (const p of poligonos) for (const a of p) aneis.push(anel(a))
}

// Rasteriza em equirretangular, preenchendo par-ímpar linha a linha.
const grade = new Uint8Array(W * H)
for (let y = 0; y < H; y++) {
  const lat = 90 - ((y + 0.5) / H) * 180
  const xs = []
  for (const a of aneis) {
    for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
      const [x1, y1] = a[j]
      const [x2, y2] = a[i]
      if (y1 > lat !== y2 > lat) xs.push(x1 + ((lat - y1) / (y2 - y1)) * (x2 - x1))
    }
  }
  xs.sort((p, q) => p - q)
  for (let k = 0; k + 1 < xs.length; k += 2) {
    const de = Math.max(0, Math.floor(((xs[k] + 180) / 360) * W))
    const ate = Math.min(W - 1, Math.floor(((xs[k + 1] + 180) / 360) * W))
    grade.fill(1, y * W + de, y * W + ate + 1)
  }
}
const terra = (lat, lon) => {
  const x = ((Math.floor(((lon + 180) / 360) * W) % W) + W) % W
  const y = Math.min(H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * H)))
  return grade[y * W + x]
}

// A mesma esfera que a extensão refaz (interface.js, `pontoDaEsfera`).
const OURO = Math.PI * (3 - Math.sqrt(5))
function mascaras(n) {
  const t = new Uint8Array(Math.ceil(n / 8))
  const c = new Uint8Array(Math.ceil(n / 8))
  const r = VIZINHANCA[n]
  let emTerra = 0
  for (let i = 0; i < n; i++) {
    const lat = (Math.asin(1 - ((i + 0.5) / n) * 2) * 180) / Math.PI
    const lon = (((((i * OURO * 180) / Math.PI) % 360) + 540) % 360) - 180
    if (!terra(lat, lon)) continue
    t[i >> 3] |= 1 << (i & 7)
    emTerra++
    const k = r / Math.max(0.2, Math.cos((lat * Math.PI) / 180))
    const vizinhos = [[r, 0], [-r, 0], [0, k], [0, -k], [r, k], [-r, -k], [r, -k], [-r, k]]
    if (vizinhos.some(([dl, dn]) => !terra(lat + dl, lon + dn))) c[i >> 3] |= 1 << (i & 7)
  }
  console.log(`esfera de ${n}: ${emTerra} pontos de terra`)
  return [t, c]
}

const cabecalho = Buffer.alloc(12)
cabecalho.write('ATL1', 0, 'latin1')
cabecalho.writeUInt32LE(ESFERAS[0], 4)
cabecalho.writeUInt32LE(ESFERAS[1], 8)
const saida = fileURLToPath(new URL('../terra.bin', import.meta.url))
writeFileSync(saida, Buffer.concat([cabecalho, ...ESFERAS.flatMap((n) => mascaras(n))]))
console.log(`gravado ${saida}`)
