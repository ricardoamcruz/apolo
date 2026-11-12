/** O popup de desenvolvimento do bom dia (RF-55): o que vem do roadmap. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pendenciasDoRoadmap } from '../bridge/desenvolvimento.mjs'

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
