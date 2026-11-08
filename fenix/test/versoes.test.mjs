/**
 * Testes das versões da F.Ê.N.I.X.: troca, teste, aprovação e rollback, com
 * serviços de mentira e um repositório Git de verdade.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { criarVersoes } from '../src/versoes.mjs'

/** O que um projeto declararia no fenix.config.json. */
const PROTECAO = {
  revisao: [/^package\.json$/, /(^|\/)\.env(\.[^/]*)?$/],
  liberados: new Set(['.env.example']),
  invariantes: [{ arquivo: 'servidor.mjs', contem: [/usarGate\(\)/] }],
  branch: /^fase-\d+(\.\d+)*\/[a-z0-9]+(-[a-z0-9]+)*$/,
}

const esperar = async (cond) => {
  for (let i = 0; i < 400 && !cond(); i++) await new Promise((ok) => setTimeout(ok, 5))
  assert.ok(cond(), 'a condição não aconteceu a tempo')
}

const naBranch = (r) => r.git('rev-parse', '--abbrev-ref', 'HEAD')
const autodevs = (r) => r.git('for-each-ref', '--format=%(refname:short)', 'refs/heads/autodev')

const temp = () => realpathSync(mkdtempSync(join(tmpdir(), 'fenix-versoes-')))

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
  const sup = criarVersoes({
    repo: r.repo,
    pasta: temp(),
    ligar: () => eventos.push(`ligar:${r.git('rev-parse', '--abbrev-ref', 'HEAD')}`),
    desligar: async () => eventos.push('desligar'),
    saude,
    protecao: PROTECAO,
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

test('queda do serviço depois da observação volta à main sozinha', async () => {
  const r = repositorio()
  const { sup, avisos } = montar(r, async () => ({ ok: true, interfaces: 0 }))
  await sup.aplicar(evolucao(r))
  assert.equal(sup.servicoCaiu('ponte', 'encerrou (1)'), true)
  await esperar(() => avisos.length === 2)
  assert.equal(avisos[1].tipo, 'revertido')
  assert.equal(naBranch(r), 'main')
  assert.equal(autodevs(r), '')
  assert.equal(sup.servicoCaiu('ponte', 'encerrou (1)'), false)
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

test('recusa alteração que quebra uma invariante do projeto', async () => {
  const r = repositorio()
  writeFileSync(join(r.repo, 'servidor.mjs'), 'usarGate()\n')
  r.git('add', '-A')
  r.git('commit', '-qm', 'servidor')
  const { sup, avisos, eventos } = montar(r, async () => ({ ok: true, interfaces: 0 }))
  await sup.aplicar(evolucao(r, 'servidor.mjs'))
  assert.equal(avisos[0].tipo, 'recusado')
  assert.match(avisos[0].mensagem, /servidor\.mjs/)
  assert.deepEqual(eventos, [])
})

test('a invariante mantida deixa a alteração seguir', async () => {
  const r = repositorio()
  writeFileSync(join(r.repo, 'servidor.mjs'), 'usarGate()\n')
  r.git('add', '-A')
  r.git('commit', '-qm', 'servidor')
  r.git('switch', '-qc', 'autodev/1')
  writeFileSync(join(r.repo, 'servidor.mjs'), 'usarGate()\nmaisCoisa()\n')
  r.git('add', '-A')
  r.git('commit', '-qm', 'v2')
  const sha = r.git('rev-parse', 'HEAD')
  r.git('switch', '-q', 'main')
  const { sup, avisos } = montar(r, async () => ({ ok: true, interfaces: 0 }))
  await sup.aplicar({ id: '1', sha, branch: 'autodev/1' })
  assert.equal(avisos[0].tipo, 'em_teste')
})

test('o .env.example liberado não barra a troca', async () => {
  const r = repositorio()
  const { sup, avisos } = montar(r, async () => ({ ok: true, interfaces: 0 }))
  await sup.aplicar(evolucao(r, '.env.example'))
  assert.equal(avisos[0].tipo, 'em_teste')
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
    ctx.sup.servicoCaiu('ponte', 'encerrou (1)')
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

test('recusa arquivo protegido mesmo que o projeto peça', async () => {
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

test('fenix rollback volta direto à main e apaga a alteração', () => {
  const r = repositorio()
  const pasta = temp()
  const e = evolucao(r)
  writeFileSync(
    join(pasta, 'transicao.json'),
    JSON.stringify({ id: e.id, de: { ref: 'main', sha: r.git('rev-parse', 'main') }, para: { ref: e.branch, sha: e.sha } }),
  )
  r.git('switch', '-q', e.branch)
  const config = join(temp(), 'fenix.config.json')
  writeFileSync(
    config,
    JSON.stringify({ repositorio: r.repo, pasta, servicos: [{ nome: 'app', comando: ['node', 'app.mjs'] }] }),
  )
  const fenix = fileURLToPath(new URL('../fenix.mjs', import.meta.url))
  execFileSync(process.execPath, [fenix, 'rollback', '--config', config], { cwd: r.repo, stdio: 'ignore' })
  assert.equal(naBranch(r), 'main')
  assert.equal(autodevs(r), '')
  assert.equal(existsSync(join(pasta, 'transicao.json')), false)
})
