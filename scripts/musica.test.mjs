/** A música do bom dia: continuar a playlist no YouTube Music (RF-55, ADR 0026). */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { enderecoNoYoutube } from '../src/lib/musica.ts'

test('continuar a playlist abre a faixa na playlist dela, de onde parou', () => {
  const url = new URL(enderecoNoYoutube({ id: 'abc123', playlist: 'PL9', posicao: 78.6 }))
  assert.equal(url.origin, 'https://music.youtube.com')
  assert.deepEqual([url.searchParams.get('v'), url.searchParams.get('list'), url.searchParams.get('t')], ['abc123', 'PL9', '78s'])
})

test('sem playlist, abre só a faixa; posição negativa vira o começo', () => {
  const url = new URL(enderecoNoYoutube({ id: 'abc123', posicao: -3 }))
  assert.equal(url.searchParams.has('list'), false)
  assert.equal(url.searchParams.get('t'), '0s')
})
