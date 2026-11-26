/**
 * Trocar a branch no ar (docs/adr/0038), do lado do A.P.O.L.O.: a voz pede a
 * prévia, só troca para uma branch de fase com o sim ouvido na transcrição, e volta
 * à main sem perguntar; o agente de tarefas não troca a cópia por baixo da Fênix.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { comandoMexeNaCopia, podeUsarFerramenta } from '../bridge/gate.mjs'
import { criarTrocaDeVersao, trocaParaAnunciar, textoDoFimDaTroca } from '../src/lib/trocaDeVersao.ts'

const SHA = 'a'.repeat(40)

/** Uma Fênix de mentira: a prévia e a troca, com o que foi pedido anotado. */
function fenixDeMentira({ confirmar = true, branch = 'fase-3.4/aurora-no-bolso', sha = SHA } = {}) {
  const pedidos = []
  const estado = { sha }
  return {
    pedidos,
    estado,
    pedir: async (acao, extra) => {
      pedidos.push({ acao, ...extra })
      if (acao === 'previa') return { ok: true, branch, sha: estado.sha, confirmar, mensagem: `Trocar da main para a ${branch}.` }
      return { ok: true, mensagem: `Trocando para a ${extra.branch}.` }
    },
  }
}

test('a primeira chamada só mostra a prévia e pede o sim; nada é trocado', async () => {
  const f = fenixDeMentira()
  const troca = criarTrocaDeVersao({ pedir: f.pedir, ouviu: async () => true })
  const texto = await troca.pedido('3.4')
  assert.match(texto, /^Prévia, ainda sem trocar: Trocar da main para a fase-3\.4\/aurora-no-bolso\./)
  assert.match(texto, /pergunte se ele confirma/)
  assert.deepEqual(f.pedidos.map((p) => p.acao), ['previa'])
})

test('com o sim ouvido depois da prévia, troca no commit que a prévia mostrou', async () => {
  const f = fenixDeMentira()
  let agora = 1000
  const desde = []
  const troca = criarTrocaDeVersao({ pedir: f.pedir, ouviu: async (d) => (desde.push(d), true), agora: () => agora })
  await troca.pedido('3.4')
  agora += 5000
  const texto = await troca.pedido('3.4')
  assert.match(texto, /^Trocando para a fase-3\.4\/aurora-no-bolso\. Avise em uma frase curta que vai sumir/)
  assert.deepEqual(f.pedidos.at(-1), { acao: 'trocar', branch: 'fase-3.4/aurora-no-bolso', sha: SHA })
  // O sim conta a partir de quando a prévia foi dita, não de antes.
  assert.deepEqual(desde, [1000])
})

test('sem o sim na transcrição, a segunda chamada não troca', async () => {
  const f = fenixDeMentira()
  const troca = criarTrocaDeVersao({ pedir: f.pedir, ouviu: async () => false })
  await troca.pedido('3.4')
  const texto = await troca.pedido('3.4')
  assert.match(texto, /O sim do Ricardo não foi ouvido\. .*Nada foi trocado\./)
  assert.equal(f.pedidos.some((p) => p.acao === 'trocar'), false)
})

test('a branch que andou desde a prévia pede uma prévia nova, e o sim velho não vale', async () => {
  const f = fenixDeMentira()
  const troca = criarTrocaDeVersao({ pedir: f.pedir, ouviu: async () => true })
  await troca.pedido('3.4')
  f.estado.sha = 'b'.repeat(40)
  const texto = await troca.pedido('3.4')
  assert.match(texto, /^Prévia, ainda sem trocar/)
  assert.equal(f.pedidos.some((p) => p.acao === 'trocar'), false)
})

test('a prévia velha não vale para o sim: é lida de novo', async () => {
  const f = fenixDeMentira()
  let agora = 0
  const troca = criarTrocaDeVersao({ pedir: f.pedir, ouviu: async () => true, agora: () => agora })
  await troca.pedido('3.4')
  agora += 4 * 60_000
  assert.match(await troca.pedido('3.4'), /^Prévia, ainda sem trocar/)
  assert.equal(f.pedidos.some((p) => p.acao === 'trocar'), false)
})

test('voltar à main não pergunta: é a saída de emergência', async () => {
  const f = fenixDeMentira({ confirmar: false, branch: 'main' })
  const troca = criarTrocaDeVersao({ pedir: f.pedir, ouviu: async () => false })
  const texto = await troca.pedido('main')
  assert.match(texto, /^Trocando para a main\./)
  assert.deepEqual(f.pedidos.map((p) => p.acao), ['previa', 'trocar'])
})

test('a recusa da Fênix volta como ela disse, e o pedido vazio nem chega a ela', async () => {
  const pedidos = []
  const troca = criarTrocaDeVersao({
    pedir: async (acao) => (pedidos.push(acao), { ok: false, mensagem: 'Há uma alteração em teste no ar.' }),
    ouviu: async () => true,
  })
  assert.equal(await troca.pedido('3.4'), 'Há uma alteração em teste no ar.')
  assert.match(await troca.pedido('  '), /Diga para qual branch trocar/)
  assert.deepEqual(pedidos, ['previa'])
})

test('o fim da troca é anunciado uma vez, e o velho não é notícia', () => {
  const fim = { id: 't1', ok: true, mensagem: 'A fase-3.4/x está no ar.', em: 1000 }
  assert.equal(trocaParaAnunciar(fim, null, 2000), fim)
  assert.equal(trocaParaAnunciar(fim, 't1', 2000), null)
  assert.equal(trocaParaAnunciar(fim, null, 1000 + 11 * 60_000), null)
  assert.equal(trocaParaAnunciar(null, null), null)
  assert.match(textoDoFimDaTroca(fim), /já está na versão nova/)
  assert.match(textoDoFimDaTroca({ ...fim, ok: false }), /não deu certo/)
  assert.match(textoDoFimDaTroca({ ...fim, automatica: true }), /voltou sozinha para a versão segura/)
})

// ── o agente de tarefas e a cópia no ar ─────────────────────────────────────

const REPO = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')

test('o Bash do agente não troca a branch nem os arquivos da cópia no ar', async () => {
  const casa = homedir()
  const rel = REPO.startsWith(`${casa}/`) ? REPO.slice(casa.length + 1) : null
  const negados = [
    `git -C ${REPO} switch fase-3.4/aurora-no-bolso`,
    `cd ${REPO} && git checkout main`,
    `cd ${REPO} && git reset --hard HEAD~1`,
    `cd ${REPO} && git pull`,
    ...(rel ? [`cd ~/${rel} && git checkout fase-3.4/x`, `cd ${rel}; git stash`] : []),
  ]
  for (const c of negados) {
    assert.equal(comandoMexeNaCopia(c, REPO, casa), true, c)
    const r = await podeUsarFerramenta('Bash', { command: c })
    assert.equal(r.behavior, 'deny', c)
    assert.match(r.message, /ferramenta fenix com a ação "trocar"/)
  }
  for (const c of [`cd ${REPO} && git log -5`, `git -C ${REPO} status`, 'git -C ~/outro-projeto checkout main', 'ls ~']) {
    assert.equal(comandoMexeNaCopia(c, REPO, casa), false, c)
  }
})

test('a ponte passa o comando ao gate: sem isso a trava não vê o Bash', () => {
  const fonte = readFileSync(new URL('../bridge/server.mjs', import.meta.url), 'utf8')
  assert.match(fonte, /canUseTool: podeUsarFerramenta,/)
  const gate = readFileSync(new URL('../bridge/gate.mjs', import.meta.url), 'utf8')
  assert.match(gate, /export async function podeUsarFerramenta\(toolName, input\)/)
})

test('a voz conhece a ação trocar, com a branch, e não a manda por executar_tarefa', () => {
  const fonte = readFileSync(new URL('../bridge/realtime.mjs', import.meta.url), 'utf8')
  assert.match(fonte, /enum: \['estado', 'rotina', 'trocar',/)
  assert.match(fonte, /Trocar de branch é\s+a ação "trocar" da fenix, nunca executar_tarefa/)
})
