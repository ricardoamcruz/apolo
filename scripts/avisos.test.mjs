/**
 * O A.P.O.L.O. pedindo notificações ao H.E.R.M.E.S. (docs/adr/0039) e os temas de
 * notícia por voz. Sem rede e sem abrir porta: aqui só as decisões.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { textoDosTemas } from '../bridge/aurora.mjs'
import { avisoDoAutodev, criarAvisos, textoDoAviso } from '../bridge/avisos.mjs'
import { geminiSetup } from '../bridge/realtime.mjs'
import { pedidoDosTemas } from '../src/lib/noticias.ts'

test('o aviso não leva rastro de erro, código nem saída de comando', () => {
  const bruto = [
    'A alteração não passou nas checagens.',
    'O lint reclamou de um arquivo.',
    'TypeError: x is not a function',
    '    at trabalhar (file:///Users/ricardo/apolo/bridge/autodev/index.mjs:420:11)',
    'Command failed: npm run lint',
  ].join('\n')
  const texto = textoDoAviso(bruto)
  assert.equal(texto, 'A alteração não passou nas checagens. O lint reclamou de um arquivo.')
  assert.equal(textoDoAviso('    at algo (file:///x.mjs:1:1)'), 'Os detalhes ficaram no log.')
  assert.equal(textoDoAviso(`${'a'.repeat(400)}`).length, 300)
})

test('o autodesenvolvimento avisa o que termina sozinho, e só a mudança avisa', () => {
  const trabalhando = { fase: 'trabalhando' }
  const emTeste = { fase: 'testando', resumo: 'Troquei a cor do anel.' }
  const aviso = avisoDoAutodev(trabalhando, emTeste)
  assert.match(aviso.titulo, /alteração em teste/)
  assert.match(aviso.texto, /Troquei a cor do anel\./)
  assert.equal(aviso.prioridade, 'alta')
  assert.equal(avisoDoAutodev(emTeste, { ...emTeste, etapa: 'outra' }), null, 'ainda em teste: não avisa de novo')

  const revisao = { fase: 'ocioso', resultado: { id: '7', tipo: 'revisao', mensagem: 'Ficou numa branch para revisão.' } }
  assert.match(avisoDoAutodev(emTeste, revisao).titulo, /revisão/)
  assert.equal(avisoDoAutodev(revisao, { ...revisao }), null, 'o mesmo resultado não avisa duas vezes')

  const falhou = { fase: 'ocioso', resultado: { id: '8', tipo: 'falhou', mensagem: 'O agente parou antes de terminar.' } }
  assert.equal(avisoDoAutodev(revisao, falhou).prioridade, 'normal')
  // O que parte dele, com ele na frente da tela, não volta como notificação.
  for (const tipo of ['aprovado', 'cancelado', 'revertido']) {
    assert.equal(avisoDoAutodev(emTeste, { fase: 'ocioso', resultado: { id: '9', tipo, mensagem: 'x' } }), null, tipo)
  }
  assert.equal(avisoDoAutodev(null, { fase: 'ocioso' }), null)
})

test('sem central configurada, avisar responde que não há e nunca rejeita', async () => {
  const avisos = criarAvisos({ url: '', token: '' })
  assert.equal(avisos.configurada(), false)
  const r = await avisos.avisar({ titulo: 'Oi', texto: 'x' })
  assert.equal(r.ok, false)
  assert.match(r.mensagem, /central de notificações/)
})

test('a central fora do ar não derruba quem avisa', async () => {
  const avisos = criarAvisos({ url: 'http://127.0.0.1:1/notificar', token: 't'.repeat(40), log() {} })
  assert.equal(avisos.configurada(), true)
  const r = await avisos.avisar({ titulo: 'Oi', texto: 'x' })
  assert.equal(r.ok, false)
})

test('a ferramenta noticias vira pedido à A.U.R.O.R.A., ou uma frase quando falta o tema', () => {
  assert.deepEqual(pedidoDosTemas({ acao: 'listar' }), { listar: true })
  assert.deepEqual(pedidoDosTemas({ acao: 'tirar', tema: 'games' }), { tirar: 'games' })
  assert.deepEqual(pedidoDosTemas({ acao: 'incluir', tema: 'Esportes', busca: 'futebol OR Cruzeiro' }), {
    incluir: { nome: 'Esportes', busca: 'futebol OR Cruzeiro' },
  })
  assert.deepEqual(pedidoDosTemas({ acao: 'incluir', tema: 'Esportes' }), { incluir: { nome: 'Esportes', busca: 'Esportes' } })
  assert.deepEqual(pedidoDosTemas({ acao: 'quantidade', quantidade: 2 }), { porTema: 2 })
  assert.deepEqual(pedidoDosTemas({ acao: 'padrao' }), { restaurar: true })
  assert.equal(typeof pedidoDosTemas({ acao: 'tirar' }), 'string')
  assert.equal(typeof pedidoDosTemas({ acao: 'quantidade' }), 'string')
  assert.equal(typeof pedidoDosTemas({ acao: 'dançar' }), 'string')
})

test('a voz conta os temas sem ler os termos de busca', () => {
  const texto = textoDosTemas({ temas: [{ nome: 'Tecnologia e IA', busca: 'inteligência artificial OR tecnologia' }], porTema: 1, padrao: false })
  assert.match(texto, /Temas do bom dia: Tecnologia e IA; 1 notícia por tema/)
  assert.doesNotMatch(texto, /OR/)
  assert.match(textoDosTemas({ temas: [] }), /Não há nenhum tema/)
})

test('mudar os temas por voz vale no computador e no celular', () => {
  for (const celular of [false, true]) {
    const declaracoes = geminiSetup({ celular }).tools[0].functionDeclarations
    const noticias = declaracoes.find((f) => f.name === 'noticias')
    assert.ok(noticias, celular ? 'celular' : 'PC')
    assert.deepEqual(noticias.parameters.properties.acao.enum, ['listar', 'tirar', 'incluir', 'quantidade', 'padrao'])
  }
  assert.match(geminiSetup().systemInstruction.parts[0].text, /tira games do bom dia/)
})
