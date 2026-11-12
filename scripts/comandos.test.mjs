/** Testes dos comandos por voz (RF-20, ADR 0023). */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { COMANDOS, textoDosComandos } from '../bridge/comandos.mjs'
import { geminiSetup } from '../bridge/realtime.mjs'
import { agradece, pedeCancelamento, pedeModoMaos, vigiarCancelamento } from '../src/lib/comandos.ts'
import { ordenarPopups, vizinhoDoPopup } from '../src/lib/ordemDosPopups.ts'

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms))

test('toda tecla da interface tem comando por voz', () => {
  const teclas = new Set(COMANDOS.map((c) => c.tecla))
  assert.deepEqual([...teclas].sort(), ['D', 'E', 'Esc', 'Espaço', 'G', 'X', '[', ']'])
  for (const c of COMANDOS) assert.ok(c.faz && c.fala, c.tecla)
})

test('o celular só ouve falar do que existe nele', () => {
  const texto = textoDosComandos({ celular: true })
  assert.doesNotMatch(texto, /modo mãos|diagnóstico/)
  assert.match(texto, /próximo popup/)
  assert.match(textoDosComandos(), /modo mãos/)
})

test('as instruções levam a lista certa a cada canal', () => {
  const noPc = geminiSetup().systemInstruction.parts[0].text
  const noCelular = geminiSetup({ celular: true }).systemInstruction.parts[0].text
  assert.match(noPc, /ligar modo mãos/)
  assert.doesNotMatch(noCelular, /ligar modo mãos/)
})

test('o celular pode alternar popups, sem ganhar os outros ajustes', () => {
  const declaracoes = geminiSetup({ celular: true }).tools[0].functionDeclarations
  const ajuste = declaracoes.find((f) => f.name === 'ajustar_interface')
  assert.deepEqual(Object.keys(ajuste.parameters.properties).sort(), ['limpar_tela', 'popup', 'popups'])
  assert.ok(ajuste.parameters.properties.popups.enum.includes('tela_cheia'))
})

test('no celular, o desenvolvimento e a Fênix valem como no PC, confirmados pela fala (ADR 0030)', () => {
  const declaracoes = geminiSetup({ celular: true }).tools[0].functionDeclarations.map((f) => f.name)
  for (const nome of ['executar_tarefa', 'desenvolvimento', 'fenix', 'ajustar_interface', 'ignorar_fala', 'dormir']) {
    assert.ok(declaracoes.includes(nome), nome)
  }
  for (const nome of ['olhar_camera', 'diagnostico', 'bom_dia', 'musica']) assert.equal(declaracoes.includes(nome), false, nome)
  const texto = geminiSetup({ celular: true }).systemInstruction.parts[0].text
  assert.match(texto, /no celular não há botões de Confirmar ou\s+Aprovar/)
  assert.match(texto, /diga "confirmo"/)
})

test('cancelar exige que a frase inteira seja a ordem', () => {
  for (const fala of ['cancela', 'Cancela!', 'cancela a tarefa', 'Apolo, cancela isso', 'pode cancelar', 'deixa pra lá', 'para tudo', 'esquece essa pesquisa', 'cancela, por favor']) {
    assert.equal(pedeCancelamento(fala), true, fala)
  }
  for (const fala of ['cancela a reunião de amanhã', 'para o carro', 'não cancela', 'vou cancelar depois', 'para de ler o e-mail do João', '']) {
    assert.equal(pedeCancelamento(fala), false, fala)
  }
})

test('a câmera só liga com um pedido que fale dela', () => {
  for (const fala of ['ligar modo mãos', 'liga os gestos', 'ativa a câmera']) assert.equal(pedeModoMaos(fala), true, fala)
  for (const fala of ['abre aquele artigo', 'pode ligar', 'confirmo']) assert.equal(pedeModoMaos(fala), false, fala)
})

test('uma frase que continua não cancela', async () => {
  let cancelou = 0
  const vigia = vigiarCancelamento(() => cancelou++, 20)
  vigia.ouvir('cancela')
  vigia.ouvir('cancela a reunião')
  await esperar(40)
  assert.equal(cancelou, 0)

  vigia.ouvir('cancela')
  await esperar(40)
  assert.equal(cancelou, 1)

  vigia.ouvir('cancela')
  vigia.parar()
  await esperar(40)
  assert.equal(cancelou, 1)
})

test('o popup trazido para a frente vai para o topo', () => {
  const abertos = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  assert.deepEqual(ordenarPopups(abertos, null).map((p) => p.id), ['c', 'b', 'a'])
  assert.deepEqual(ordenarPopups(abertos, 'a').map((p) => p.id), ['a', 'c', 'b'])
})

test('alternar passa por todos os popups, nos dois sentidos', () => {
  const abertos = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const percorrer = (passo) => {
    const vistos = []
    let focado = null
    for (let i = 0; i < 3; i++) {
      const frente = ordenarPopups(abertos, focado)[0]
      focado = vizinhoDoPopup(abertos, frente.id, passo).id
      vistos.push(focado)
    }
    return vistos
  }
  assert.deepEqual(percorrer(1), ['b', 'a', 'c'])
  assert.deepEqual(percorrer(-1), ['a', 'b', 'c'])
  assert.equal(vizinhoDoPopup([{ id: 'a' }], 'a', 1), null)
})

test('"obrigado" sozinho encerra; agradecer e continuar o assunto, não', () => {
  for (const f of ['Obrigado.', 'obrigada, Apolo', 'valeu!', 'Ok, muito obrigado', 'Apolo, obrigado pelo resumo', 'brigado viu'])
    assert.equal(agradece(f), true, f)
  for (const f of ['obrigado, e a agenda de amanhã?', 'abre a segunda notícia', 'não precisa agradecer', 'obrigado por nada'])
    assert.equal(agradece(f), false, f)
})
