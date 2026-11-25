/** Os popups do bom dia (RF-55): notícias, compromissos e desenvolvimento, em diagonal. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  PREFIXO_DO_BOM_DIA,
  descreverPopups,
  instrucaoDoBomDia,
  popupsDoBomDia,
  semOBomDia,
} from '../src/lib/bomDia.ts'
import { semAMusica } from '../bridge/aurora.mjs'

const COMPLETO = {
  noticias: [
    { tema: 'Tecnologia', itens: [{ titulo: 'IA <script>alert(1)</script>', fonte: 'Folha' }] },
    { tema: 'Vazio', itens: [] },
  ],
  agenda: { disponivel: true, eventos: [{ titulo: 'Daily', hora: '09:00', local: null }] },
  tarefas: { disponivel: true, prs: [{ number: 11, title: 'Bom dia', headRefName: 'fase-2.8/x', isDraft: false }], issues: [] },
  desenvolvimento: {
    branch: 'main',
    autodev: { fase: 'testando', pedido: 'mudar a cor', resultado: null },
    etapas: [{ etapa: 'Etapa 1', total: 5, itens: ['Validar a voz'] }],
  },
}

test('três popups, na ordem: notícias, compromissos e desenvolvimento', () => {
  const p = popupsDoBomDia(COMPLETO)
  assert.deepEqual(p.map((b) => b.title), ['NOTÍCIAS DO DIA', 'COMPROMISSOS', 'DESENVOLVIMENTO'])
  assert.deepEqual(p.map((b) => b.cascata), [0, 1, 2])
  for (const b of p) {
    assert.ok(b.id.startsWith(PREFIXO_DO_BOM_DIA))
    assert.equal(b.hold, 'sticky')
    assert.equal(b.kind, 'markup')
  }
  assert.match(p[2].html, /#11/)
  assert.match(p[2].html, /em teste/)
  assert.match(p[2].html, /e mais 4/)
  assert.doesNotMatch(p[1].html, /Vazio/)
})

test('o texto das fontes é escapado antes de virar markup', () => {
  const [noticias] = popupsDoBomDia(COMPLETO)
  assert.doesNotMatch(noticias.html, /<script>/)
  assert.match(noticias.html, /&lt;script&gt;/)
})

test('a narração é a mesma no PC e no celular, tirando a música (ADR 0037)', () => {
  const popups = popupsDoBomDia(COMPLETO)
  const resumo = { ...COMPLETO, ok: true, texto: 'Hoje é terça.\nTocando: Highway Star.', musica: { titulo: 'Highway Star' } }

  const pc = instrucaoDoBomDia(resumo, popups, 'pc')
  assert.match(pc, /notícias do dia, compromissos, desenvolvimento/)
  assert.match(pc, /tocando baixinho/)
  assert.match(pc, /não use ignorar_fala por causa da música/)

  // No celular o resumo chega sem a faixa, e a voz é instruída a não prometê-la.
  const celular = instrucaoDoBomDia(semAMusica(resumo), popups, 'celular')
  assert.doesNotMatch(celular, /Tocando:/)
  assert.doesNotMatch(celular, /ignorar_fala/)
  assert.match(celular, /só toca no computador/)
  assert.match(celular, /não anuncie música/)
  // Os dois dizem o que fazer com os popups e com o "obrigado".
  for (const texto of [pc, celular]) {
    assert.match(texto, /Se ele agradecer/)
    assert.match(texto, /popups "minimizar"/)
  }
})

test('o resumo do celular perde a música, e nem o motivo de faltar vai (ADR 0037)', () => {
  const comAviso = { ok: true, texto: 'Hoje é terça.', musica: null, avisoDaMusica: 'o YouTube não foi autorizado' }
  assert.deepEqual(semAMusica(comAviso), { ok: true, texto: 'Hoje é terça.', musica: null, avisoDaMusica: null })
  // A linha da faixa sai do texto narrado; o resto fica como está.
  const r = semAMusica({ ok: true, texto: 'Agenda: nada.\nTocando: Smoke, de Deep Purple.\nGitHub: 1 PR.', musica: { titulo: 'Smoke' } })
  assert.equal(r.texto, 'Agenda: nada.\nGitHub: 1 PR.')
  assert.equal(r.musica, null)
  // Sem texto, nada quebra: a A.U.R.O.R.A. pode responder só o motivo da falha.
  assert.equal(semAMusica({ ok: false, mensagem: 'a Aurora não está no ar' }).texto, undefined)
  assert.match(semOBomDia('a Aurora não está no ar'), /sem resumo/)
})

test('sem compromissos nem desenvolvimento, só as notícias, e a diagonal se fecha', () => {
  const p = popupsDoBomDia({
    noticias: COMPLETO.noticias,
    agenda: { disponivel: true, eventos: [] },
    tarefas: { disponivel: true, prs: [], issues: [] },
    desenvolvimento: { branch: 'main', autodev: { fase: 'ocioso', pedido: null, resultado: null }, etapas: [] },
  })
  assert.deepEqual(p.map((b) => [b.title, b.cascata]), [['NOTÍCIAS DO DIA', 0]])
  assert.equal(popupsDoBomDia({}).length, 0)
  assert.equal(descreverPopups([]), '')
})
