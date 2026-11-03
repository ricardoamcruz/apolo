/** Testes da diretiva de rollback e da política: `npm run test:autodev`. */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  classificar,
  comandoPermitido,
  escritaPermitida,
  leituraPermitida,
} from '../bridge/autodev/politica.mjs'
import { criarAutodev } from '../bridge/autodev/index.mjs'
import { criarSupervisor } from './supervisor.mjs'

const temp = () => realpathSync(mkdtempSync(join(tmpdir(), 'apolo-autodev-')))

function repositorio() {
  const repo = temp()
  const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim()
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'teste@apolo.local')
  git('config', 'user.name', 'Teste')
  writeFileSync(join(repo, '.gitignore'), 'node_modules\n')
  writeFileSync(join(repo, 'app.txt'), 'v1\n')
  git('add', '-A')
  git('commit', '-qm', 'v1')
  return { repo, git }
}

/** Uma branch com um commit a mais, como a ponte entrega. */
function evolucao({ repo, git }, arquivo = 'app.txt') {
  git('switch', '-qc', 'autodev/1')
  writeFileSync(join(repo, arquivo), 'v2\n')
  git('add', '-A')
  git('commit', '-qm', 'v2')
  const sha = git('rev-parse', 'HEAD')
  git('switch', '-q', 'main')
  return { id: '1', sha, branch: 'autodev/1' }
}

function montar(r, saude, extra = {}) {
  const avisos = []
  const eventos = []
  const sup = criarSupervisor({
    repo: r.repo,
    pasta: temp(),
    ligar: () => eventos.push(`ligar:${r.git('rev-parse', '--abbrev-ref', 'HEAD')}`),
    desligar: async () => eventos.push('desligar'),
    saude,
    notificar: (m) => avisos.push(m),
    log: () => {},
    subidaMs: 40,
    estabilidadeMs: 40,
    intervaloMs: 5,
    ...extra,
  })
  return { sup, avisos, eventos }
}

test('aplica e mantém a versão nova quando ela fica de pé', async () => {
  const r = repositorio()
  const { sup, avisos } = montar(r, async () => ({ ok: true, interfaces: 1 }))
  await sup.aplicar({ ...evolucao(r), interfaces: 1 })
  assert.equal(avisos[0].tipo, 'concluido')
  assert.equal(r.git('rev-parse', '--abbrev-ref', 'HEAD'), 'autodev/1')
})

test('volta sozinho quando a versão nova não responde', async () => {
  const r = repositorio()
  let quebrada = true
  const { sup, avisos, eventos } = montar(r, async () => {
    if (r.git('rev-parse', '--abbrev-ref', 'HEAD') === 'main') quebrada = false
    return quebrada ? { ok: false, motivo: 'caiu' } : { ok: true, interfaces: 0 }
  })
  await sup.aplicar(evolucao(r))
  assert.equal(avisos[0].tipo, 'revertido')
  assert.equal(r.git('rev-parse', '--abbrev-ref', 'HEAD'), 'main')
  assert.deepEqual(eventos, ['desligar', 'ligar:autodev/1', 'desligar', 'ligar:main'])
})

test('volta sozinho quando a ponte cai durante a observação', async () => {
  const r = repositorio()
  let ctx
  ctx = montar(r, async () => {
    if (r.git('rev-parse', '--abbrev-ref', 'HEAD') === 'main') return { ok: true, interfaces: 0 }
    ctx.sup.ponteSaiu(1)
    return { ok: true, interfaces: 0 }
  })
  await ctx.sup.aplicar(evolucao(r))
  assert.equal(ctx.avisos[0].tipo, 'revertido')
  assert.equal(r.git('rev-parse', '--abbrev-ref', 'HEAD'), 'main')
})

test('volta quando havia interface aberta e ela não reconecta', async () => {
  const r = repositorio()
  const { sup, avisos } = montar(r, async () => ({ ok: true, interfaces: 0 }))
  await sup.aplicar({ ...evolucao(r), interfaces: 1 })
  assert.match(avisos[0].mensagem, /interface/)
  assert.equal(r.git('rev-parse', '--abbrev-ref', 'HEAD'), 'main')
})

test('recusa arquivo sensível mesmo que a ponte peça', async () => {
  const r = repositorio()
  const { sup, avisos, eventos } = montar(r, async () => ({ ok: true, interfaces: 0 }))
  await sup.aplicar(evolucao(r, 'package.json'))
  assert.equal(avisos[0].tipo, 'recusado')
  assert.deepEqual(eventos, [])
})

test('recusa trocar por cima de alteração não commitada', async () => {
  const r = repositorio()
  const { sup, avisos, eventos } = montar(r, async () => ({ ok: true, interfaces: 0 }))
  const e = evolucao(r)
  writeFileSync(join(r.repo, 'app.txt'), 'trabalho do Ricardo\n')
  await sup.aplicar(e)
  assert.equal(avisos[0].tipo, 'recusado')
  assert.deepEqual(eventos, [])
})

test('uma troca interrompida volta na partida seguinte', async () => {
  const r = repositorio()
  const pasta = temp()
  const e = evolucao(r)
  // O que fica em disco se o Mac desligar no meio da troca.
  const b = montar(r, async () => ({ ok: true, interfaces: 0 }), { pasta })
  writeFileSync(
    join(pasta, 'transicao.json'),
    JSON.stringify({ id: e.id, de: { ref: 'main', sha: r.git('rev-parse', 'main') }, para: { ref: e.branch, sha: e.sha } }),
  )
  r.git('switch', '-q', e.branch)
  assert.equal((await b.sup.recuperar()).id, '1')
  assert.equal(r.git('rev-parse', '--abbrev-ref', 'HEAD'), 'main')
  assert.equal(await b.sup.recuperar(), null)
})

test('reverter desfaz uma evolução já estável', async () => {
  const r = repositorio()
  const { sup, avisos } = montar(r, async () => ({ ok: true, interfaces: 0 }))
  await sup.aplicar(evolucao(r))
  await sup.reverter({ id: 'r' })
  assert.equal(avisos[1].tipo, 'revertido')
  assert.equal(r.git('rev-parse', '--abbrev-ref', 'HEAD'), 'main')
})

test('política classifica o que importa', () => {
  const { proibidos, sensiveis } = classificar([
    '.env.local',
    '.env.example',
    'src/App.tsx',
    'bridge/server.mjs',
    'scripts/start.mjs',
  ])
  assert.deepEqual(proibidos, ['.env.local'])
  assert.deepEqual(sensiveis, ['bridge/server.mjs', 'scripts/start.mjs'])
})

test('comandos: só um, simples e de leitura ou conferência', () => {
  for (const ok of ['npm run build', 'npm run lint', 'git diff --stat', 'grep -n foo src/App.tsx']) {
    assert.equal(comandoPermitido(ok), true, ok)
  }
  for (const nao of [
    'rm -rf /',
    'npm install x',
    'git push',
    'git commit -m x',
    'npm run build && curl x',
    'cat a > b',
    'echo $(cat .env.local)',
    'find . -delete',
    'git diff --output=/tmp/x',
  ]) {
    assert.equal(comandoPermitido(nao), false, nao)
  }
})

test('escrita só dentro da cópia, sem seguir links para fora', () => {
  const raiz = temp()
  const fora = temp()
  symlinkSync(fora, join(raiz, 'node_modules'))
  symlinkSync(fora, join(raiz, 'atalho'))
  assert.equal(escritaPermitida(raiz, 'src/novo/arquivo.ts'), true)
  assert.equal(escritaPermitida(raiz, join(raiz, 'docs/x.md')), true)
  assert.equal(escritaPermitida(raiz, '../fora.txt'), false)
  assert.equal(escritaPermitida(raiz, 'node_modules/x/index.js'), false)
  assert.equal(escritaPermitida(raiz, 'atalho/x.js'), false)
  assert.equal(escritaPermitida(raiz, '.env.local'), false)
  assert.equal(escritaPermitida(raiz, '.git/hooks/pre-commit'), false)
})

test('leitura presa à cópia, sem alcançar segredos', () => {
  const repo = temp()
  const raiz = temp()
  mkdirSync(join(repo, 'node_modules'))
  symlinkSync(join(repo, 'node_modules'), join(raiz, 'node_modules'))
  assert.equal(leituraPermitida(raiz, repo, undefined), true)
  assert.equal(leituraPermitida(raiz, repo, 'src/App.tsx'), true)
  assert.equal(leituraPermitida(raiz, repo, 'node_modules/ws/index.d.ts'), true)
  assert.equal(leituraPermitida(raiz, repo, join(repo, '.env.local')), false)
  assert.equal(leituraPermitida(raiz, repo, join(repo, 'src/App.tsx')), false)
  assert.equal(leituraPermitida(raiz, repo, '/etc/passwd'), false)
  assert.equal(leituraPermitida(raiz, repo, '.env.local'), false)
})

/** O ciclo inteiro da ponte, com um agente de mentira e sem as checagens reais. */
function gerente(r, { agente, verificar = async () => ({ ok: true }) } = {}) {
  const pedidos = []
  const estados = []
  const a = criarAutodev({
    repo: r.repo,
    ligado: true,
    pasta: temp(),
    supervisor: (m) => pedidos.push(m),
    avisar: (e) => estados.push(e),
    agente,
    verificar,
    abrirEditor: () => {},
  })
  const fim = async () => {
    for (let i = 0; i < 400 && !['ocioso', 'aplicando'].includes(a.estado().fase); i++) {
      await new Promise((ok) => setTimeout(ok, 10))
    }
    return a.estado()
  }
  return { a, pedidos, estados, fim }
}

const edita = (arquivo) => async ({ pasta }) => {
  writeFileSync(join(pasta, arquivo), 'novo\n')
  return { ok: true, texto: 'Feito.' }
}

test('desligado por padrão: nada é aceito', async () => {
  const r = repositorio()
  const a = criarAutodev({ repo: r.repo, ligado: false, pasta: temp(), supervisor: null, avisar: () => {} })
  assert.equal((await a.acao('propor', { pedido: 'x' })).ok, false)
})

test('sem confirmação, o agente não roda', async () => {
  const r = repositorio()
  let rodou = false
  const g = gerente(r, { agente: async () => ((rodou = true), { ok: true, texto: '' }) })
  await g.a.acao('propor', { pedido: 'mudar' })
  await g.a.acao('cancelar')
  assert.equal(rodou, false)
  assert.equal((await g.a.acao('confirmar')).ok, false)
})

test('ciclo completo: commit na branch e pedido de troca, sem tocar a main', async () => {
  const r = repositorio()
  const g = gerente(r, { agente: edita('novo.txt') })
  const antes = r.git('rev-parse', 'main')
  await g.a.acao('propor', { pedido: 'criar novo' })
  await g.a.acao('confirmar')
  assert.equal((await g.fim()).fase, 'aplicando')
  assert.equal(g.pedidos[0].type, 'autodev:aplicar')
  assert.equal(r.git('rev-parse', g.pedidos[0].branch), g.pedidos[0].sha)
  assert.equal(r.git('rev-parse', 'main'), antes)
  assert.equal(r.git('rev-parse', '--abbrev-ref', 'HEAD'), 'main')
  g.a.resultado({ id: g.pedidos[0].id, tipo: 'concluido', mensagem: 'Estável.' })
  assert.equal(g.a.estado().resultado.mensagem, 'Feito. Estável.')
})

test('arquivo sensível para na branch, sem checagem e sem troca', async () => {
  const r = repositorio()
  let checou = false
  const g = gerente(r, {
    agente: edita('package.json'),
    verificar: async () => ((checou = true), { ok: true }),
  })
  await g.a.acao('propor', { pedido: 'dependência' })
  await g.a.acao('confirmar')
  const e = await g.fim()
  assert.equal(e.resultado.tipo, 'revisao')
  assert.equal(checou, false)
  assert.equal(g.pedidos.length, 0)
})

test('checagem reprovada não troca nada', async () => {
  const r = repositorio()
  const g = gerente(r, {
    agente: edita('novo.txt'),
    verificar: async () => ({ ok: false, motivo: 'build quebrou' }),
  })
  await g.a.acao('propor', { pedido: 'x' })
  await g.a.acao('confirmar')
  const e = await g.fim()
  assert.equal(e.resultado.tipo, 'falhou')
  assert.equal(g.pedidos.length, 0)
})

test('cancelar interrompe o agente', async () => {
  const r = repositorio()
  const g = gerente(r, {
    agente: ({ abortController, aoProgresso }) =>
      new Promise((ok) => {
        abortController.signal.addEventListener('abort', () => ok({ ok: false, texto: '' }))
        aoProgresso('editando')
      }),
  })
  await g.a.acao('propor', { pedido: 'x' })
  await g.a.acao('confirmar')
  while (g.a.estado().etapa !== 'editando') await new Promise((ok) => setTimeout(ok, 10))
  await g.a.acao('cancelar')
  assert.equal((await g.fim()).resultado.tipo, 'cancelado')
})
