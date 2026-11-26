/**
 * Testes da troca de branch da F.Ê.N.I.X. (docs/adr/0038): da main para uma branch
 * de fase e de volta, pelo número falado, com prévia, observação e a volta sozinha
 * quando a versão nova não fica de pé. Repositórios Git de verdade, com um remoto
 * local, e serviços de mentira.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { criarVersoes } from '../src/versoes.mjs'

const PROTECAO = {
  revisao: [/^bridge\/gate\.mjs$/, /^package\.json$/],
  liberados: new Set(),
  invariantes: [],
  branch: /^fase-\d+(\.\d+)*\/[a-z0-9]+(-[a-z0-9]+)*$/,
}
const temp = () => realpathSync(mkdtempSync(join(tmpdir(), 'fenix-trocar-')))
const rodarGit = (cwd) => (...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const esperar = async (cond, ms = 3000) => {
  const limite = Date.now() + ms
  while (!cond() && Date.now() < limite) await new Promise((ok) => setTimeout(ok, 5))
  assert.ok(cond(), 'a condição não aconteceu a tempo')
}

/** A cópia na main, com um remoto, uma branch de fase local e um colega que publica. */
function cenario() {
  const raiz = temp()
  const remoto = join(raiz, 'remoto.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remoto])
  const repo = join(raiz, 'copia')
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  const git = rodarGit(repo)
  git('config', 'user.email', 'teste@apolo.local')
  git('config', 'user.name', 'Teste')
  writeFileSync(join(repo, 'app.txt'), 'v1\n')
  git('add', '-A')
  git('commit', '-qm', 'v1')
  git('remote', 'add', 'origin', remoto)
  git('push', '-q', '-u', 'origin', 'main')
  const main = git('rev-parse', 'HEAD')
  // A branch de fase que o autodesenvolvimento guardou para revisão, com um arquivo sensível.
  git('switch', '-qc', 'fase-3.4/aurora-no-bolso')
  writeFileSync(join(repo, 'app.txt'), 'v2 da fase\n')
  writeFileSync(join(repo, 'bridge-gate.txt'), 'x\n')
  execFileSync('mkdir', ['-p', join(repo, 'bridge')])
  writeFileSync(join(repo, 'bridge', 'gate.mjs'), 'export const gate = 1\n')
  git('add', '-A')
  git('commit', '-qm', 'Dar bom dia também pelo celular')
  const fase = git('rev-parse', 'HEAD')
  git('switch', '-q', 'main')
  const colega = join(raiz, 'colega')
  execFileSync('git', ['clone', '-q', remoto, colega], { stdio: 'ignore' })
  const gitColega = rodarGit(colega)
  gitColega('config', 'user.email', 'colega@apolo.local')
  gitColega('config', 'user.name', 'Colega')
  return { raiz, repo, git, remoto, colega, gitColega, main, fase }
}

function montar(r, { saude = async () => ({ ok: true, interfaces: 1 }), ...extra } = {}) {
  const eventos = []
  const trocas = []
  const pasta = temp()
  const versoes = criarVersoes({
    repo: r.repo,
    pasta,
    ligar: () => eventos.push('ligar'),
    desligar: async () => eventos.push('desligar'),
    saude,
    protecao: PROTECAO,
    notificar: () => {},
    aoTrocar: (t) => trocas.push(t),
    log: () => {},
    subidaMs: 40,
    estabilidadeMs: 40,
    intervaloMs: 5,
    vigiaMs: 5,
    ...extra,
  })
  return { versoes, eventos, trocas, pasta }
}

const naBranch = (r) => r.git('branch', '--show-current')

test('"3.4" acha a branch de fase, a prévia conta o que muda e pede o sim', async () => {
  const r = cenario()
  const { versoes, eventos } = montar(r)
  const p = await versoes.previa({ branch: '3.4' })
  assert.equal(p.ok, true, p.mensagem)
  assert.equal(p.branch, 'fase-3.4/aurora-no-bolso')
  assert.equal(p.sha, r.fase)
  assert.equal(p.confirmar, true)
  assert.deepEqual(p.sensiveis, ['bridge/gate.mjs'])
  assert.match(p.mensagem, /Trocar da main para a fase-3\.4\/aurora-no-bolso, 1 commit à frente da main \(último: "Dar bom dia também pelo celular"\)/)
  assert.match(p.mensagem, /arquivos sensíveis que não entraram na main: bridge\/gate\.mjs/)
  assert.match(p.mensagem, /volto sozinha para a main/)
  // A prévia não mexe em nada.
  assert.equal(naBranch(r), 'main')
  assert.deepEqual(eventos, [])
})

test('trocar põe a branch de fase no ar, observa, e a main fica guardada', async () => {
  const r = cenario()
  const { versoes, eventos } = montar(r)
  const inicio = await versoes.trocar({ id: 't1', branch: 'fase-3.4', sha: r.fase, interfaces: 1 })
  assert.equal(inicio.ok, true, inicio.mensagem)
  assert.match(inicio.mensagem, /Trocando para a fase-3\.4\/aurora-no-bolso/)
  // A resposta vem antes do fim: a ponte que pediu reinicia no meio.
  assert.equal(versoes.estado().troca, 'aplicando')
  const fim = await inicio.concluida
  assert.equal(fim.ok, true, fim.mensagem)
  assert.equal(fim.mensagem, 'A fase-3.4/aurora-no-bolso está no ar. A main continua guardada.')
  assert.equal(naBranch(r), 'fase-3.4/aurora-no-bolso')
  assert.equal(r.git('rev-parse', 'HEAD'), r.fase)
  assert.equal(r.git('rev-parse', 'main'), r.main)
  assert.deepEqual(eventos, ['desligar', 'ligar'])
  const e = versoes.estado()
  assert.equal(e.troca, null)
  assert.equal(e.ultimaTroca.id, 't1')
  assert.equal(e.ultimaTroca.ok, true)
  assert.equal(e.ultimaTroca.branch, 'fase-3.4/aurora-no-bolso')
  // Fora de uma troca, nada fica no disco para a próxima partida desfazer.
  assert.equal(await versoes.recuperar(), null)
})

test('e de volta: a main não pede o sim e a branch de fase continua guardada', async () => {
  const r = cenario()
  r.git('switch', '-q', 'fase-3.4/aurora-no-bolso')
  const { versoes } = montar(r)
  const p = await versoes.previa({ branch: 'main' })
  assert.equal(p.ok, true, p.mensagem)
  assert.equal(p.confirmar, false)
  const inicio = await versoes.trocar({ branch: 'main', sha: p.sha })
  const fim = await inicio.concluida
  assert.equal(fim.ok, true, fim.mensagem)
  assert.equal(naBranch(r), 'main')
  assert.equal(r.git('rev-parse', 'fase-3.4/aurora-no-bolso'), r.fase)
  assert.match(fim.mensagem, /A fase-3\.4\/aurora-no-bolso continua guardada/)
})

test('a branch que não fica de pé volta sozinha para a de antes, e não é apagada', async () => {
  const r = cenario()
  let naFase = false
  const { versoes, eventos } = montar(r, {
    // A versão nova não responde; a main, sim.
    saude: async () => (naFase ? { ok: false, motivo: 'não respondeu' } : { ok: true, interfaces: 1 }),
    ligar: () => {
      naFase = r.git('branch', '--show-current') !== 'main'
      eventos.push('ligar')
    },
  })
  const inicio = await versoes.trocar({ branch: 'fase-3.4/aurora-no-bolso', sha: r.fase })
  const fim = await inicio.concluida
  assert.equal(fim.ok, false)
  assert.match(fim.mensagem, /A nova versão não respondeu\. Voltei para a main, que segue no ar; a fase-3\.4\/aurora-no-bolso continua guardada/)
  assert.equal(naBranch(r), 'main')
  assert.equal(r.git('rev-parse', 'HEAD'), r.main)
  assert.equal(r.git('rev-parse', 'fase-3.4/aurora-no-bolso'), r.fase)
  assert.deepEqual(eventos, ['desligar', 'ligar', 'desligar', 'ligar'])
  assert.equal(versoes.estado().ultimaTroca.ok, false)
  assert.equal(versoes.estado().ultimaTroca.branch, 'main')
})

test('a interface que não volta depois da troca também é falha, quando havia uma', async () => {
  const r = cenario()
  const { versoes } = montar(r, { saude: async () => ({ ok: true, interfaces: 0 }) })
  const fim = await (await versoes.trocar({ branch: '3.4', sha: r.fase, interfaces: 1 })).concluida
  assert.equal(fim.ok, false)
  assert.match(fim.mensagem, /A interface não voltou a se conectar/)
  assert.equal(naBranch(r), 'main')
})

test('a branch que andou depois da prévia não troca sem uma prévia nova', async () => {
  const r = cenario()
  const { versoes, eventos } = montar(r)
  const p = await versoes.previa({ branch: '3.4' })
  r.git('switch', '-q', 'fase-3.4/aurora-no-bolso')
  writeFileSync(join(r.repo, 'app.txt'), 'v3\n')
  r.git('commit', '-qam', 'mais um')
  r.git('switch', '-q', 'main')
  const res = await versoes.trocar({ branch: p.branch, sha: p.sha })
  assert.equal(res.ok, false)
  assert.match(res.mensagem, /mudou desde a prévia/)
  assert.equal(res.concluida, undefined)
  assert.deepEqual(eventos, [])
})

test('pedido que não bate diz quais existem; pedido ambíguo pede para escolher', async () => {
  const r = cenario()
  r.git('branch', 'fase-3.5/noite-longa')
  r.git('branch', 'fase-3.5/outra-coisa')
  const { versoes } = montar(r)
  const nenhuma = await versoes.previa({ branch: '9.9' })
  assert.equal(nenhuma.ok, false)
  assert.match(nenhuma.mensagem, /Não há branch "9\.9".*As mais recentes: .*fase-3\.4\/aurora-no-bolso/)
  const duas = await versoes.previa({ branch: 'fase-3.5' })
  assert.equal(duas.ok, false)
  assert.match(duas.mensagem, /mais de uma branch.*fase-3\.5\/noite-longa.*fase-3\.5\/outra-coisa/)
  // Só a parte criativa do nome também serve.
  assert.equal((await versoes.previa({ branch: 'noite-longa' })).branch, 'fase-3.5/noite-longa')
  // Nome que não é main nem de fase não entra, mesmo existindo.
  r.git('branch', 'autodev/123')
  assert.equal((await versoes.previa({ branch: 'autodev/123' })).ok, false)
})

test('a branch que só existe no GitHub vem de lá; a local atrasada avança sem merge', async () => {
  const r = cenario()
  // Publicada por outro lugar: só existe no remoto.
  r.gitColega('switch', '-qc', 'fase-3.6/so-no-remoto')
  writeFileSync(join(r.colega, 'remoto.txt'), 'r\n')
  r.gitColega('add', '-A')
  r.gitColega('commit', '-qm', 'só no remoto')
  r.gitColega('push', '-q', 'origin', 'fase-3.6/so-no-remoto')
  const doRemoto = r.gitColega('rev-parse', 'HEAD')
  const { versoes } = montar(r)
  const p = await versoes.previa({ branch: '3.6' })
  assert.equal(p.ok, true, p.mensagem)
  assert.equal(p.sha, doRemoto)
  assert.match(p.mensagem, /só existe no origin/)
  const fim = await (await versoes.trocar({ branch: p.branch, sha: p.sha })).concluida
  assert.equal(fim.ok, true, fim.mensagem)
  assert.equal(naBranch(r), 'fase-3.6/so-no-remoto')
  assert.equal(r.git('rev-parse', 'HEAD'), doRemoto)

  // A main local fica atrás do remoto: voltar para ela traz a mais nova junto.
  r.gitColega('switch', '-q', 'main')
  writeFileSync(join(r.colega, 'app.txt'), 'main nova\n')
  r.gitColega('commit', '-qam', 'main nova')
  r.gitColega('push', '-q', 'origin', 'main')
  const mainNova = r.gitColega('rev-parse', 'HEAD')
  const volta = await versoes.previa({ branch: 'main' })
  assert.equal(volta.sha, mainNova)
  assert.match(volta.mensagem, /estava atrás do origin e avança junto/)
  assert.equal((await (await versoes.trocar({ branch: 'main', sha: volta.sha })).concluida).ok, true)
  assert.equal(r.git('rev-parse', 'HEAD'), mainNova)
})

test('sem rede, a prévia segue com o que há nesta máquina e diz isso', async () => {
  const r = cenario()
  r.git('remote', 'set-url', 'origin', join(r.raiz, 'nao-existe.git'))
  const { versoes } = montar(r)
  const p = await versoes.previa({ branch: '3.4' })
  assert.equal(p.ok, true, p.mensagem)
  assert.match(p.mensagem, /Não alcancei o origin: vou com o que há nesta máquina/)
})

test('cópia suja, alteração em teste ou outra troca barram antes de mexer', async () => {
  const r = cenario()
  writeFileSync(join(r.repo, 'app.txt'), 'trabalho do Ricardo\n')
  const { versoes, eventos } = montar(r)
  const suja = await versoes.trocar({ branch: '3.4' })
  assert.equal(suja.ok, false)
  assert.match(suja.mensagem, /alterações não commitadas \(app\.txt\)/)
  r.git('checkout', '--', 'app.txt')

  const primeira = await versoes.trocar({ branch: '3.4' })
  assert.equal(primeira.ok, true)
  const segunda = await versoes.trocar({ branch: 'main' })
  assert.equal(segunda.ok, false)
  assert.match(segunda.mensagem, /troca em andamento/)
  await primeira.concluida
  assert.deepEqual(eventos, ['desligar', 'ligar'])
})

test('uma troca interrompida volta na próxima partida, sem apagar a branch de destino', async () => {
  const r = cenario()
  const { pasta } = montar(r)
  // A Fênix morreu no meio da troca: a cópia ficou na branch nova, com o registro em disco.
  r.git('switch', '-q', 'fase-3.4/aurora-no-bolso')
  writeFileSync(
    join(pasta, 'transicao.json'),
    JSON.stringify({ id: 't9', troca: true, de: { ref: 'main', sha: r.main }, para: { ref: 'fase-3.4/aurora-no-bolso', sha: r.fase } }),
  )
  const versoes = criarVersoes({
    repo: r.repo,
    pasta,
    ligar: () => {},
    desligar: async () => {},
    saude: async () => ({ ok: true }),
    protecao: PROTECAO,
    log: () => {},
  })
  const t = await versoes.recuperar()
  assert.equal(t.troca, true)
  assert.equal(naBranch(r), 'main')
  assert.equal(r.git('rev-parse', 'fase-3.4/aurora-no-bolso'), r.fase)
  assert.equal(existsSync(join(pasta, 'transicao.json')), false)
})

test('a ponte que cai seguidas vezes numa branch de fase volta sozinha para a main', async () => {
  const r = cenario()
  r.git('switch', '-q', 'fase-3.4/aurora-no-bolso')
  const { versoes, trocas, eventos } = montar(r, { quedasParaVoltar: 3, janelaDeQuedasMs: 60_000 })
  assert.equal(versoes.servicoCaiu('ponte', 'encerrou (1)'), false)
  assert.equal(versoes.servicoCaiu('ponte', 'encerrou (1)'), false)
  assert.equal(trocas.length, 0)
  // A terceira: a guardiã segue reiniciando (false), e a volta começa por trás.
  assert.equal(versoes.servicoCaiu('ponte', 'encerrou (1)'), false)
  await esperar(() => trocas.length === 1)
  assert.equal(trocas[0].ok, true, trocas[0].mensagem)
  assert.equal(trocas[0].automatica, true)
  assert.match(trocas[0].mensagem, /^O serviço ponte caiu 3 vezes em 1 min na fase-3\.4\/aurora-no-bolso\. Voltei para a main; a fase-3\.4\/aurora-no-bolso continua guardada/)
  assert.equal(naBranch(r), 'main')
  assert.equal(r.git('rev-parse', 'fase-3.4/aurora-no-bolso'), r.fase)
  assert.deepEqual(eventos, ['desligar', 'ligar'])
})

test('na main, as quedas seguidas não trocam nada: não há versão mais segura', async () => {
  const r = cenario()
  const { versoes, trocas, eventos } = montar(r, { quedasParaVoltar: 2 })
  versoes.servicoCaiu('ponte', 'encerrou (1)')
  versoes.servicoCaiu('ponte', 'encerrou (1)')
  await new Promise((ok) => setTimeout(ok, 100))
  assert.equal(trocas.length, 0)
  assert.deepEqual(eventos, [])
  assert.equal(naBranch(r), 'main')
})

test('a mesma branch, atrás do GitHub, avança no lugar; se quebrar, volta ao commit de antes', async () => {
  const r = cenario()
  r.gitColega('switch', '-q', 'main')
  writeFileSync(join(r.colega, 'app.txt'), 'main nova\n')
  r.gitColega('commit', '-qam', 'main nova')
  r.gitColega('push', '-q', 'origin', 'main')
  const mainNova = r.gitColega('rev-parse', 'HEAD')
  let quebrada = false
  const { versoes } = montar(r, {
    saude: async () => (quebrada && r.git('rev-parse', 'HEAD') === mainNova ? { ok: false, motivo: 'não respondeu' } : { ok: true, interfaces: 1 }),
  })
  const p = await versoes.previa({ branch: 'main' })
  assert.equal(p.sha, mainNova)
  assert.match(p.mensagem, /^Trazer a main, que já está no ar, para o commit mais novo do origin \(último: "main nova"\)/)
  quebrada = true
  const fim = await (await versoes.trocar({ branch: 'main', sha: p.sha })).concluida
  assert.equal(fim.ok, false)
  assert.equal(naBranch(r), 'main')
  assert.equal(r.git('rev-parse', 'HEAD'), r.main)
  quebrada = false
  const deNovo = await (await versoes.trocar({ branch: 'main', sha: mainNova })).concluida
  assert.equal(deNovo.ok, true, deNovo.mensagem)
  assert.equal(r.git('rev-parse', 'HEAD'), mainNova)
})
