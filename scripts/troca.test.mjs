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
import { criarTrocaDeVersao, nomeDaVersao, trocaParaAnunciar, textoDoFimDaTroca } from '../src/lib/trocaDeVersao.ts'

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
  assert.match(texto, /^Trocando para a fase-3\.4\/aurora-no-bolso\. Diga exatamente esta frase, e nada mais: "Reiniciando o sistema na versão 3\.4, aurora no bolso\. Já volto\."/)
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
  // E isso fica no eventos.log da Fênix, só como código: numa falha, o motivo está lá.
  assert.deepEqual(f.pedidos.at(-1), { acao: 'registrar-troca', codigo: 'sim-nao-ouvido', branch: 'fase-3.4/aurora-no-bolso' })
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
  assert.match(texto, /^Trocando para a main\. Diga exatamente esta frase, e nada mais: "Voltando para a versão principal\. Já volto\."/)
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
})

test('a branch como se fala: a main é a principal, a de fase vira número e nome', () => {
  assert.equal(nomeDaVersao('main'), 'principal')
  assert.equal(nomeDaVersao('fase-3.5/aviso-e-escolha'), '3.5, aviso e escolha')
  assert.equal(nomeDaVersao('fase-4/nova-era'), '4, nova era')
})

test('cada desfecho da troca tem a sua frase, e o erro oferece analisar os logs', () => {
  const base = { id: 't1', em: 1000 }
  const frase = (fim) => textoDoFimDaTroca({ ...base, ...fim }).match(/Diga exatamente esta frase: "([^"]+)"/)[1]
  // b — subiu na branch de fase
  assert.equal(
    frase({ ok: true, de: 'main', para: 'fase-3.5/aviso-e-escolha', branch: 'fase-3.5/aviso-e-escolha', mensagem: 'A fase-3.5/aviso-e-escolha está no ar.' }),
    'Reinicialização concluída: estou rodando a versão 3.5, aviso e escolha.',
  )
  // c — não ficou de pé e voltou sozinha para a main
  const erro = textoDoFimDaTroca({ ...base, ok: false, de: 'main', para: 'fase-3.5/aviso-e-escolha', branch: 'main', mensagem: 'A ponte não subiu. Voltei para a main.' })
  assert.match(erro, /"Erro de reinicialização: a versão 3\.5, aviso e escolha não ficou de pé, e eu voltei automaticamente para a versão principal\. Quer que eu analise os logs para entender o que deu errado\?"/)
  assert.match(erro, /executar_tarefa .*eventos\.log/)
  assert.match(erro, /só se ele perguntar: A ponte não subiu/)
  // d — de volta à main, como pedido
  assert.equal(frase({ ok: true, de: 'fase-3.5/aviso-e-escolha', para: 'main', branch: 'main', mensagem: 'A main está no ar.' }), 'Estou de volta à versão principal, como você pediu.')
  // a volta sozinha depois de quedas seguidas
  assert.match(
    frase({ ok: true, automatica: true, de: 'fase-3.5/aviso-e-escolha', para: 'main', mensagem: 'O serviço ponte caiu 3 vezes.' }),
    /^Alerta: a versão 3\.5, aviso e escolha caiu várias vezes seguidas, e eu voltei sozinho para a versão principal/,
  )
  // nada chegou a mudar
  assert.equal(
    frase({ ok: false, de: 'main', para: 'fase-3.5/aviso-e-escolha', branch: 'main', mensagem: 'Não consegui trocar para a fase-3.5/aviso-e-escolha: x. Nada foi trocado.' }),
    'Não consegui trocar para a versão 3.5, aviso e escolha; nada mudou, e eu continuo na versão principal.',
  )
  // não subiu nem voltou
  assert.match(frase({ ok: false, de: 'main', para: 'fase-3.5/x', mensagem: 'Não consegui trocar para a fase-3.5/x (a) nem voltar para a main (b).' }), /^Erro grave:/)
  // a mesma branch, trazida para o commit mais novo
  assert.equal(frase({ ok: true, de: 'fase-3.5/x', para: 'fase-3.5/x', mensagem: 'ok' }), 'Atualização concluída: a versão 3.5, x já está no commit mais novo.')
  // de uma fase para outra, a volta é para a de antes, não para a principal
  assert.match(frase({ ok: false, de: 'fase-3.4/y', para: 'fase-3.5/x', mensagem: 'caiu' }), /voltei automaticamente para a versão 3\.4, y, a de antes/)
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
