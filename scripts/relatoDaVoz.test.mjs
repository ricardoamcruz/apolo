/** Testes do retrato da voz no /health (bug crítico de 18/11/2026). */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SEM_INTERFACE_MS, criarRelatoDaVoz } from '../bridge/relatoDaVoz.mjs'

const relogio = () => {
  let t = 1_000_000
  return { agora: () => t, andar: (ms) => (t += ms) }
}

test('a sessão confirmada liga a voz; falhas seguidas contam uma vez por tentativa', () => {
  const r = criarRelatoDaVoz()
  r.interfaceEntrou()
  assert.equal(r.paraSaude().estado, 'sem relato')
  r.registrar('pedindo a sessão de voz à ponte')
  r.registrar('sessão confirmada pelo Google em 900 ms')
  assert.equal(r.paraSaude().estado, 'ligada')
  r.registrar('abrindo a conexão com o Google (retomada)')
  r.registrar('o Google não confirmou a sessão em 10 s')
  r.registrar('conexão fechada em 10000 ms: código 1006')
  assert.deepEqual([r.paraSaude().estado, r.paraSaude().falhas], ['falhando', 1])
})

test('sem nenhuma interface por um tempo, a voz não consta mais como ligada', () => {
  const c = relogio()
  const r = criarRelatoDaVoz({ agora: c.agora })
  r.interfaceEntrou()
  r.registrar('sessão confirmada pelo Google em 900 ms')
  r.interfaceSaiu()
  // Um recarregar da página não é alarme.
  c.andar(SEM_INTERFACE_MS - 1)
  assert.equal(r.paraSaude().estado, 'ligada')
  c.andar(1)
  const saude = r.paraSaude()
  assert.equal(saude.estado, 'sem interface')
  assert.match(saude.ultimo, /nenhuma interface/)
  // Ela volta: o último relato vale de novo, e o próximo diz o resto.
  r.interfaceEntrou()
  assert.equal(r.paraSaude().estado, 'ligada')
})

test('com duas interfaces, sair uma não é ficar sem interface', () => {
  const c = relogio()
  const r = criarRelatoDaVoz({ agora: c.agora })
  r.interfaceEntrou()
  r.interfaceEntrou()
  r.registrar('sessão confirmada pelo Google em 900 ms')
  r.interfaceSaiu()
  c.andar(SEM_INTERFACE_MS * 2)
  assert.equal(r.paraSaude().estado, 'ligada')
})

test('antes de a primeira interface chegar, segue sem relato (a partida não é alarme)', () => {
  const c = relogio()
  const r = criarRelatoDaVoz({ agora: c.agora })
  c.andar(SEM_INTERFACE_MS * 3)
  assert.equal(r.paraSaude().estado, 'sem relato')
})
