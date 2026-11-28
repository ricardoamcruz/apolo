/**
 * A Fênix que renasce no código novo (docs/adr/0041): com Git, processos e canal
 * de mentira, para cobrir cada desfecho sem subir nada de verdade.
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { criarRenovacao } from '../src/renovar.mjs'

function montar({ head = 'b', mudou = 'fenix/src/versoes.mjs', respondeu = async () => true, ultimoRecurso = null, ocupado = () => false } = {}) {
  const passos = []
  const subidas = []
  const ren = criarRenovacao({
    git: async (...a) => {
      if (a[0] === 'rev-parse') return head
      if (a[0] === 'diff') return a.includes('a') ? mudou : ''
      return ''
    },
    shaDaPartida: 'a',
    caminhos: ['fenix', 'fenix.config.json'],
    receita: { comando: ['node', 'fenix/fenix.mjs', '--writes'], cwd: '/x', saida: join(mkdtempSync(join(tmpdir(), 'renovar-')), 'fenix.log'), env: { A: '1' } },
    ocupado,
    encerrar: async () => passos.push('encerrar'),
    retomar: async () => passos.push('retomar'),
    respondeu,
    ultimoRecurso,
    existe: () => true,
    anotar: (l) => passos.push(l),
    avisar: (t) => passos.push(`aviso: ${t}`),
    sair: () => passos.push('sair'),
    spawn: (comando, args, opcoes) => {
      subidas.push({ comando, args, opcoes })
      return { pid: 99999999, unref() {} }
    },
    prazoMs: 50,
    intervaloMs: 5,
  })
  return { ren, passos, subidas }
}

test('o código da Fênix mudou: derruba, sobe a nova no código novo e sai quando ela responde', async () => {
  const { ren, passos, subidas } = montar()
  assert.equal(await ren.talvez(), true)
  assert.equal(passos[1], 'encerrar')
  assert.equal(passos.at(-1), 'sair')
  assert.equal(subidas.length, 1)
  assert.deepEqual(subidas[0].args, ['fenix/fenix.mjs', '--writes'])
  assert.equal(subidas[0].opcoes.detached, true)
  assert.equal(subidas[0].opcoes.env.FENIX_RENOVADA, '1')
  assert.equal(subidas[0].opcoes.env.A, '1')
})

test('nada da Fênix mudou, ou nada mudou de commit: não renasce', async () => {
  assert.equal(await montar({ mudou: '' }).ren.talvez(), false)
  const mesma = montar({ head: 'a' })
  assert.equal(await mesma.ren.talvez(), false)
  assert.equal(mesma.subidas.length, 0)
})

test('com uma troca ou um teste em andamento, espera', async () => {
  const { ren, subidas } = montar({ ocupado: () => true })
  assert.equal(await ren.talvez(), false)
  assert.equal(subidas.length, 0)
})

test('a nova não ficou de pé e há âncora: chama a âncora e sai', async () => {
  const { ren, passos, subidas } = montar({ respondeu: async () => false, ultimoRecurso: ['/usr/local/bin/ancora', '--panico'] })
  assert.equal(await ren.talvez(), false)
  assert.equal(subidas.length, 2)
  assert.equal(subidas[1].comando, '/usr/local/bin/ancora')
  assert.deepEqual(subidas[1].args, ['--panico', '--origem', 'fenix', '--motivo', 'a Fênix nova não ficou de pé'])
  assert.equal(passos.at(-1), 'sair')
  assert.ok(passos.some((p) => /aviso: .*âncora/.test(p)))
})

test('a nova não ficou de pé e não há âncora: a antiga retoma o posto e não tenta de novo o mesmo commit', async () => {
  const { ren, passos, subidas } = montar({ respondeu: async () => false })
  assert.equal(await ren.talvez(), false)
  assert.ok(passos.includes('retomar'))
  assert.ok(!passos.includes('sair'))
  assert.equal(ren.renovando(), false)
  assert.equal(await ren.talvez(), false)
  assert.equal(subidas.length, 1)
})
