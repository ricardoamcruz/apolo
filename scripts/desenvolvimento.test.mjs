/** O popup de desenvolvimento do bom dia (RF-55): o que vem do roadmap. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { backlogDoRoadmap, pedidoDaTarefa, pendenciasDoRoadmap, textoDoBacklog } from '../bridge/desenvolvimento.mjs'

const ROADMAP = `# 05 — Roadmap

## Pendências em etapas (organizadas em 08/11/2026)
Texto de abertura.

### Etapa 1 — Validar (sem código novo)
- [ ] **Bom dia por voz (RF-55):** dizer "bom dia" no PC
- [x] **Feito:** não aparece
- [ ] Revogar a senha de app: e apagar a variável

### Etapa 2 — Visual
- [ ] Página de comparação com 2 paletas; **a escolha é do Ricardo**

### Etapa 3 — Tudo feito
- [x] nada aberto

## Próxima versão
- [ ] **fora da seção**
`

test('roadmap: só itens abertos da seção de pendências, com o título curto', () => {
  assert.deepEqual(pendenciasDoRoadmap(ROADMAP), [
    { etapa: 'Etapa 1 — Validar', total: 2, itens: ['Bom dia por voz (RF-55)', 'Revogar a senha de app'] },
    { etapa: 'Etapa 2 — Visual', total: 1, itens: ['Página de comparação com 2 paletas'] },
  ])
})

test('roadmap sem a seção não quebra', () => {
  assert.deepEqual(pendenciasDoRoadmap('# nada'), [])
  assert.deepEqual(pendenciasDoRoadmap(undefined), [])
})

test('backlog: cada item aberto ganha o número da etapa e a posição nela, contando os feitos', () => {
  const itens = backlogDoRoadmap(ROADMAP)
  assert.deepEqual(
    itens.map((i) => [i.id, i.titulo]),
    [
      ['1.1', 'Bom dia por voz (RF-55)'],
      ['1.3', 'Revogar a senha de app'],
      ['2.1', 'Página de comparação com 2 paletas'],
    ],
  )
  assert.equal(itens[0].etapa, 'Etapa 1 — Validar')
  assert.equal(itens[0].texto, 'Bom dia por voz (RF-55): dizer "bom dia" no PC')
  assert.deepEqual(backlogDoRoadmap('# nada'), [])
})

test('backlog em voz: número e título, e um limite para não virar discurso', () => {
  const itens = backlogDoRoadmap(ROADMAP)
  assert.match(textoDoBacklog(itens), /1\.1 Bom dia por voz \(RF-55\); 1\.3 Revogar a senha de app; 2\.1/)
  assert.match(textoDoBacklog(itens, 1), /e mais 2\.$/)
  assert.match(textoDoBacklog([]), /não tem itens abertos/)
})

test('o pedido de uma tarefa leva o item inteiro e o jeito de trabalhar do chat', () => {
  const [item] = backlogDoRoadmap(ROADMAP)
  const pedido = pedidoDaTarefa(item)
  assert.match(pedido, /^Faça o item 1\.1 do backlog, em docs\/05-roadmap\.md \("Etapa 1 — Validar"\): Bom dia por voz/)
  for (const parte of ['AGENTS.md', 'testes', 'lint e build', 'docs/01-requisitos.md', 'ADR']) assert.ok(pedido.includes(parte), parte)
})

test('o backlog do roadmap de verdade tem números únicos', async () => {
  const { readFileSync } = await import('node:fs')
  const itens = backlogDoRoadmap(readFileSync('docs/05-roadmap.md', 'utf8'))
  assert.ok(itens.length > 0)
  assert.equal(new Set(itens.map((i) => i.id)).size, itens.length)
})
