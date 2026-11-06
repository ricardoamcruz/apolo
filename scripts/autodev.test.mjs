/** Testes da diretiva de rollback e da política: `npm run test:autodev`. */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  classificar,
  comandoPermitido,
  escritaPermitida,
  gateIntacto,
  leituraPermitida,
} from '../bridge/autodev/politica.mjs'
import { branchValida, lerEntrega, nomeLivre, pedidoVago } from '../bridge/autodev/entrega.mjs'
import { criarAutodev } from '../bridge/autodev/index.mjs'
import { criarSupervisor } from './supervisor.mjs'

const esperar = async (cond) => {
  for (let i = 0; i < 400 && !cond(); i++) await new Promise((ok) => setTimeout(ok, 5))
  assert.ok(cond(), 'a condição não aconteceu a tempo')
}

const naBranch = (r) => r.git('rev-parse', '--abbrev-ref', 'HEAD')
const autodevs = (r) => r.git('for-each-ref', '--format=%(refname:short)', 'refs/heads/autodev')

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
    vigiaMs: 5,
    ...extra,
  })
  return { sup, avisos, eventos }
}

test('a alteração fica em teste, sem prazo, até alguém decidir', async () => {
  const r = repositorio()
  const { sup, avisos } = montar(r, async () => ({ ok: true, interfaces: 1 }))
  await sup.aplicar({ ...evolucao(r), interfaces: 1 })
  assert.equal(avisos[0].tipo, 'em_teste')
  await new Promise((ok) => setTimeout(ok, 60))
  assert.equal(naBranch(r), 'autodev/1')
  assert.equal(avisos.length, 1)
  await sup.reverter({ id: 'r' })
})

test('aprovar guarda em fase-x.x/nome, apaga a autodev e volta à main', async () => {
  const r = repositorio()
  const { sup, avisos } = montar(r, async () => ({ ok: true, interfaces: 0 }))
  const e = evolucao(r)
  await sup.aplicar(e)
  await sup.aprovar({ id: e.id, branch: 'fase-2.2/nova-coisa' })
  assert.equal(avisos[1].tipo, 'aprovado')
  assert.equal(avisos[1].branch, 'fase-2.2/nova-coisa')
  assert.equal(naBranch(r), 'main')
  assert.equal(r.git('rev-parse', 'fase-2.2/nova-coisa'), e.sha)
  assert.equal(autodevs(r), '')
})

test('aprovar recusa nome fora do padrão e mantém o teste', async () => {
  const r = repositorio()
  const { sup, avisos } = montar(r, async () => ({ ok: true, interfaces: 0 }))
  await sup.aplicar(evolucao(r))
  await sup.aprovar({ id: '1', branch: 'main' })
  assert.equal(avisos[1].tipo, 'recusado')
  assert.equal(naBranch(r), 'autodev/1')
  await sup.reverter({ id: 'r' })
})

test('descartar volta à main e apaga a autodev', async () => {
  const r = repositorio()
  const { sup, avisos } = montar(r, async () => ({ ok: true, interfaces: 0 }))
  await sup.aplicar(evolucao(r))
  await sup.reverter({ id: 'r' })
  assert.equal(avisos[1].tipo, 'revertido')
  assert.equal(naBranch(r), 'main')
  assert.equal(autodevs(r), '')
})

test('queda da ponte depois da observação volta à main sozinha', async () => {
  const r = repositorio()
  const { sup, avisos } = montar(r, async () => ({ ok: true, interfaces: 0 }))
  await sup.aplicar(evolucao(r))
  assert.equal(sup.ponteSaiu(1), true)
  await esperar(() => avisos.length === 2)
  assert.equal(avisos[1].tipo, 'revertido')
  assert.equal(naBranch(r), 'main')
  assert.equal(autodevs(r), '')
  assert.equal(sup.ponteSaiu(1), false)
})

test('saúde falhando durante o teste volta à main, mas uma falha isolada não', async () => {
  const r = repositorio()
  let falhas = 0
  let n = 0
  const { sup, avisos } = montar(r, async () => {
    if (naBranch(r) === 'main' || falhas === 0) return { ok: true, interfaces: 0 }
    n++
    return falhas === 1 && n % 2 ? { ok: false, motivo: 'lento' } : falhas === 1 ? { ok: true, interfaces: 0 } : { ok: false, motivo: 'caiu' }
  })
  await sup.aplicar(evolucao(r))
  falhas = 1
  await esperar(() => n > 12)
  assert.equal(naBranch(r), 'autodev/1')
  falhas = 2
  await esperar(() => avisos.length === 2)
  assert.equal(naBranch(r), 'main')
})

test('uma falha isolada na observação não derruba a versão nova', async () => {
  const r = repositorio()
  let n = 0
  const { sup, avisos } = montar(r, async () => (++n === 3 ? { ok: false } : { ok: true, interfaces: 0 }))
  await sup.aplicar(evolucao(r))
  assert.equal(avisos[0].tipo, 'em_teste')
  await sup.reverter({ id: 'r' })
})

test('o motivo do rollback fica registrado em disco', async () => {
  const r = repositorio()
  const pasta = temp()
  const { sup } = montar(r, async () => ({ ok: true, interfaces: 0 }), { pasta })
  await sup.aplicar({ ...evolucao(r), interfaces: 1 })
  assert.match(readFileSync(join(pasta, 'eventos.log'), 'utf8'), /interface não voltou/)
})

test('fora de teste, reverter e aprovar não têm o que fazer', async () => {
  const r = repositorio()
  const { sup, avisos } = montar(r, async () => ({ ok: true, interfaces: 0 }))
  await sup.reverter({ id: 'a' })
  await sup.aprovar({ id: 'b', branch: 'fase-2.2/x' })
  assert.deepEqual(avisos.map((a) => a.tipo), ['recusado', 'recusado'])
})

test('recusa alteração que tira bridge/server.mjs do gate', async () => {
  const r = repositorio()
  mkdirSync(join(r.repo, 'bridge'))
  writeFileSync(join(r.repo, 'bridge/server.mjs'), readFileSync('bridge/server.mjs'))
  r.git('add', '-A')
  r.git('commit', '-qm', 'server')
  const { sup, avisos } = montar(r, async () => ({ ok: true, interfaces: 0 }))
  await sup.aplicar(evolucao(r, 'bridge/server.mjs'))
  assert.equal(avisos[0].tipo, 'recusado')
  assert.match(avisos[0].mensagem, /gate/)
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
  assert.equal(autodevs(r), '')
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
  assert.equal(autodevs(r), '')
  assert.equal(await b.sup.recuperar(), null)
})

test('uma aprovação interrompida volta sem apagar o que foi salvo', async () => {
  const r = repositorio()
  const pasta = temp()
  const e = evolucao(r)
  r.git('branch', '-m', e.branch, 'fase-2.2/salva')
  r.git('switch', '-q', 'fase-2.2/salva')
  const b = montar(r, async () => ({ ok: true, interfaces: 0 }), { pasta })
  writeFileSync(
    join(pasta, 'transicao.json'),
    JSON.stringify({
      id: e.id,
      aprovada: true,
      de: { ref: 'main', sha: r.git('rev-parse', 'main') },
      para: { ref: 'fase-2.2/salva', sha: e.sha },
    }),
  )
  await b.sup.recuperar()
  assert.equal(naBranch(r), 'main')
  assert.equal(r.git('rev-parse', 'fase-2.2/salva'), e.sha)
})

test('npm run rollback volta direto à main e apaga a alteração', () => {
  const r = repositorio()
  const pasta = temp()
  const e = evolucao(r)
  writeFileSync(
    join(pasta, 'transicao.json'),
    JSON.stringify({ id: e.id, de: { ref: 'main', sha: r.git('rev-parse', 'main') }, para: { ref: e.branch, sha: e.sha } }),
  )
  r.git('switch', '-q', e.branch)
  const script = join(process.cwd(), 'scripts/rollback.mjs')
  execFileSync(process.execPath, [script], { cwd: r.repo, env: { ...process.env, APOLO_AUTODEV_PASTA: pasta } })
  assert.equal(naBranch(r), 'main')
  assert.equal(autodevs(r), '')
  assert.equal(existsSync(join(pasta, 'transicao.json')), false)
})

test('política classifica o que importa', () => {
  const { proibidos, sensiveis } = classificar([
    '.env.local',
    '.env.example',
    'src/App.tsx',
    'AGENTS.md',
    'bridge/server.mjs',
    'bridge/gate.mjs',
    'bridge/env.mjs',
    'scripts/start.mjs',
  ])
  assert.deepEqual(proibidos, ['.env.local'])
  assert.deepEqual(sensiveis, ['bridge/gate.mjs', 'bridge/env.mjs', 'scripts/start.mjs'])
})

test('gateIntacto reconhece o server.mjs atual e percebe o gate removido', () => {
  const codigo = readFileSync('bridge/server.mjs', 'utf8')
  assert.equal(gateIntacto(codigo), true)
  assert.equal(gateIntacto(codigo.replace('canUseTool: podeUsarFerramenta,', "canUseTool: async () => ({ behavior: 'allow' }),")), false)
})

test('entrega: lê branch e commit do agente, com alternativa segura', () => {
  const e = lerEntrega('Mudei a tela.\nBRANCH: fase-2.2/nova-tela\nCOMMIT: Troca a cor da tela', 'trocar a cor')
  assert.deepEqual(e, { resumo: 'Mudei a tela.', branch: 'fase-2.2/nova-tela', titulo: 'Troca a cor da tela' })
  const sem = lerEntrega('Feito.\nBRANCH: ../main', 'Remover a Ação Rápida da tela inicial agora')
  assert.equal(sem.branch, 'fase-2.2/remover-a-acao-rapida-da')
  assert.equal(sem.titulo, 'Remover a Ação Rápida da tela inicial agora')
  assert.equal(branchValida('main'), false)
  assert.equal(branchValida('autodev/1'), false)
})

test('nomeLivre não reaproveita uma branch existente', async () => {
  const existentes = new Set(['fase-2.2/x', 'fase-2.2/x-2'])
  assert.equal(await nomeLivre('fase-2.2/x', async (n) => existentes.has(n)), 'fase-2.2/x-3')
})

test('pedidoVago pega confirmação disfarçada de pedido, e só ela', () => {
  for (const t of ['confirmo', 'Confirmo.', 'tente novamente', 'pode fazer!', 'faça']) assert.equal(pedidoVago(t), true, t)
  for (const t of ['confirme antes de apagar o histórico', 'remover a aba Signal']) assert.equal(pedidoVago(t), false, t)
})

/**
 * Em ESM o módulo importado roda antes do corpo de quem importa. Se qualquer
 * import vier antes do env.mjs, APOLO_AUTODEV_* e JARVIS_MODEL voltam a ser
 * lidos com o .env.local ainda fora da memória — e silenciosamente ignorados.
 */
test('o .env.local é lido antes de tudo em quem lê configuração', () => {
  const raiz = new URL('../', import.meta.url)
  const pontos = [
    ['bridge/server.mjs', "import './env.mjs'"],
    ['scripts/start.mjs', "import '../bridge/env.mjs'"],
    ['scripts/rollback.mjs', "import '../bridge/env.mjs'"],
  ]
  for (const [arquivo, esperado] of pontos) {
    const fonte = readFileSync(new URL(arquivo, raiz), 'utf8')
    const primeiro = fonte.match(/^import .*$/m)?.[0]
    assert.equal(primeiro, esperado, `o primeiro import de ${arquivo}`)
  }
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
function gerente(r, { agente, verificar = async () => ({ ok: true }), ...extra } = {}) {
  const pedidos = []
  const estados = []
  const pasta = temp()
  const a = criarAutodev({
    repo: r.repo,
    ligado: true,
    pasta,
    supervisor: (m) => pedidos.push(m),
    avisar: (e) => estados.push(e),
    agente,
    verificar,
    abrirEditor: () => {},
    fecharEditor: () => {},
    ...extra,
  })
  const fim = async () => {
    await new Promise((ok) => setTimeout(ok, 0))
    for (let i = 0; i < 400 && !['ocioso', 'aplicando'].includes(a.estado().fase); i++) {
      await new Promise((ok) => setTimeout(ok, 10))
    }
    return a.estado()
  }
  return { a, pedidos, estados, fim, pasta }
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

test('ciclo completo: teste, aprovação e branch definitiva, sem tocar a main', async () => {
  const r = repositorio()
  const agente = async ({ pasta }) => {
    writeFileSync(join(pasta, 'novo.txt'), 'novo\n')
    return { ok: true, texto: 'Criei o arquivo.\nBRANCH: fase-2.2/arquivo-novo\nCOMMIT: Cria o arquivo novo' }
  }
  const g = gerente(r, { agente })
  const antes = r.git('rev-parse', 'main')
  await g.a.acao('propor', { pedido: 'criar novo' })
  await g.a.acao('confirmar')
  assert.equal((await g.fim()).fase, 'aplicando')
  const { id, branch, sha } = g.pedidos[0]
  assert.equal(g.pedidos[0].type, 'autodev:aplicar')
  assert.equal(r.git('rev-parse', branch), sha)
  assert.equal(r.git('log', '-1', '--format=%s', sha), 'Cria o arquivo novo')
  assert.equal(r.git('rev-parse', 'main'), antes)
  assert.equal(naBranch(r), 'main')
  assert.equal(r.git('worktree', 'list').split('\n').length, 1)

  writeFileSync(join(g.pasta, 'transicao.json'), '{}')
  g.a.resultado({ id, tipo: 'em_teste', mensagem: 'No ar.' })
  assert.equal(g.a.estado().fase, 'testando')
  assert.equal((await g.a.acao('propor', { pedido: 'outra coisa' })).ok, false)

  assert.equal((await g.a.acao('aprovar')).ok, true)
  assert.deepEqual(g.pedidos[1], { type: 'autodev:aprovar', id, branch: 'fase-2.2/arquivo-novo' })
  g.a.resultado({ id, tipo: 'aprovado', mensagem: 'Guardei.', branch: 'fase-2.2/arquivo-novo' })
  const e = g.a.estado()
  assert.equal(e.fase, 'ocioso')
  assert.equal(e.resultado.mensagem, 'Criei o arquivo. Guardei.')
  assert.equal(e.resultado.branch, 'fase-2.2/arquivo-novo')
})

test('descartar pela interface passa pelo supervisor', async () => {
  const r = repositorio()
  const g = gerente(r, { agente: edita('novo.txt') })
  await g.a.acao('propor', { pedido: 'criar' })
  await g.a.acao('confirmar')
  await g.fim()
  assert.equal((await g.a.acao('aprovar')).ok, false)
  g.a.resultado({ id: g.pedidos[0].id, tipo: 'em_teste', mensagem: 'No ar.' })
  await g.a.acao('reverter')
  assert.equal(g.pedidos[1].type, 'autodev:reverter')
})

test('recusar a aprovação mantém a alteração em teste', async () => {
  const r = repositorio()
  const g = gerente(r, { agente: edita('novo.txt') })
  await g.a.acao('propor', { pedido: 'criar' })
  await g.a.acao('confirmar')
  await g.fim()
  const { id } = g.pedidos[0]
  writeFileSync(join(g.pasta, 'transicao.json'), '{}')
  g.a.resultado({ id, tipo: 'em_teste', mensagem: 'No ar.' })
  await g.a.acao('aprovar')
  g.a.resultado({ id, tipo: 'recusado', mensagem: 'Há alterações.' })
  assert.equal(g.a.estado().fase, 'testando')
  assert.equal(g.a.estado().resultado.mensagem, 'Há alterações.')
})

test('a voz não consegue transformar "confirmo" em pedido', async () => {
  const r = repositorio()
  let rodou = false
  const g = gerente(r, { agente: async () => ((rodou = true), { ok: true, texto: '' }) })
  assert.equal((await g.a.acao('propor', { pedido: 'confirmo' })).ok, false)
  await g.a.acao('propor', { pedido: 'mudar a cor' })
  const r2 = await g.a.acao('propor', { pedido: 'outra proposta' })
  assert.equal(r2.ok, false)
  assert.equal(g.a.estado().pedido, 'mudar a cor')
  assert.equal(rodou, false)
})

test('só trabalha a partir da main, sem alterações pendentes', async () => {
  const r = repositorio()
  r.git('switch', '-qc', 'fase-2.2/outra')
  const g = gerente(r, { agente: edita('novo.txt') })
  await g.a.acao('propor', { pedido: 'criar' })
  const resposta = await g.a.acao('confirmar')
  assert.equal(resposta.ok, false)
  assert.match(resposta.mensagem, /main/)
})

test('a partida limpa o que uma execução interrompida deixou', async () => {
  const r = repositorio()
  r.git('branch', 'autodev/antiga')
  let fechou = false
  const g = gerente(r, { fecharEditor: () => (fechou = true) })
  await g.a.pronto
  assert.equal(autodevs(r), '')
  assert.equal(fechou, true)
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
  assert.equal(e.resultado.branch, 'fase-2.2/dependencia')
  assert.equal(checou, false)
  assert.equal(g.pedidos.length, 0)
  assert.equal(autodevs(r), '')
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
  assert.equal(autodevs(r), '')
  assert.equal(r.git('worktree', 'list').split('\n').length, 1)
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

test('um cancelamento que chega como erro continua sendo cancelamento', async () => {
  const r = repositorio()
  const g = gerente(r, {
    agente: ({ abortController, aoProgresso }) =>
      new Promise((_, falha) => {
        abortController.signal.addEventListener('abort', () => falha(new Error('process aborted by user')))
        aoProgresso('editando')
      }),
  })
  await g.a.acao('propor', { pedido: 'x' })
  await g.a.acao('confirmar')
  while (g.a.estado().etapa !== 'editando') await new Promise((ok) => setTimeout(ok, 10))
  await g.a.acao('cancelar')
  assert.equal((await g.fim()).resultado.tipo, 'cancelado')
})
