/**
 * Os temas de notícia editáveis por voz e o aviso da música (docs/adr/0039).
 * Tudo offline: nada de rede, e a escolha num arquivo temporário.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { avisoDaMusica } from '../src/avisos.mjs'
import { bomDia } from '../src/resumo.mjs'
import { criarTemas } from '../src/temas.mjs'

const CONFIG = {
  noticias: {
    porTema: 3,
    temas: [
      { nome: 'Tecnologia e IA', busca: 'inteligência artificial' },
      { nome: 'Games e cultura pop', busca: 'games OR videogame' },
    ],
  },
}
const pasta = () => mkdtempSync(join(tmpdir(), 'aurora-temas-'))

test('sem ninguém mudar nada, valem os temas do arquivo de configuração', () => {
  const temas = criarTemas({ pasta: pasta(), config: CONFIG })
  assert.deepEqual(temas.lista().map((t) => t.nome), ['Tecnologia e IA', 'Games e cultura pop'])
  assert.equal(temas.porTema(), 3)
  assert.equal(temas.estado().padrao, true)
})

test('"tira games do bom dia": parte do nome basta, e a escolha fica fora do repositório', () => {
  const casa = pasta()
  const arquivo = join(casa, 'noticias.json')
  const temas = criarTemas({ pasta: casa, config: CONFIG })
  const r = temas.editar({ tirar: 'games' })
  assert.equal(r.ok, true)
  assert.match(r.mensagem, /Tirei Games e cultura pop/)
  assert.deepEqual(r.temas.map((t) => t.nome), ['Tecnologia e IA'])
  assert.equal(temas.estado().padrao, false)
  // Persistiu: outra A.U.R.O.R.A. que suba agora lê a mesma escolha.
  assert.deepEqual(JSON.parse(readFileSync(arquivo, 'utf8')).temas, [{ nome: 'Tecnologia e IA', busca: 'inteligência artificial' }])
  assert.deepEqual(criarTemas({ pasta: casa, config: CONFIG }).lista().map((t) => t.nome), ['Tecnologia e IA'])
})

test('tema que não existe não tira nada, e a resposta diz quais existem', () => {
  const temas = criarTemas({ pasta: pasta(), config: CONFIG })
  const r = temas.editar({ tirar: 'esportes' })
  assert.equal(r.ok, false)
  assert.match(r.mensagem, /Tecnologia e IA, Games e cultura pop/)
  assert.equal(temas.lista().length, 2)
})

test('incluir aceita o nome e a busca, recusa repetido e recusa vazio', () => {
  const temas = criarTemas({ pasta: pasta(), config: CONFIG })
  assert.equal(temas.editar({ incluir: { nome: 'Esportes', busca: 'futebol OR Cruzeiro' } }).ok, true)
  assert.deepEqual(temas.lista().at(-1), { nome: 'Esportes', busca: 'futebol OR Cruzeiro' })
  assert.equal(temas.editar({ incluir: { nome: 'esportes', busca: 'x' } }).ok, false, 'repetido não entra de novo')
  assert.equal(temas.editar({ incluir: { nome: '  ' } }).ok, false)
  // Sem busca, o nome é a busca: é o que ele diria.
  const outro = criarTemas({ pasta: pasta(), config: CONFIG })
  outro.editar({ incluir: { nome: 'Fórmula 1' } })
  assert.deepEqual(outro.lista().at(-1), { nome: 'Fórmula 1', busca: 'Fórmula 1' })
})

test('quantas notícias por tema vai de 1 a 5, e voltar ao padrão apaga a escolha', () => {
  const casa = pasta()
  const temas = criarTemas({ pasta: casa, config: CONFIG })
  assert.equal(temas.editar({ porTema: 9 }).ok, false)
  assert.equal(temas.editar({ porTema: 0 }).ok, false)
  assert.equal(temas.editar({ porTema: 2 }).ok, true)
  assert.equal(temas.porTema(), 2)
  assert.equal(temas.editar({}).ok, false, 'sem dizer o que mudar, nada muda')
  const r = temas.editar({ restaurar: true })
  assert.equal(r.ok, true)
  assert.equal(temas.porTema(), 3)
  assert.equal(temas.estado().padrao, true)
  assert.equal(existsSync(join(casa, 'noticias.json')), false)
})

test('o bom dia busca os temas escolhidos, não os do arquivo', async () => {
  const temas = criarTemas({ pasta: pasta(), config: CONFIG })
  temas.editar({ tirar: 'games' })
  temas.editar({ porTema: 1 })
  const buscados = []
  const fetcher = async (url) => {
    buscados.push(String(url))
    return { ok: true, status: 200, text: async () => '<item><title>Uma notícia</title></item><item><title>Outra</title></item>' }
  }
  const r = await bomDia({ config: CONFIG, youtube: null, agendaIcs: undefined, noticias: temas.estado(), fetcher })
  assert.equal(buscados.length, 1, 'só o tema que sobrou')
  assert.match(buscados[0], /artificial/)
  assert.deepEqual(r.noticias.map((n) => n.tema), ['Tecnologia e IA'])
  assert.equal(r.noticias[0].itens.length, 1, 'uma notícia por tema')
})

test('a música avisa a mudança, nunca o mesmo problema de novo', () => {
  assert.equal(avisoDaMusica(null, null), null)
  const quebrou = avisoDaMusica(null, 'o YouTube recusou a autorização')
  assert.match(quebrou.texto, /autorização nova do YouTube/)
  assert.equal(avisoDaMusica('o YouTube recusou a autorização', 'o YouTube recusou a autorização'), null)
  assert.equal(avisoDaMusica('um problema', 'outro problema'), null, 'o primeiro aviso já contou')
  assert.match(avisoDaMusica('um problema', null).titulo, /a música voltou/)
  // Nada de mensagem de erro no aviso: o detalhe fica no log.
  const outro = avisoDaMusica(null, 'TypeError: fetch failed at node:internal/x.mjs:12')
  assert.doesNotMatch(outro.texto, /TypeError|node:internal/)
})
