/**
 * O protocolo Â.N.C.O.R.A. (docs/adr/0041): o manifesto, o que matar, o guardar,
 * os códigos do iPhone e um pânico inteiro numa pasta temporária, sem root, com
 * uma "Fênix" de mentira que só responde à saúde. Nada aqui toca no A.P.O.L.O. no
 * ar: as pastas e as portas são todas do teste.
 */
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  ancoraNoAr,
  atualizar,
  codigoDaAncora,
  codigoValido,
  conferirManifesto,
  escolherAlvos,
  faltaDaAncora,
  gerarManifesto,
  guardar,
  lerArgumentos,
  lerConf,
  obter,
  opcoesDaFenixNoAr,
  panico,
  quemEscuta,
} from './ancora/ancora.mjs'

process.env.ANCORA_SEM_AVISOS = '1'

const pasta = (nome) => realpathSync(mkdtempSync(join(tmpdir(), `ancora-${nome}-`)))
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

function repositorio() {
  const repo = pasta('repo')
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.name', 'Teste')
  git(repo, 'config', 'user.email', 'teste@localhost')
  git(repo, 'config', 'commit.gpgsign', 'false')
  return repo
}

const fenixDeMentira = (versao) => `import { createServer } from 'node:http'
createServer((q, r) => r.end(JSON.stringify({ ok: true, versao: '${versao}', fixa: process.env.FENIX_VERSAO_FIXA ?? '' })))
  .listen(Number(process.env.TESTE_PORTA), '127.0.0.1')
`

const portaLivre = () =>
  new Promise((ok) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => ok(port))
    })
  })

const esperarPorta = async (porta, ms = 10_000) => {
  const fim = Date.now() + ms
  while (Date.now() < fim) {
    if ((await obter(`http://127.0.0.1:${porta}/`)).ok) return
    await new Promise((r) => setTimeout(r, 100))
  }
  assert.fail(`ninguém respondeu na porta ${porta}`)
}

const matarNaPorta = (porta) => {
  for (const pid of quemEscuta([porta])) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* já saiu */
    }
  }
}

test('o manifesto pega qualquer arquivo mudado, e ignora o .git', () => {
  const p = pasta('manifesto')
  mkdirSync(join(p, 'a', '.git'), { recursive: true })
  mkdirSync(join(p, '.git'))
  writeFileSync(join(p, 'a', 'b.txt'), 'um')
  writeFileSync(join(p, '.git', 'HEAD'), 'x')
  writeFileSync(join(p, 'MANIFESTO'), gerarManifesto(p))
  assert.equal(conferirManifesto(p).ok, true)
  writeFileSync(join(p, '.git', 'HEAD'), 'mudou, mas é do Git')
  assert.equal(conferirManifesto(p).ok, true)
  writeFileSync(join(p, 'a', 'b.txt'), 'dois')
  const r = conferirManifesto(p)
  assert.equal(r.ok, false)
  assert.match(r.motivo, /a\/b\.txt/)
})

test('o pânico mata os serviços das pastas do A.P.O.L.O. e os filhos deles, nunca o VS Code nem quem o chamou', () => {
  const repo = '/x/apolo'
  const processos = [
    { pid: 1, ppid: 0, args: 'launchd', cwd: '/' },
    { pid: 10, ppid: 1, args: '/bin/zsh', cwd: repo },
    { pid: 11, ppid: 10, args: 'node /usr/local/ancora/bin/ancora.mjs', cwd: repo },
    { pid: 20, ppid: 1, args: 'node fenix/fenix.mjs --writes', cwd: repo },
    { pid: 21, ppid: 20, args: 'node bridge/server.mjs', cwd: repo },
    { pid: 22, ppid: 21, args: 'claude --agent', cwd: '/Users/r' },
    { pid: 30, ppid: 1, args: 'node bridge/server.mjs', cwd: '/outro/projeto' },
    { pid: 40, ppid: 1, args: '/Applications/Visual Studio Code.app/Contents/MacOS/Electron', cwd: repo },
    { pid: 41, ppid: 40, args: 'node tsserver.js', cwd: repo },
    { pid: 50, ppid: 1, args: 'Google Chrome --user-data-dir=/Users/r/.apolo/chrome --app=x', cwd: '/' },
    { pid: 60, ppid: 1, args: 'caffeinate -i -t 3600', cwd: '/' },
    { pid: 70, ppid: 1, args: 'python -m http.server', cwd: '/' },
  ]
  const alvos = escolherAlvos({ processos, escutando: [70], pastas: [repo], extras: [60], perfil: '/Users/r/.apolo/chrome', eu: 11 })
  assert.deepEqual(alvos.sort((a, b) => a - b), [20, 21, 22, 50, 60, 70])
})

test('a ponte que chamou o pânico pela voz cai junto: só quem não é serviço fica protegido', () => {
  const repo = '/x/apolo'
  const processos = [
    { pid: 20, ppid: 1, args: 'node fenix/fenix.mjs', cwd: repo },
    { pid: 21, ppid: 20, args: 'node bridge/server.mjs', cwd: repo },
    { pid: 99, ppid: 21, args: 'node /usr/local/ancora/bin/ancora.mjs --origem voz', cwd: repo },
  ]
  assert.deepEqual(escolherAlvos({ processos, pastas: [repo], eu: 99 }).sort(), [20, 21])
})

test('as opções da Fênix no ar voltam iguais; sem Fênix, as padrão', () => {
  const p = [{ pid: 1, args: 'node /x/fenix/fenix.mjs --config /x/fenix.config.json --writes' }]
  assert.deepEqual(opcoesDaFenixNoAr(p, ['--writes', '--autodev']), ['--writes'])
  assert.deepEqual(opcoesDaFenixNoAr([{ pid: 2, args: 'node fenix/fenix.mjs rotina testes' }], ['--autodev']), ['--autodev'])
})

test('o código do iPhone vale o minuto (com folga de relógio) e uma vez só', () => {
  const agora = new Date(2026, 10, 27, 23, 41, 30)
  const segredo = 'palavra-de-teste'
  const codigo = codigoDaAncora(segredo, agora)
  assert.match(codigo, /^[0-9a-f]{64}$/)
  assert.equal(codigoValido(segredo, codigo, agora), true)
  assert.equal(codigoValido(segredo, codigo.toUpperCase(), new Date(agora.getTime() + 90_000)), true)
  assert.equal(codigoValido(segredo, codigo, new Date(agora.getTime() + 4 * 60_000)), false)
  assert.equal(codigoValido('outra', codigo, agora), false)
  assert.equal(codigoValido(segredo, segredo, agora), false, 'a palavra em si nunca vale')
  assert.equal(codigoValido(segredo, codigo, agora, new Set([codigo])), false)
})

test('guardar põe o que estava sem commit numa branch panico e arquiva o estado de trabalho', async () => {
  const repo = repositorio()
  writeFileSync(join(repo, 'a.txt'), 'um')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'um')
  writeFileSync(join(repo, 'a.txt'), 'mexido')
  writeFileSync(join(repo, 'novo.txt'), 'novo')
  const home = pasta('home')
  mkdirSync(join(home, '.apolo', 'fenix'), { recursive: true })
  writeFileSync(join(home, '.apolo', 'fenix', 'transicao.json'), '{}')
  const dados = join(home, '.apolo', 'ancora')
  const r = await guardar({ repo, dados, home, log: () => {} })
  assert.match(r.branch, /^panico\/\d{8}-\d{6}$/)
  assert.equal(git(repo, 'status', '--porcelain'), '')
  assert.equal(git(repo, 'show', `${r.branch}:a.txt`), 'mexido')
  assert.equal(git(repo, 'show', `${r.branch}:novo.txt`), 'novo')
  assert.deepEqual(r.movidos, ['fenix/transicao.json'])
  assert.equal(existsSync(join(home, '.apolo', 'fenix', 'transicao.json')), false)
})

/** Um repositório com a âncora boa (A) congelada e uma versão B no ar, suja. */
async function cenario() {
  const repo = repositorio()
  mkdirSync(join(repo, 'fenix'))
  writeFileSync(join(repo, 'fenix', 'fenix.mjs'), fenixDeMentira('A'))
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'A: a versão boa')
  const shaA = git(repo, 'rev-parse', 'HEAD')
  const home = pasta('home')
  const R = pasta('raiz')
  const porta = await portaLivre()
  const conf = {
    usuario: null,
    home,
    repo,
    node: process.execPath,
    portas: [porta],
    servicos: [{ nome: 'ponte', url: `http://127.0.0.1:${porta}/health` }],
    opcoes: [],
  }
  writeFileSync(join(R, 'ancora.conf'), JSON.stringify(conf))
  process.env.ANCORA_SEM_ROOT = '1'
  process.env.ANCORA_SEM_NPM = '1'
  const congelada = atualizar(lerConf(R), shaA, { saida: () => {}, conferirGithub: false })
  assert.equal(congelada.n, 1)
  assert.equal(congelada.sha, shaA)
  // A versão B vai ao ar e quebra; alguém deixa coisa sem commit.
  git(repo, 'switch', '-q', '-c', 'fase-9.1/quebrada')
  writeFileSync(join(repo, 'fenix', 'fenix.mjs'), fenixDeMentira('B'))
  git(repo, 'commit', '-q', '-am', 'B: a versão que quebrou')
  writeFileSync(join(repo, 'rascunho.txt'), 'trabalho sem commit')
  const noAr = spawn(process.execPath, ['fenix/fenix.mjs'], { cwd: repo, env: { ...process.env, TESTE_PORTA: String(porta) }, detached: true, stdio: 'ignore' })
  noAr.unref()
  await esperarPorta(porta)
  return { repo, home, R, porta, shaA }
}

test('o pânico inteiro: desliga a B, guarda o rascunho, põe a âncora A no ar pelo repositório e confere', async (t) => {
  const { repo, R, porta, shaA } = await cenario()
  t.after(() => matarNaPorta(porta))
  process.env.TESTE_PORTA = String(porta)
  const linhas = []
  const conf = lerConf(R)
  const r = await panico(conf, { origem: 'teste', saida: (l) => linhas.push(l), prazos: { prazoMs: 15_000, intervaloMs: 200 }, comInterface: false })
  assert.equal(r.ok, true, linhas.join('\n'))
  assert.equal(r.modo, 'repositorio')
  assert.equal(git(repo, 'rev-parse', 'HEAD'), shaA)
  const resposta = JSON.parse((await obter(`http://127.0.0.1:${porta}/`)).corpo)
  assert.equal(resposta.versao, 'A')
  assert.equal(resposta.fixa, '')
  const panicos = git(repo, 'branch', '--list', 'panico/*')
  assert.ok(panicos, 'a branch panico existe')
  assert.equal(git(repo, 'show', `${panicos.replace(/^[*\s]+/, '')}:rascunho.txt`), 'trabalho sem commit')
  assert.ok(git(repo, 'branch', '--list', 'fase-9.1/quebrada'), 'a branch quebrada continua guardada')
  assert.equal((await ancoraNoAr(conf))?.n, 1)
  assert.match(readFileSync(join(conf.dados, 'registro.log'), 'utf8'), /a âncora 1 está no ar/)
})

test('com o repositório inutilizável, o pânico sobe a cópia congelada, presa nesta versão', async (t) => {
  const { repo, R, porta } = await cenario()
  t.after(() => matarNaPorta(porta))
  process.env.TESTE_PORTA = String(porta)
  renameSync(join(repo, '.git'), join(repo, '.git-estragado'))
  const linhas = []
  const conf = lerConf(R)
  const r = await panico(conf, { origem: 'teste', saida: (l) => linhas.push(l), prazos: { prazoMs: 15_000, intervaloMs: 200 }, comInterface: false })
  assert.equal(r.ok, true, linhas.join('\n'))
  assert.equal(r.modo, 'copia')
  const resposta = JSON.parse((await obter(`http://127.0.0.1:${porta}/`)).corpo)
  assert.equal(resposta.versao, 'A')
  assert.equal(resposta.fixa, '1')
  assert.equal((await ancoraNoAr(conf))?.modo, 'copia')
})

test('uma âncora adulterada não sobe: o pânico usa a anterior ou para', async () => {
  const { R, porta } = await cenario()
  matarNaPorta(porta)
  writeFileSync(join(R, '1', 'fenix', 'fenix.mjs'), 'process.exit(1)\n')
  const linhas = []
  const r = await panico(lerConf(R), { origem: 'teste', saida: (l) => linhas.push(l), prazos: { prazoMs: 2000, intervaloMs: 200 }, comInterface: false })
  assert.equal(r.ok, false)
  assert.ok(linhas.some((l) => /não confere com o manifesto/.test(l)))
})

test('a linha de comando: só sem argumento, "panico" ou --origem/--motivo viram pânico', () => {
  assert.equal(lerArgumentos([]).comando, 'panico')
  assert.equal(lerArgumentos(['--panico', '--origem', 'fenix', '--motivo', 'caiu']).comando, 'panico')
  assert.deepEqual(lerArgumentos(['--origem', 'iphone']), { comando: 'panico', origem: 'iphone', motivo: '', alvo: null })
  assert.equal(lerArgumentos(['estado']).comando, 'estado', 'sem "--" também vale')
  assert.equal(lerArgumentos(['--estado']).comando, 'estado')
  assert.equal(lerArgumentos(['-h']).comando, 'ajuda')
  assert.equal(lerArgumentos(['--atualizar', 'main']).alvo, 'main')
  assert.equal(lerArgumentos(['--atualizar']).alvo, null)
  for (const errado of [['estdo'], ['status'], ['--estado', '--sair'], ['--origem']]) {
    assert.ok(lerArgumentos(errado).erro, `${errado.join(' ')} não pode virar pânico`)
  }
})

test('uma âncora sem leitura diz por quê, e o pânico não desliga nada sem âncora', async (t) => {
  const { R, porta } = await cenario()
  t.after(() => {
    chmodSync(join(R, '1'), 0o755)
    matarNaPorta(porta)
  })
  chmodSync(join(R, '1'), 0o000)
  assert.match(faltaDaAncora(1, join(R, '1')), /permissão.*chmod/)
  assert.match(faltaDaAncora(7, join(R, '7')), /não existe/)
  const linhas = []
  const r = await panico(lerConf(R), { origem: 'teste', saida: (l) => linhas.push(l), comInterface: false })
  assert.equal(r.ok, false)
  assert.ok(linhas.some((l) => /não desliguei nada/.test(l)), linhas.join('\n'))
  assert.ok((await obter(`http://127.0.0.1:${porta}/`)).ok, 'a versão no ar continua de pé')
})

// ---------------------------------------------------------------- a voz e a ponte

import { acionarAncora, estadoDaAncora, lembreteDaAncora, textoDaAncora } from '../bridge/ancora.mjs'
import { criarAncoraPelaVoz } from '../src/lib/ancora.ts'
import { criarModoNoturnoPelaVoz } from '../src/lib/autodev.ts'

test('pela voz, a âncora só sai na segunda chamada e com o sim ouvido', async () => {
  const pedidos = []
  let ouviu = false
  let relogio = 1000
  const voz = criarAncoraPelaVoz({
    pedir: async (acao) => (pedidos.push(acao), { ok: true, instalada: true, mensagem: 'A âncora 1 é o commit abc1234.' }),
    ouviu: async () => ouviu,
    agora: () => relogio,
  })
  assert.match(await voz.pedido('acionar'), /Ainda sem acionar/)
  assert.deepEqual(pedidos, ['ancora-estado'])
  assert.match(await voz.pedido('acionar'), /não foi ouvido/)
  assert.ok(!pedidos.includes('ancora-acionar'))
  ouviu = true
  assert.match(await voz.pedido('acionar'), /Protocolo âncora acionado/)
  assert.equal(pedidos.at(-1), 'ancora-acionar')
  // Uma pergunta velha não vale para um sim de agora.
  await voz.pedido('acionar')
  relogio += 3 * 60_000
  pedidos.length = 0
  assert.match(await voz.pedido('acionar'), /Ainda sem acionar/)
  assert.deepEqual(pedidos, ['ancora-estado'])
})

test('sem a âncora instalada, a voz explica como instalar e não pergunta', async () => {
  const voz = criarAncoraPelaVoz({
    pedir: async () => ({ ok: true, instalada: false, mensagem: textoDaAncora({ instalada: false }) }),
    ouviu: async () => true,
  })
  assert.match(await voz.pedido('acionar'), /não está instalado/)
})

test('a ponte sabe se a âncora está no ar, lembra a velha e a chama solta', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'ancora-ponte-'))
  const dados = mkdtempSync(join(tmpdir(), 'ancora-dados-'))
  const bin = join(raiz, 'ancora')
  writeFileSync(bin, '#!/bin/sh\n')
  const agora = Date.parse('2026-12-31T12:00:00Z')
  writeFileSync(join(raiz, 'atual.json'), JSON.stringify({ n: 2, sha: 'abc1234def', em: '2026-11-28T12:00:00Z' }))
  writeFileSync(join(dados, 'no-ar.json'), JSON.stringify({ n: 2, sha: 'abc1234def', modo: 'repositorio' }))
  const e = estadoDaAncora({ shaNoAr: 'abc1234def', bin, raiz, dados, agora })
  assert.equal(e.instalada, true)
  assert.equal(e.noAr, true)
  assert.equal(e.dias, 33)
  assert.match(lembreteDaAncora(e), /33 dias/)
  assert.equal(estadoDaAncora({ shaNoAr: 'outro', bin, raiz, dados, agora }).noAr, false, 'trocou de versão: a âncora saiu do ar')
  assert.equal(lembreteDaAncora({ ...e, dias: 3 }), null)
  const chamadas = []
  const r = acionarAncora({ origem: 'qualquer coisa; rm -rf', bin, spawn: (c, a, o) => (chamadas.push({ c, a, o }), { unref() {} }) })
  assert.equal(r.ok, true)
  assert.deepEqual(chamadas[0].a, ['--origem', 'voz'], 'só palavras conhecidas vão ao registro')
  assert.equal(chamadas[0].o.detached, true)
})

test('o modo noturno pela voz: o plano lido e só o confirmo depois dele começam a noite', async () => {
  const pedidos = []
  let ouviu = false
  const voz = criarModoNoturnoPelaVoz({
    pedir: async (etapa, extra) => (pedidos.push([etapa, extra]), { ok: true, mensagem: etapa }),
    ouviu: async () => ouviu,
  })
  assert.match(await voz.pedido({ acao: 'comecar' }), /Não há plano/)
  await voz.pedido({ acao: 'planejar', itens: '1.3', acompanhar: 'ficar' })
  assert.match(await voz.pedido({ acao: 'comecar' }), /não foi ouvido/)
  ouviu = true
  assert.equal(await voz.pedido({ acao: 'comecar' }), 'comecar')
  assert.deepEqual(pedidos.map((p) => p[0]), ['planejar', 'comecar'])
  assert.equal(pedidos[0][1].acompanhar, 'ficar')
})
