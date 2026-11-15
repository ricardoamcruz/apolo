/** Testes da conversa contínua depois do nome (ADR 0024). */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { criarJanela } from '../src/lib/conversa.ts'

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms))
const tempos = { janelaMs: 30, prorrogacaoMs: 20 }

test('sem nada dirigido a ele, a conversa fecha', async () => {
  let fechou = 0
  const janela = criarJanela(() => fechou++, () => 'nao', tempos)
  janela.abrir()
  await esperar(50)
  assert.equal(fechou, 1)
})

test('uma fala ignorada não estende a janela', async () => {
  let fechou = 0
  const janela = criarJanela(() => fechou++, () => 'nao', tempos)
  janela.abrir()
  await esperar(20)
  janela.garantir()
  await esperar(20)
  assert.equal(fechou, 1)
})

test('uma resposta dele reabre a janela inteira', async () => {
  let fechou = 0
  const janela = criarJanela(() => fechou++, () => 'nao', tempos)
  janela.abrir()
  await esperar(20)
  janela.abrir()
  await esperar(20)
  assert.equal(fechou, 0)
  await esperar(20)
  assert.equal(fechou, 1)
})

test('com a TV falando sem parar, prorroga uma vez só', async () => {
  let fechou = 0
  const janela = criarJanela(() => fechou++, () => 'talvez', tempos)
  janela.abrir()
  await esperar(40)
  assert.equal(fechou, 0)
  await esperar(30)
  assert.equal(fechou, 1)
})

test('falando ou numa tarefa, ele não dorme', async () => {
  let fechou = 0
  let ocupado = 'sim'
  const janela = criarJanela(() => fechou++, () => ocupado, tempos)
  janela.abrir()
  await esperar(100)
  assert.equal(fechou, 0)
  ocupado = 'nao'
  await esperar(30)
  assert.equal(fechou, 1)
})

test('pausada, não fecha', async () => {
  let fechou = 0
  const janela = criarJanela(() => fechou++, () => 'nao', tempos)
  janela.abrir()
  janela.pausar()
  await esperar(50)
  assert.equal(fechou, 0)
})

test('uma fala ainda sem resposta segura a conversa até o modelo decidir', async () => {
  let fechou = 0
  let ocupado = 'decidindo'
  const janela = criarJanela(() => fechou++, () => ocupado, { ...tempos, esperaDaDecisaoMs: 200 })
  janela.abrir()
  // Passa da janela e de várias prorrogações: o modelo ainda não respondeu.
  await esperar(120)
  assert.equal(fechou, 0)
  // Ele ignorou a fala: a conversa fecha na próxima conferência.
  ocupado = 'nao'
  await esperar(40)
  assert.equal(fechou, 1)
})

test('esperar a decisão tem teto: a TV, frase atrás de frase, não o mantém acordado', async () => {
  let fechou = 0
  const janela = criarJanela(() => fechou++, () => 'decidindo', { ...tempos, esperaDaDecisaoMs: 60 })
  janela.abrir()
  await esperar(70)
  assert.equal(fechou, 0)
  await esperar(50)
  assert.equal(fechou, 1)
})

test('o teto da decisão conta a partir de quando ele ficou livre, não da abertura', async () => {
  let fechou = 0
  let ocupado = 'sim'
  const janela = criarJanela(() => fechou++, () => ocupado, { ...tempos, esperaDaDecisaoMs: 60 })
  janela.abrir()
  // Muito tempo ocupado (os popups do bom dia, por exemplo) não gasta o teto.
  await esperar(150)
  ocupado = 'decidindo'
  await esperar(40)
  assert.equal(fechou, 0)
})
