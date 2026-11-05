/** Testes do sub-módulo git (RF-17): `npm run test:git`. */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { branchValida, criarGit, repositorioGithub } from '../bridge/git.mjs'

const temp = () => realpathSync(mkdtempSync(join(tmpdir(), 'apolo-git-')))

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

/** Um origin de verdade, em disco: dá para empurrar sem rede nenhuma. */
function origem(r) {
  const caminho = join(temp(), 'origin.git')
  execFileSync('git', ['init', '-q', '--bare', caminho])
  r.git('remote', 'add', 'origin', caminho)
  return caminho
}

const sujar = (r, arquivo = 'app.txt') => writeFileSync(join(r.repo, arquivo), 'v2\n')

const montar = (r, extra = {}) =>
  criarGit({ repo: r.repo, criarPr: async () => ({ ok: true, url: 'https://x/pr/1' }), ...extra })

test('nome de branch: só o que é seguro na linha de comando', () => {
  for (const ok of ['main', 'autodev/20261105', 'arrumar-a-voz', 'v1.2_x']) {
    assert.equal(branchValida(ok), true, ok)
  }
  for (const nao of ['-rf', 'a..b', 'a//b', 'x/', 'x.', 'x.lock', '', 'a b', 'a;b', 'a$b']) {
    assert.equal(branchValida(nao), false, nao)
  }
})

test('status conta o pendente, as branches à espera e o que falta para o pull request', async () => {
  const r = repositorio()
  r.git('switch', '-qc', 'autodev/1')
  writeFileSync(join(r.repo, 'novo.txt'), 'x\n')
  r.git('add', '-A')
  r.git('commit', '-qm', 'v2')
  r.git('switch', '-q', 'main')
  sujar(r)

  const { texto } = await montar(r).status()
  assert.match(texto, /Branch atual: main/)
  assert.match(texto, /nada é commitado nela direto/)
  assert.match(texto, /Alterações não commitadas: 1/)
  assert.match(texto, /autodev\/1 \(1 commit\)/)
  assert.match(texto, /Remoto origin: ausente/)
})

test('nada é commitado na main direto', async () => {
  const r = repositorio()
  sujar(r)
  const g = montar(r)
  const recusa = await g.commit({ message: 'mudar' })
  assert.equal(recusa.ok, false)
  assert.match(recusa.texto, /branch nova/)
  assert.equal(r.git('rev-list', '--count', 'main'), '1')
})

test('commit numa branch nova, sem tocar a main', async () => {
  const r = repositorio()
  sujar(r)
  const antes = r.git('rev-parse', 'main')
  const feito = await montar(r).commit({ message: 'arrumar o app', branch: 'apolo/1' })
  assert.equal(feito.ok, true)
  assert.match(feito.texto, /branch apolo\/1/)
  assert.equal(r.git('rev-parse', '--abbrev-ref', 'HEAD'), 'apolo/1')
  assert.equal(r.git('rev-parse', 'main'), antes)
  assert.equal(r.git('log', '-1', '--format=%s'), 'arrumar o app')
  assert.equal(r.git('status', '--porcelain'), '')
})

test('o commit avisa quando toca arquivo sensível', async () => {
  const r = repositorio()
  writeFileSync(join(r.repo, 'package.json'), '{}\n')
  const feito = await montar(r).commit({ message: 'dependência', branch: 'apolo/2' })
  assert.equal(feito.ok, true)
  assert.match(feito.texto, /sensíveis/)
})

test('segredo derruba o commit inteiro, sem deixar nada no índice', async () => {
  const r = repositorio()
  sujar(r)
  writeFileSync(join(r.repo, '.env.local'), 'GEMINI_API_KEY=x\n')
  const recusa = await montar(r).commit({ message: 'tudo', branch: 'apolo/3' })
  assert.equal(recusa.ok, false)
  assert.match(recusa.texto, /\.env\.local/)
  assert.equal(r.git('diff', '--cached', '--name-only'), '')
  assert.equal(r.git('rev-list', '--count', 'HEAD'), '1')
})

test('commit sem nada pendente, sem mensagem ou em branch que já existe: recusado', async () => {
  const r = repositorio()
  const g = montar(r)
  assert.equal((await g.commit({ message: 'x' })).ok, false)
  sujar(r)
  assert.equal((await g.commit({ message: '  ' })).ok, false)
  assert.equal((await g.commit({ message: 'x', branch: 'main' })).ok, false)
  r.git('branch', 'apolo/4')
  const recusa = await g.commit({ message: 'x', branch: 'apolo/4' })
  assert.equal(recusa.ok, false)
  assert.match(recusa.texto, /já existe/)
})

test('pull request empurra a branch e devolve o endereço', async () => {
  const r = repositorio()
  const bare = origem(r)
  sujar(r)
  await montar(r).commit({ message: 'v2', branch: 'apolo/5' })
  const pedidos = []
  const g = montar(r, {
    criarPr: async (p) => (pedidos.push(p), { ok: true, url: 'https://github.com/x/pull/7' }),
  })
  const pr = await g.pullRequest({ title: 'Arrumar o app' })
  assert.equal(pr.ok, true)
  assert.match(pr.texto, /pull\/7/)
  assert.match(pr.texto, /merge é revisão do Ricardo/)
  assert.equal(pedidos[0].branch, 'apolo/5')
  assert.match(pedidos[0].corpo, /- v2/)
  assert.equal(
    execFileSync('git', ['rev-parse', 'apolo/5'], { cwd: bare, encoding: 'utf8' }).trim(),
    r.git('rev-parse', 'HEAD'),
  )
})

test('sem GitHub CLI, a branch vai e o pull request fica para a mão', async () => {
  const r = repositorio()
  origem(r)
  sujar(r)
  await montar(r).commit({ message: 'v2', branch: 'apolo/6' })
  const g = montar(r, { criarPr: async () => ({ ok: false, semGh: true }) })
  const pr = await g.pullRequest({ title: 'Arrumar o app' })
  assert.equal(pr.ok, true)
  assert.match(pr.texto, /à mão/)
})

test('sem remoto, a branch fica local e o pedido é recusado com o motivo', async () => {
  const r = repositorio()
  sujar(r)
  await montar(r).commit({ message: 'v2', branch: 'apolo/7' })
  const pr = await montar(r).pullRequest({ title: 'Arrumar o app' })
  assert.equal(pr.ok, false)
  assert.match(pr.texto, /origin/)
  assert.match(pr.texto, /revisá-la localmente/)
})

test('pull request da main, de branch inexistente ou sem commit: recusado', async () => {
  const r = repositorio()
  origem(r)
  const g = montar(r)
  assert.equal((await g.pullRequest({ title: 't' })).ok, false)
  assert.equal((await g.pullRequest({ title: 't', branch: 'main' })).ok, false)
  assert.equal((await g.pullRequest({ title: 't', branch: 'nao-existe' })).ok, false)
  assert.equal((await g.pullRequest({ title: '', branch: 'apolo/8' })).ok, false)
  r.git('branch', 'apolo/8')
  const recusa = await g.pullRequest({ title: 't', branch: 'apolo/8' })
  assert.equal(recusa.ok, false)
  assert.match(recusa.texto, /à frente da main/)
})

test('durante um trabalho do autodesenvolvimento, nada escreve', async () => {
  const r = repositorio()
  sujar(r)
  const g = montar(r, { ocupado: () => 'o autodesenvolvimento está no meio de um trabalho' })
  assert.equal((await g.commit({ message: 'x', branch: 'apolo/9' })).ok, false)
  assert.equal((await g.pullRequest({ title: 't', branch: 'main' })).ok, false)
  assert.equal((await g.status()).ok, true)
})

test('diff mostra o pendente e o que uma branch tem à frente da main', async () => {
  const r = repositorio()
  const g = montar(r)
  assert.match((await g.diff()).texto, /está limpa/)
  sujar(r)
  assert.match((await g.diff()).texto, /app\.txt/)
  await g.commit({ message: 'v2', branch: 'apolo/10' })
  const d = await g.diff({ branch: 'apolo/10' })
  assert.match(d.texto, /Commits em apolo\/10/)
  assert.match(d.texto, /v2/)
  assert.equal((await g.diff({ branch: 'nao-existe' })).ok, false)
})

/**
 * O requisito é explícito: o merge continua sendo do Ricardo. Isso não é só uma
 * frase da persona — não existe caminho no código que junte nada nem reescreva
 * o que já foi enviado.
 */
test('não existe merge nem force neste sub-módulo', () => {
  const fonte = readFileSync(new URL('../bridge/git.mjs', import.meta.url), 'utf8')
  for (const proibido of ["'merge'", "'--force'", "'rebase'", "'reset', '--hard'"]) {
    assert.equal(fonte.includes(proibido), false, proibido)
  }
})

test('o pull request vai para o origin, nomeado pela URL do GitHub', () => {
  assert.equal(repositorioGithub('https://github.com/ricardoamcruz/apolo.git'), 'ricardoamcruz/apolo')
  assert.equal(repositorioGithub('git@github.com:ricardoamcruz/apolo.git\n'), 'ricardoamcruz/apolo')
  assert.equal(repositorioGithub('https://gitlab.com/ricardoamcruz/apolo.git'), null)
  assert.equal(repositorioGithub(''), null)
})
