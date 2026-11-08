/** Testes da diretiva de rollback e da política: `npm run test:autodev`. */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
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
import { historicoDeBranches, proximaFase } from '../bridge/branches.mjs'
import { foraDeHora, ouviuConfirmacao, pareceConfirmacao, registrarFala } from '../src/lib/autodev.ts'

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

test('política classifica o que importa', () => {
  const { proibidos, sensiveis } = classificar([
    '.env.local',
    '.env.example',
    'src/App.tsx',
    'AGENTS.md',
    'bridge/server.mjs',
    'bridge/gate.mjs',
    'bridge/env.mjs',
    'scripts/preparar.mjs',
    'fenix/src/versoes.mjs',
    'fenix.config.json',
    'bridge/fenix.mjs',
  ])
  assert.deepEqual(proibidos, ['.env.local'])
  assert.deepEqual(sensiveis, [
    'bridge/gate.mjs',
    'bridge/env.mjs',
    'scripts/preparar.mjs',
    'fenix/src/versoes.mjs',
    'fenix.config.json',
    'bridge/fenix.mjs',
  ])
})

test('gateIntacto reconhece o server.mjs atual e percebe o gate removido', () => {
  const codigo = readFileSync('bridge/server.mjs', 'utf8')
  assert.equal(gateIntacto(codigo), true)
  assert.equal(gateIntacto(codigo.replace('canUseTool: podeUsarFerramenta,', "canUseTool: async () => ({ behavior: 'allow' }),")), false)
})

test('entrega: lê branch e commit do agente, com alternativa segura', () => {
  const e = lerEntrega('Mudei a tela.\nBRANCH: nova-tela\nCOMMIT: Troca a cor da tela', 'trocar a cor')
  assert.deepEqual(e, { resumo: 'Mudei a tela.', branch: 'nova-tela', titulo: 'Troca a cor da tela' })
  const sem = lerEntrega('Feito.\nBRANCH: ../main', 'Remover a Ação Rápida da tela inicial agora')
  assert.equal(sem.branch, 'remover-a-acao-rapida-da')
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
    ['scripts/preparar.mjs', "import '../bridge/env.mjs'"],
    ['scripts/iphone.mjs', "import '../bridge/env.mjs'"],
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
    return { ok: true, texto: 'Criei o arquivo.\nBRANCH: arquivo-novo\nCOMMIT: Cria o arquivo novo' }
  }
  const g = gerente(r, { agente })
  const antes = r.git('rev-parse', 'main')
  await g.a.acao('propor', { pedido: 'criar novo' })
  await g.a.acao('confirmar')
  assert.equal((await g.fim()).fase, 'aplicando')
  const { id, branch, sha } = g.pedidos[0]
  assert.equal(g.pedidos[0].type, 'versao:aplicar')
  assert.equal(r.git('rev-parse', branch), sha)
  assert.equal(r.git('log', '-1', '--format=%s', sha), 'Cria o arquivo novo')
  assert.equal(r.git('rev-parse', 'main'), antes)
  assert.equal(naBranch(r), 'main')
  assert.equal(r.git('worktree', 'list').split('\n').length, 1)

  g.a.resultado({ id, tipo: 'em_teste', mensagem: 'No ar.' })
  assert.equal(g.a.estado().fase, 'testando')
  assert.equal((await g.a.acao('propor', { pedido: 'outra coisa' })).ok, false)

  assert.equal((await g.a.acao('aprovar')).ok, true)
  assert.deepEqual(g.pedidos[1], { type: 'versao:aprovar', id, branch: 'fase-2/arquivo-novo' })
  g.a.resultado({ id, tipo: 'aprovado', mensagem: 'Guardei.', branch: 'fase-2/arquivo-novo' })
  const e = g.a.estado()
  assert.equal(e.fase, 'ocioso')
  assert.equal(e.resultado.mensagem, 'Criei o arquivo. Guardei.')
  assert.equal(e.resultado.branch, 'fase-2/arquivo-novo')
})

test('descartar pela interface passa pela F.Ê.N.I.X.', async () => {
  const r = repositorio()
  const g = gerente(r, { agente: edita('novo.txt') })
  await g.a.acao('propor', { pedido: 'criar' })
  await g.a.acao('confirmar')
  await g.fim()
  assert.equal((await g.a.acao('aprovar')).ok, false)
  g.a.resultado({ id: g.pedidos[0].id, tipo: 'em_teste', mensagem: 'No ar.' })
  await g.a.acao('reverter')
  assert.equal(g.pedidos[1].type, 'versao:reverter')
})

test('recusar a aprovação mantém a alteração em teste', async () => {
  const r = repositorio()
  const g = gerente(r, { agente: edita('novo.txt') })
  await g.a.acao('propor', { pedido: 'criar' })
  await g.a.acao('confirmar')
  await g.fim()
  const { id } = g.pedidos[0]
  g.a.resultado({ id, tipo: 'em_teste', mensagem: 'No ar.' })
  await g.a.acao('aprovar')
  // A Fênix diz, junto do resultado, que a alteração continua no ar.
  g.a.resultado({ id, tipo: 'recusado', mensagem: 'Há alterações.', versao: { troca: 'testando' } })
  assert.equal(g.a.estado().fase, 'testando')
  assert.equal(g.a.estado().resultado.mensagem, 'Há alterações.')
})

test('depois de aprovar, o pull request só sai com --writes, uma vez, com o título do commit', async () => {
  const r = repositorio()
  const pedidos = []
  const agente = async ({ pasta }) => {
    writeFileSync(join(pasta, 'novo.txt'), 'novo\n')
    return { ok: true, texto: 'Feito.\nBRANCH: arquivo-novo\nCOMMIT: Cria o arquivo novo' }
  }
  const semWrites = gerente(repositorio(), { agente })
  assert.match((await semWrites.a.acao('pull_request')).mensagem, /--writes/)

  const g = gerente(r, {
    agente,
    abrirPr: async (p) => (pedidos.push(p), { ok: true, texto: 'Pull request aberto: https://github.com/x/y/pull/11.' }),
  })
  assert.equal((await g.a.acao('pull_request')).ok, false, 'sem alteração aprovada, não há PR')
  await g.a.acao('propor', { pedido: 'criar novo' })
  await g.a.acao('confirmar')
  await g.fim()
  const { id } = g.pedidos[0]
  g.a.resultado({ id, tipo: 'em_teste', mensagem: 'No ar.' })
  await g.a.acao('aprovar')
  g.a.resultado({ id, tipo: 'aprovado', mensagem: 'Guardei.', branch: 'fase-2/arquivo-novo' })
  assert.equal(g.a.estado().resultado.titulo, 'Cria o arquivo novo')

  const pr = await g.a.acao('pull_request')
  assert.equal(pr.ok, true)
  assert.deepEqual(pedidos, [{ title: 'Cria o arquivo novo', branch: 'fase-2/arquivo-novo' }])
  assert.equal(g.a.estado().resultado.pr, 'https://github.com/x/y/pull/11')
  assert.match((await g.a.acao('pull_request')).mensagem, /já foi aberto/)
  assert.equal(pedidos.length, 1)
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

test('se a Fênix volta sem nada em teste, a alteração que estava no ar acabou', async () => {
  const r = repositorio()
  const g = gerente(r, { agente: edita('novo.txt') })
  await g.a.acao('propor', { pedido: 'criar' })
  await g.a.acao('confirmar')
  await g.fim()
  g.a.resultado({ id: g.pedidos[0].id, tipo: 'em_teste', mensagem: 'No ar.' })
  g.a.sincronizar({ troca: 'testando' })
  assert.equal(g.a.estado().fase, 'testando')
  g.a.sincronizar({ troca: null })
  assert.equal(g.a.estado().fase, 'ocioso')
  assert.equal(g.a.estado().resultado.tipo, 'revertido')
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
  assert.equal(e.resultado.branch, 'fase-2/dependencia')
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

test('confirmar sem proposta explica a causa em vez de pedir um botão que não existe', () => {
  const ocioso = foraDeHora('confirmar', { ligado: true, fase: 'ocioso' })
  assert.match(ocioso, /Não há proposta/)
  assert.match(ocioso, /propor/)
  assert.doesNotMatch(ocioso, /não foi ouvida/)
  assert.match(foraDeHora('confirmar', { ligado: false, fase: 'ocioso' }), /desligado/)
  assert.match(foraDeHora('confirmar', null), /desligado/)
  assert.match(foraDeHora('confirmar', { ligado: true, fase: 'testando' }), /aprovar/)
  assert.match(foraDeHora('confirmar', { ligado: true, fase: 'trabalhando' }), /andamento/)
  assert.match(foraDeHora('aprovar', { ligado: true, fase: 'ocioso' }), /em teste/)
})

test('com proposta ou alteração em teste, a fala continua sendo conferida', () => {
  assert.equal(foraDeHora('confirmar', { ligado: true, fase: 'proposto' }), null)
  assert.equal(foraDeHora('aprovar', { ligado: true, fase: 'testando' }), null)
})

test('"para" como preposição não anula a confirmação, mas sozinho nega', () => {
  for (const f of ['confirmo', 'sim, pode mandar para a branch', 'confirmo, pode fazer para mim']) {
    assert.equal(pareceConfirmacao(f), true, f)
  }
  for (const f of ['para, não faça', 'para, pode parar', 'confirmo... para!', 'não confirmo', 'pode cancelar']) {
    assert.equal(pareceConfirmacao(f), false, f)
  }
})

test('a transcrição que chega depois da chamada ainda vale, dentro da espera', async () => {
  const desde = Date.now() - 1000
  registrarFala('')
  setTimeout(() => registrarFala('confirmo'), 400)
  assert.equal(await ouviuConfirmacao(desde, 1000), true)
})

test('fala anterior à proposta não confirma', async () => {
  registrarFala('confirmo')
  await new Promise((ok) => setTimeout(ok, 5))
  assert.equal(await ouviuConfirmacao(Date.now(), 200), false)
})

test('cada branch nova soma 0.1 à maior já usada', () => {
  assert.equal(proximaFase('fase-2.2/a\nfase-2.3/voz-e-verniz\norigin/fase-1/b', ''), '2.4')
  assert.equal(proximaFase('fase-2/a', ''), '2.1')
  assert.equal(proximaFase('fase-2.9/a', ''), '2.10')
  assert.equal(proximaFase('fase-3/a\nfase-2.9/b', ''), '3.1')
})

test('branch apagada depois do merge continua contando', () => {
  assert.equal(proximaFase('main\nMerge pull request #7 from ricardoamcruz/fase-2.5/x', ''), '2.6')
})

test('só o Ricardo muda de fase: fase-x e depois fase-x.1', () => {
  assert.equal(proximaFase('fase-2.5/a', '3'), '3')
  assert.equal(proximaFase('fase-2.5/a\nfase-3/b', '3'), '3.1')
  assert.equal(proximaFase('fase-2.5/a', '2.2'), '2.6')
  assert.equal(proximaFase('', ''), '2')
})

test('o número mandado pelo agente é ignorado: vale só o nome', () => {
  assert.equal(lerEntrega('Feito.\nBRANCH: fase-9.9/voz-e-verniz', 'x').branch, 'voz-e-verniz')
})

test('a conta lê branches locais e merges, e sobrevive a um git que falha', async () => {
  const r = repositorio()
  r.git('branch', 'fase-2.7/antiga')
  const rodar = async (args) => r.git(...args)
  assert.equal(proximaFase(await historicoDeBranches(rodar, 'main'), ''), '2.8')
  assert.equal(await historicoDeBranches(() => Promise.reject(new Error('x')), 'main'), '\n')
})

test('o autodev numera a branch pela maior já usada', async () => {
  const r = repositorio()
  r.git('branch', 'fase-2.7/antiga')
  const g = gerente(r, { agente: edita('package.json') })
  await g.a.acao('propor', { pedido: 'dependência' })
  await g.a.acao('confirmar')
  assert.equal((await g.fim()).resultado.branch, 'fase-2.8/dependencia')
})
