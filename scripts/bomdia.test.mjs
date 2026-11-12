/** Os popups do bom dia (RF-55): notícias, compromissos e desenvolvimento, em diagonal. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PREFIXO_DO_BOM_DIA, descreverPopups, popupsDoBomDia } from '../src/lib/bomDia.ts'

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
