/** O popup de desenvolvimento do bom dia (RF-55): o que vem do roadmap. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  backlogDoRoadmap,
  incluirNoBacklog,
  linhaDoBug,
  pedidoDaTarefa,
  pendenciasDoRoadmap,
  registrarBug,
  textoDoBacklog,
} from '../bridge/desenvolvimento.mjs'

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

/* ------------------------------------------------- registrar um bug (13/11) */

const ROADMAP_COM_BUGS = `# Roadmap

## Pendências em etapas
### Etapa 5 — Core
- [ ] algo

### Etapa 6 — Bugs para corrigir
- [x] **Velho (01/11/2026):** resolvido

## Próxima versão
- [ ] fora
`

const QUANDO = new Date('2026-11-17T15:00:00Z')

test('linha do bug no formato do backlog, numa linha só e sem markdown injetado', () => {
  assert.equal(
    linhaDoBug({ titulo: 'Popup não fecha.', detalhe: 'Pedi "fecha"\n e **nada**.' }, QUANDO),
    '- [ ] **Popup não fecha (17/11/2026):** Pedi "fecha" e nada.',
  )
  assert.throws(() => linhaDoBug({ titulo: '  ' }, QUANDO), /título/)
})

test('o bug entra no fim da etapa de bugs, e o resto do roadmap fica igual', () => {
  const novo = incluirNoBacklog(ROADMAP_COM_BUGS, ['- [ ] **Novo (17/11/2026):** x'])
  assert.match(novo, /resolvido\n- \[ \] \*\*Novo \(17\/11\/2026\):\*\* x\n\n## Próxima versão/)
  assert.equal(novo.replace('- [ ] **Novo (17/11/2026):** x\n', ''), ROADMAP_COM_BUGS)
  assert.equal(backlogDoRoadmap(novo).find((i) => i.titulo.startsWith('Novo'))?.id, '6.2')
  assert.throws(() => incluirNoBacklog('# sem etapa', ['x']), /etapa de bugs/)
})

function repositorioDeTeste(branch) {
  const repo = mkdtempSync(join(tmpdir(), 'apolo-backlog-'))
  const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim()
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'teste@exemplo')
  git('config', 'user.name', 'Teste')
  mkdirSync(join(repo, 'docs'))
  writeFileSync(join(repo, 'docs/05-roadmap.md'), ROADMAP_COM_BUGS)
  writeFileSync(join(repo, 'outro.txt'), 'a\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'início')
  if (branch) git('switch', '-qc', branch)
  return { repo, git, pasta: mkdtempSync(join(tmpdir(), 'apolo-pasta-')) }
}

test('numa branch de fase: commit só do roadmap, sem levar outras alterações', async () => {
  const r = repositorioDeTeste('fase-2.10/x')
  writeFileSync(join(r.repo, 'outro.txt'), 'mexido\n')
  const res = await registrarBug({ repo: r.repo, pasta: r.pasta, titulo: 'Popup não fecha', detalhe: 'nada', agora: QUANDO })
  assert.equal(res.ok, true, res.mensagem)
  assert.equal(r.git('log', '-1', '--format=%s'), 'Backlog: Popup não fecha')
  assert.equal(r.git('show', '--name-only', '--format=', 'HEAD'), 'docs/05-roadmap.md')
  assert.equal(r.git('status', '--porcelain'), 'M outro.txt')
  assert.match(readFileSync(join(r.repo, 'docs/05-roadmap.md'), 'utf8'), /Popup não fecha \(17\/11\/2026\)/)
})

test('na main não há commit: fica anotado e entra no próximo registro numa branch', async () => {
  const r = repositorioDeTeste()
  const naMain = await registrarBug({ repo: r.repo, pasta: r.pasta, titulo: 'Primeiro', agora: QUANDO })
  assert.equal(naMain.ok, true)
  assert.match(naMain.mensagem, /main/)
  assert.equal(r.git('rev-list', '--count', 'HEAD'), '1')
  assert.match(readFileSync(join(r.pasta, 'bugs-pendentes.md'), 'utf8'), /Primeiro/)

  r.git('switch', '-qc', 'fase-2.10/x')
  const res = await registrarBug({ repo: r.repo, pasta: r.pasta, titulo: 'Segundo', agora: QUANDO })
  assert.match(res.mensagem, /1 que estava/)
  const texto = readFileSync(join(r.repo, 'docs/05-roadmap.md'), 'utf8')
  assert.ok(texto.indexOf('Primeiro') < texto.indexOf('Segundo') && texto.includes('Primeiro'))
  assert.equal(existsSync(join(r.pasta, 'bugs-pendentes.md')), false)
})

test('com teste do autodev no ar, ou roadmap mexido, não faz commit', async () => {
  const r = repositorioDeTeste('fase-2.10/x')
  const emTeste = await registrarBug({ repo: r.repo, pasta: r.pasta, titulo: 'X', emTeste: true, agora: QUANDO })
  assert.match(emTeste.mensagem, /em teste/)
  assert.equal(r.git('rev-list', '--count', 'HEAD'), '1')
  writeFileSync(join(r.repo, 'docs/05-roadmap.md'), ROADMAP_COM_BUGS + 'mexido\n')
  const mexido = await registrarBug({ repo: r.repo, pasta: r.pasta, titulo: 'Y', agora: QUANDO })
  assert.equal(mexido.ok, false)
  assert.match(mexido.mensagem, /não commitadas/)
})
