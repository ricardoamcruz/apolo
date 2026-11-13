/**
 * Testes da atualização e da troca de branch da F.Ê.N.I.X. (docs/adr/0029): cada
 * etapa conferida, toda falha com o motivo exato, e a cópia nunca no meio.
 * Repositórios Git de verdade, com um remoto local, e serviços de mentira.
 */
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { criarVersoes, erroDoGit } from '../src/versoes.mjs'

const PROTECAO = { revisao: [], liberados: new Set(), invariantes: [], branch: /^fase-\d+(\.\d+)*\/[a-z0-9-]+$/ }
const temp = () => realpathSync(mkdtempSync(join(tmpdir(), 'fenix-atualizar-')))
const rodarGit = (cwd) => (...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const identidade = (git) => {
  git('config', 'user.email', 'teste@apolo.local')
  git('config', 'user.name', 'Teste')
}

/** Uma cópia em execução na main, acompanhando um remoto, e um colega que publica nele. */
function comRemoto() {
  const raiz = temp()
  const remoto = join(raiz, 'remoto.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remoto])
  const repo = join(raiz, 'copia')
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  const git = rodarGit(repo)
  identidade(git)
  writeFileSync(join(repo, 'app.txt'), 'v1\n')
  git('add', '-A')
  git('commit', '-qm', 'v1')
  git('remote', 'add', 'origin', remoto)
  git('push', '-q', '-u', 'origin', 'main')
  const colega = join(raiz, 'colega')
  execFileSync('git', ['clone', '-q', remoto, colega], { stdio: 'ignore' })
  const gitColega = rodarGit(colega)
  identidade(gitColega)
  /** O colega publica uma versão nova na main do remoto. */
  const publicar = (arquivo = 'app.txt', conteudo = 'v2\n') => {
    writeFileSync(join(colega, arquivo), conteudo)
    gitColega('add', '-A')
    gitColega('commit', '-qm', `muda ${arquivo}`)
    gitColega('push', '-q', 'origin', 'main')
    return gitColega('rev-parse', 'HEAD')
  }
  return { raiz, repo, git, remoto, publicar, gitColega }
}

function montar(r, { saude = async () => ({ ok: true, interfaces: 0 }), ...extra } = {}) {
  const eventos = []
  const avisos = []
  const versoes = criarVersoes({
    repo: r.repo,
    pasta: temp(),
    ligar: () => eventos.push('ligar'),
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
  return { versoes, eventos, avisos }
}

test('atualizar busca o remoto, avança a main, confere o commit e religa', async () => {
  const r = comRemoto()
  const novo = r.publicar()
  const { versoes, eventos } = montar(r)
  const res = await versoes.atualizar()
  assert.equal(res.ok, true, res.mensagem)
  assert.match(res.mensagem, /Atualizei de \w{7} para \w{7}, 1 arquivos/)
  assert.equal(r.git('rev-parse', 'HEAD'), novo)
  assert.deepEqual(eventos, ['desligar', 'ligar'])
  assert.deepEqual(await versoes.atualizar(), { ok: true, mensagem: 'Já estava na versão mais nova.' })
})

test('um arquivo não rastreado que não colide não barra a atualização', async () => {
  const r = comRemoto()
  r.publicar()
  writeFileSync(join(r.repo, 'anotacao-local.txt'), 'meu\n')
  const res = await montar(r).versoes.atualizar()
  assert.equal(res.ok, true, res.mensagem)
  assert.equal(existsSync(join(r.repo, 'anotacao-local.txt')), true)
})

test('um não rastreado com o nome de um que chega barra antes de desligar, com o nome dele', async () => {
  const r = comRemoto()
  r.publicar('novo.txt', 'do remoto\n')
  writeFileSync(join(r.repo, 'novo.txt'), 'meu\n')
  const antes = r.git('rev-parse', 'HEAD')
  const { versoes, eventos } = montar(r)
  const res = await versoes.atualizar()
  assert.equal(res.ok, false)
  assert.match(res.mensagem, /não rastreados seriam sobrescritos \(novo\.txt\)/)
  assert.equal(r.git('rev-parse', 'HEAD'), antes)
  assert.deepEqual(eventos, [])
})

test('alteração não commitada barra e diz quais arquivos', async () => {
  const r = comRemoto()
  r.publicar()
  writeFileSync(join(r.repo, 'app.txt'), 'trabalho do Ricardo\n')
  const { versoes, eventos } = montar(r)
  const res = await versoes.atualizar()
  assert.equal(res.ok, false)
  assert.match(res.mensagem, /alterações não commitadas \(app\.txt\); nada foi atualizado/)
  assert.deepEqual(eventos, [])
})

test('um merge pela metade barra a atualização com o motivo', async () => {
  const r = comRemoto()
  writeFileSync(join(r.repo, '.git', 'MERGE_HEAD'), `${r.git('rev-parse', 'HEAD')}\n`)
  const res = await montar(r).versoes.atualizar()
  assert.equal(res.ok, false)
  assert.match(res.mensagem, /no meio de um merge/)
})

test('fora da main ou com HEAD destacado, diz onde está e não mexe', async () => {
  const r = comRemoto()
  r.git('switch', '-qc', 'fase-2.9/outra')
  assert.match((await montar(r).versoes.atualizar()).mensagem, /Só atualizo na main; agora estou em fase-2\.9\/outra/)
  r.git('switch', '-q', '--detach', 'main')
  assert.match((await montar(r).versoes.atualizar()).mensagem, /HEAD destacado em \w{7}/)
})

test('remoto inexistente, fora do ar ou sem a branch: motivo exato, nada desligado', async () => {
  const r = comRemoto()
  const { versoes, eventos } = montar(r)
  r.git('remote', 'set-url', 'origin', join(r.raiz, 'nao-existe.git'))
  const fora = await versoes.atualizar()
  assert.equal(fora.ok, false)
  assert.match(fora.mensagem, /^Não consegui atualizar: git fetch falhou: .+\. Nada foi trocado\.$/)

  r.git('remote', 'set-url', 'origin', r.remoto)
  r.git('config', 'branch.main.merge', 'refs/heads/sumiu')
  assert.match((await versoes.atualizar()).mensagem, /O remoto origin não tem a branch sumiu/)

  r.git('config', 'branch.main.remote', 'outro')
  assert.match((await versoes.atualizar()).mensagem, /não tem o remoto outro/)
  assert.deepEqual(eventos, [])
})

test('main local à frente ou divergente do remoto não é atualizada', async () => {
  const r = comRemoto()
  writeFileSync(join(r.repo, 'local.txt'), 'só aqui\n')
  r.git('add', '-A')
  r.git('commit', '-qm', 'local')
  assert.match((await montar(r).versoes.atualizar()).mensagem, /tem commits que origin\/main não tem/)
  r.publicar()
  assert.match((await montar(r).versoes.atualizar()).mensagem, /divergiram; resolva à mão/)
})

test('a versão nova que não sobe volta ao commit de antes e religa', async () => {
  const r = comRemoto()
  const antes = r.git('rev-parse', 'HEAD')
  r.publicar()
  const { versoes, eventos } = montar(r, { saude: async () => ({ ok: false, motivo: 'não respondeu' }) })
  const res = await versoes.atualizar()
  assert.equal(res.ok, false)
  assert.match(res.mensagem, /Voltei para a versão de antes/)
  assert.equal(r.git('rev-parse', 'HEAD'), antes)
  assert.equal(eventos.at(-1), 'ligar')
})

test('a reinstalação que falha no meio volta ao commit de antes e nunca deixa os serviços desligados', async () => {
  const r = comRemoto()
  const antes = r.git('rev-parse', 'HEAD')
  r.publicar('package.json', '{}\n')
  const { versoes, eventos } = montar(r, {
    instalar: { comando: [process.execPath, '-e', 'process.exit(3)'], quando: [/^package\.json$/] },
  })
  const res = await versoes.atualizar()
  assert.equal(res.ok, false)
  assert.match(res.mensagem, /Não consegui atualizar: .+Voltei para a versão de antes/)
  assert.equal(r.git('rev-parse', 'HEAD'), antes)
  assert.equal(eventos.filter((e) => e === 'ligar').length >= 1, true)
  assert.equal(eventos.at(-1), 'ligar')
})

test('duas atualizações ao mesmo tempo: a segunda espera a vez e diz por quê', async () => {
  const r = comRemoto()
  r.publicar()
  const { versoes } = montar(r)
  const [a, b] = await Promise.all([versoes.atualizar(), versoes.atualizar()])
  assert.equal(a.ok, true, a.mensagem)
  assert.match(b.mensagem, /Há uma troca em andamento/)
})

test('aplicar recusa commit inexistente e nome de branch que viraria opção do Git', async () => {
  const r = comRemoto()
  const { versoes, avisos, eventos } = montar(r)
  await versoes.aplicar({ id: '1', sha: 'a'.repeat(40), branch: 'autodev/1' })
  assert.match(avisos.at(-1).mensagem, /O commit aaaaaaa não existe nesta cópia/)
  await versoes.aplicar({ id: '2', sha: r.git('rev-parse', 'HEAD'), branch: '--orphan' })
  assert.match(avisos.at(-1).mensagem, /Branch inválida/)
  assert.deepEqual(eventos, [])
})

test('aplicar segue com um não rastreado que não colide e confere o commit no fim', async () => {
  const r = comRemoto()
  r.git('switch', '-qc', 'autodev/1')
  writeFileSync(join(r.repo, 'app.txt'), 'v2\n')
  r.git('commit', '-qam', 'v2')
  const sha = r.git('rev-parse', 'HEAD')
  r.git('switch', '-q', 'main')
  writeFileSync(join(r.repo, 'solto.txt'), 'local\n')
  const { versoes, avisos } = montar(r)
  await versoes.aplicar({ id: '1', sha, branch: 'autodev/1' })
  assert.equal(avisos.at(-1).tipo, 'em_teste', avisos.at(-1).mensagem)
  assert.equal(r.git('rev-parse', 'HEAD'), sha)
  await versoes.reverter({ id: '1' })
  assert.equal(r.git('rev-parse', '--abbrev-ref', 'HEAD'), 'main')
})

test('voltar para uma branch que só existe no remoto cria a local que o acompanha', async () => {
  const r = comRemoto()
  const pasta = temp()
  const main = r.git('rev-parse', 'main')
  r.git('switch', '-qc', 'autodev/1')
  r.git('branch', '-D', 'main')
  writeFileSync(
    join(pasta, 'transicao.json'),
    JSON.stringify({ id: '1', de: { ref: 'main', sha: main }, para: { ref: 'autodev/1', sha: main } }),
  )
  r.git('switch', '-q', '--detach')
  const { versoes } = montar(r, { pasta })
  await versoes.recuperar()
  assert.equal(r.git('rev-parse', '--abbrev-ref', 'HEAD'), 'main')
  assert.equal(r.git('rev-parse', '--abbrev-ref', 'main@{upstream}'), 'origin/main')
})

test('voltar para uma branch que não existe em lugar nenhum falha com o nome dela', async () => {
  const r = comRemoto()
  const pasta = temp()
  writeFileSync(
    join(pasta, 'transicao.json'),
    JSON.stringify({ id: '1', de: { ref: 'fase-9/sumiu', sha: r.git('rev-parse', 'HEAD') }, para: { ref: 'autodev/1', sha: 'x' } }),
  )
  const { versoes } = montar(r, { pasta })
  await assert.rejects(versoes.recuperar(), /a branch fase-9\/sumiu não existe nesta cópia nem em origin/)
  // O registro fica: a próxima partida tenta de novo.
  assert.equal(existsSync(join(pasta, 'transicao.json')), true)
})

test('fenix rollback com a branch de volta sumida sai com 1, motivo e registro preservado', () => {
  const r = comRemoto()
  const pasta = temp()
  writeFileSync(
    join(pasta, 'transicao.json'),
    JSON.stringify({ id: '1', de: { ref: 'fase-9/sumiu', sha: r.git('rev-parse', 'HEAD') }, para: { ref: 'autodev/1', sha: 'x' } }),
  )
  const config = join(temp(), 'fenix.config.json')
  writeFileSync(config, JSON.stringify({ repositorio: r.repo, pasta, servicos: [{ nome: 'app', comando: ['node', 'app.mjs'] }] }))
  const fenix = fileURLToPath(new URL('../fenix.mjs', import.meta.url))
  const p = spawnSync(process.execPath, [fenix, 'rollback', '--config', config], { cwd: r.repo, encoding: 'utf8' })
  assert.equal(p.status, 1)
  assert.match(p.stderr, /o rollback não terminou: a branch fase-9\/sumiu não existe mais/)
  assert.equal(existsSync(join(pasta, 'transicao.json')), true)
})

test('fenix rotina sem Fênix no ar sai com 1 e diz onde procurou', () => {
  const pasta = temp()
  writeFileSync(join(pasta, 'token'), `${'t'.repeat(40)}\n`)
  const config = join(temp(), 'fenix.config.json')
  writeFileSync(
    config,
    JSON.stringify({ repositorio: '.', pasta, escuta: { host: '127.0.0.1', porta: 1 }, servicos: [{ nome: 'app', comando: ['node', 'app.mjs'] }] }),
  )
  const fenix = fileURLToPath(new URL('../fenix.mjs', import.meta.url))
  const p = spawnSync(process.execPath, [fenix, 'rotina', 'atualizar', '--config', config], { encoding: 'utf8' })
  assert.equal(p.status, 1)
  assert.match(p.stderr, /A Fênix não está no ar em ws:\/\/localhost:1\/fenix/)
})

test('o erro do Git vira uma linha com o comando e o motivo', () => {
  const e = erroDoGit(['switch', 'x'], { stderr: "hint: algo\nfatal: invalid reference: x\n", message: 'Command failed' })
  assert.equal(e.message, 'git switch falhou: invalid reference: x')
  assert.match(erroDoGit(['fetch'], { killed: true, prazo: 30_000, stderr: '' }).message, /git fetch falhou: passou de 30 s/)
})
