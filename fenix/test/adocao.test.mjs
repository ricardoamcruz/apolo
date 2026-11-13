/**
 * A F.Ê.N.I.X. que volta encontra de pé os serviços independentes (docs/adr/0029):
 * adota a cópia que continuou rodando, sem derrubá-la, e só sobe uma nova se ela
 * sumir ou travar. Processos de verdade, com lsof, como no Mac.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { criarServicos, processoVivo } from '../src/servicos.mjs'

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))
const portaLivre = () =>
  new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })

/** Um serviço de mentira com saúde, numa pasta que faz as vezes do projeto. */
function projeto() {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'fenix-adocao-')))
  writeFileSync(
    join(repo, 'servico.mjs'),
    `
     import('node:http').then(({ createServer }) => {
       createServer((q, r) => { r.writeHead(q.url === '/saude' ? 200 : 404); r.end('{"ok":true}') })
         .listen(Number(process.env.PORTA), '127.0.0.1')
     })
     process.on('SIGTERM', () => process.exit(0))`,
  )
  return repo
}

const def = (porta, extra = {}) => ({
  nome: 'hermes',
  comando: ['node', 'servico.mjs'],
  cor: '33',
  opcional: true,
  independente: true,
  portas: [porta],
  ambiente: { PORTA: String(porta) },
  saude: { urls: [`http://127.0.0.1:${porta}/saude`], ca: null, prazoMs: 1000 },
  ...extra,
})

async function esperar(cond, ms = 5000) {
  const limite = Date.now() + ms
  while (Date.now() < limite) {
    if (await cond()) return
    await dormir(50)
  }
  assert.fail('a condição não aconteceu a tempo')
}

test('o independente que continuou de pé é adotado, não derrubado, e sai no encerramento', async () => {
  const repo = projeto()
  const porta = await portaLivre()
  // A cópia que sobreviveu à Fênix anterior.
  const sobrevivente = spawn(process.execPath, ['servico.mjs'], { cwd: repo, env: { ...process.env, PORTA: String(porta) }, stdio: 'ignore' })
  const s = criarServicos({ repo, servicos: [def(porta)], log: () => {}, saida: { write() {} }, intervaloMs: 50 })
  try {
    await esperar(async () => (await fetch(`http://127.0.0.1:${porta}/saude`).catch(() => null))?.ok)
    await s.liberarPortas()
    s.ligarTodos()
    const [e] = s.estado()
    assert.equal(e.status, 'ligado')
    assert.equal(e.adotado, true)
    assert.equal(e.pid, sobrevivente.pid)
    await dormir(300)
    assert.equal(processoVivo(sobrevivente.pid), true, 'a Fênix derrubou o sobrevivente')
    await s.encerrar()
    await esperar(() => !processoVivo(sobrevivente.pid) || sobrevivente.exitCode !== null)
  } finally {
    sobrevivente.kill('SIGKILL')
  }
})

test('o adotado que some é substituído por um filho da Fênix', async () => {
  const repo = projeto()
  const porta = await portaLivre()
  const sobrevivente = spawn(process.execPath, ['servico.mjs'], { cwd: repo, env: { ...process.env, PORTA: String(porta) }, stdio: 'ignore' })
  const s = criarServicos({ repo, servicos: [def(porta)], log: () => {}, saida: { write() {} }, intervaloMs: 50, esperasMs: [50] })
  try {
    await esperar(async () => (await fetch(`http://127.0.0.1:${porta}/saude`).catch(() => null))?.ok)
    await s.liberarPortas()
    s.ligarTodos()
    assert.equal(s.estado()[0].adotado, true)
    sobrevivente.kill('SIGKILL')
    await esperar(() => {
      const [e] = s.estado()
      return !e.adotado && e.pid && e.pid !== sobrevivente.pid && e.status === 'ligado'
    })
  } finally {
    sobrevivente.kill('SIGKILL')
    await s.encerrar()
  }
})

test('um serviço comum na porta continua sendo encerrado, como antes', async () => {
  const repo = projeto()
  const porta = await portaLivre()
  const antigo = spawn(process.execPath, ['servico.mjs'], { cwd: repo, env: { ...process.env, PORTA: String(porta) }, stdio: 'ignore' })
  const s = criarServicos({ repo, servicos: [def(porta, { independente: false })], log: () => {}, saida: { write() {} }, intervaloMs: 50 })
  try {
    await esperar(async () => (await fetch(`http://127.0.0.1:${porta}/saude`).catch(() => null))?.ok)
    await s.liberarPortas()
    await esperar(() => antigo.exitCode !== null || antigo.signalCode !== null)
  } finally {
    antigo.kill('SIGKILL')
    await s.encerrar()
  }
})
