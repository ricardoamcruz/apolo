/** Testes das extensões plugáveis (docs/adr/0033): o manifesto, os arquivos e a voz. */

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import {
  PASTA_PADRAO,
  arquivoDaExtensao,
  carregarExtensoes,
  ferramentasDe,
  instrucoesDe,
  paraInterface,
  vigiarExtensoes,
} from '../bridge/plugaveis.mjs'
import { ferramentasDoCore, geminiSetup, registrarExtensoes, sessionConfig } from '../bridge/realtime.mjs'
import { montarSistemas, nomeFalado } from '../src/lib/sistemas.ts'

const pastas = []
after(() => Promise.all(pastas.map((p) => rm(p, { recursive: true, force: true }))))

async function pastaNova() {
  const p = await mkdtemp(join(tmpdir(), 'apolo-extensoes-'))
  pastas.push(p)
  return p
}

const ferramenta = (nome, extra = {}) => ({
  nome,
  permissao: 'livre',
  descricao: `faz ${nome}`,
  parametros: { type: 'object', properties: { x: { type: 'string' } } },
  ...extra,
})

async function criar(raiz, id, manifesto = {}, arquivos = { 'interface.js': 'export function ativar() {}' }) {
  const pasta = join(raiz, id)
  await mkdir(pasta, { recursive: true })
  await writeFile(
    join(pasta, 'apolo.extensao.json'),
    JSON.stringify({ apolo: '1', id, nome: id.toUpperCase(), versao: '1.0.0', interface: 'interface.js', ...manifesto }),
  )
  for (const [nome, corpo] of Object.entries(arquivos)) await writeFile(join(pasta, nome), corpo)
  return pasta
}

test('o A.T.L.A.S. do repositório carrega, com a ferramenta mapa livre', async () => {
  const lista = await carregarExtensoes({ pasta: PASTA_PADRAO, reservadas: ferramentasDoCore() })
  const atlas = lista.find((e) => e.id === 'atlas')
  assert.ok(atlas?.ok, atlas?.motivo)
  assert.equal(atlas.nome, 'A.T.L.A.S.')
  assert.deepEqual(atlas.ferramentas.map((f) => f.name), ['mapa'])
  assert.ok((await arquivoDaExtensao(lista, 'atlas', 'terra.bin'))?.corpo.subarray(0, 4).equals(Buffer.from('ATL1')))
})

test('uma extensão válida carrega e entrega a ferramenta e as instruções', async () => {
  const raiz = await pastaNova()
  await criar(raiz, 'relogio', { ferramentas: [ferramenta('hora_mundial')], instrucoes: 'Use para fusos.' })
  const lista = await carregarExtensoes({ pasta: raiz })
  assert.equal(lista.length, 1)
  assert.ok(lista[0].ok)
  assert.deepEqual(ferramentasDe(lista).map((f) => f.name), ['hora_mundial'])
  assert.equal(instrucoesDe(lista), 'RELOGIO: Use para fusos.')
  const [vista] = paraInterface(lista)
  assert.equal(vista.pasta, undefined, 'o caminho da máquina não vai para a interface')
  assert.match(vista.assinatura, /^[0-9a-z]+$/)
})

test('o manifesto que não bate não carrega, com o motivo, e não derruba as outras', async () => {
  const raiz = await pastaNova()
  await criar(raiz, 'boa')
  await criar(raiz, 'outra-pasta', { id: 'nome-diferente' })
  await criar(raiz, 'sem-arquivo', {}, {})
  await criar(raiz, 'contrato', { apolo: '9' })
  await mkdir(join(raiz, 'vazia'))
  await mkdir(join(raiz, '_rascunho'))
  const porId = Object.fromEntries((await carregarExtensoes({ pasta: raiz })).map((e) => [e.id, e]))
  assert.ok(porId.boa.ok)
  assert.match(porId['outra-pasta'].motivo, /não é o nome da pasta/)
  assert.match(porId['sem-arquivo'].motivo, /falta o arquivo/)
  assert.match(porId.contrato.motivo, /contrato/)
  assert.match(porId.vazia.motivo, /sem apolo\.extensao\.json/)
  assert.equal(porId._rascunho, undefined, 'pasta com _ fica de fora')
})

test('ferramenta com efeito no mundo não entra: o gate ainda não chega às extensões', async () => {
  const raiz = await pastaNova()
  await criar(raiz, 'email', { ferramentas: [ferramenta('enviar_email', { permissao: 'confirmar' })] })
  const [e] = await carregarExtensoes({ pasta: raiz })
  assert.equal(e.ok, false)
  assert.match(e.motivo, /só têm ferramentas livres/)
  assert.deepEqual(ferramentasDe([e]), [])
})

test('uma extensão não toma o nome de uma ferramenta do core nem de outra extensão', async () => {
  const raiz = await pastaNova()
  await criar(raiz, 'a-primeira', { ferramentas: [ferramenta('mostrar')] })
  await criar(raiz, 'b-segunda', { ferramentas: [ferramenta('mostrar')] })
  await criar(raiz, 'c-intrusa', { ferramentas: [ferramenta('executar_tarefa')] })
  const porId = Object.fromEntries(
    (await carregarExtensoes({ pasta: raiz, reservadas: ferramentasDoCore() })).map((e) => [e.id, e]),
  )
  assert.ok(porId['a-primeira'].ok)
  assert.match(porId['b-segunda'].motivo, /mostrar já existe/)
  assert.match(porId['c-intrusa'].motivo, /executar_tarefa já existe/)
})

test('só arquivos de tipo conhecido e de dentro da pasta da extensão são servidos', async () => {
  const raiz = await pastaNova()
  const pasta = await criar(raiz, 'mapa', {}, { 'interface.js': 'export function ativar() {}', 'dados.bin': 'x', 'rodar.sh': 'rm -rf /' })
  await writeFile(join(raiz, 'segredo.json'), '{"chave":1}')
  await symlink(join(raiz, 'segredo.json'), join(pasta, 'atalho.json'))
  await criar(raiz, 'quebrada', { apolo: '0' })
  const lista = await carregarExtensoes({ pasta: raiz })

  assert.equal((await arquivoDaExtensao(lista, 'mapa', 'interface.js'))?.tipo, 'text/javascript; charset=utf-8')
  assert.ok(await arquivoDaExtensao(lista, 'mapa', 'dados.bin'))
  assert.equal(await arquivoDaExtensao(lista, 'mapa', 'rodar.sh'), null, 'tipo que não é servido')
  assert.equal(await arquivoDaExtensao(lista, 'mapa', '../segredo.json'), null, 'subir de pasta')
  assert.equal(await arquivoDaExtensao(lista, 'mapa', 'atalho.json'), null, 'link que sai da pasta')
  assert.equal(await arquivoDaExtensao(lista, 'mapa', '.oculto.js'), null)
  assert.equal(await arquivoDaExtensao(lista, 'quebrada', 'interface.js'), null, 'extensão que não carregou')
  assert.equal(await arquivoDaExtensao(lista, 'nenhuma', 'interface.js'), null)
})

test('a voz do PC recebe as ferramentas e as instruções das extensões; a do celular, não', async () => {
  const raiz = await pastaNova()
  await criar(raiz, 'mapa-teste', { ferramentas: [ferramenta('marcar_teste')], instrucoes: 'Marque lugares.' })
  const lista = await carregarExtensoes({ pasta: raiz, reservadas: ferramentasDoCore() })
  registrarExtensoes({ ferramentas: () => ferramentasDe(lista), instrucoes: () => instrucoesDe(lista) })
  try {
    const nomes = (setup) => setup.tools[0].functionDeclarations.map((d) => d.name)
    const pc = geminiSetup()
    assert.ok(nomes(pc).includes('marcar_teste'))
    assert.match(pc.systemInstruction.parts[0].text, /EXTENSÕES[\s\S]*MAPA-TESTE: Marque lugares\./)
    const declarada = pc.tools[0].functionDeclarations.find((d) => d.name === 'marcar_teste')
    assert.equal(declarada.parameters.type, 'OBJECT', 'no formato do Gemini')

    const celular = geminiSetup({ celular: true })
    assert.ok(!nomes(celular).includes('marcar_teste'))
    assert.doesNotMatch(celular.systemInstruction.parts[0].text, /EXTENSÕES/)

    assert.ok(sessionConfig().tools.some((t) => t.name === 'marcar_teste'), 'na OpenAI também')
  } finally {
    registrarExtensoes({ ferramentas: () => [], instrucoes: () => '' })
  }
})

test('o ícone da aba vem da extensão: um .svg da pasta; inválido, fica a reserva', async () => {
  const raiz = await pastaNova()
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"/>'
  await criar(raiz, 'com-icone', { icone: 'icone.svg' }, { 'interface.js': 'export function ativar() {}', 'icone.svg': svg })
  await criar(raiz, 'icone-png', { icone: 'icone.png' }, { 'interface.js': 'export function ativar() {}', 'icone.png': 'x' })
  await criar(raiz, 'icone-sumido', { icone: 'nao-existe.svg' })
  await criar(raiz, 'icone-fora', { icone: '../com-icone/icone.svg' })
  const porId = Object.fromEntries(paraInterface(await carregarExtensoes({ pasta: raiz })).map((e) => [e.id, e]))
  assert.equal(porId['com-icone'].icone, 'icone.svg')
  for (const id of ['icone-png', 'icone-sumido', 'icone-fora']) {
    assert.ok(porId[id].ok, `${id} carrega mesmo sem ícone`)
    assert.equal(porId[id].icone, null)
  }
  const atlas = paraInterface(await carregarExtensoes({ pasta: PASTA_PADRAO })).find((e) => e.id === 'atlas')
  assert.equal(atlas.icone, 'icone.svg')
})

test('mudar a pasta avisa, uma vez, depois que as alterações param', async () => {
  const raiz = await pastaNova()
  let avisos = 0
  const parar = vigiarExtensoes(raiz, () => avisos++, 80)
  try {
    await criar(raiz, 'nova')
    await new Promise((pronto) => setTimeout(pronto, 400))
    assert.equal(avisos, 1)
  } finally {
    parar()
  }
})

test('cada extensão é uma linha na aba SISTEMAS, degradada com o motivo', () => {
  const sistemas = montarSistemas([], {
    ponte: true,
    voz: true,
    extensoes: [
      { id: 'atlas', nome: 'A.T.L.A.S.', ok: true, icone: 'https://localhost:8787/extensoes/atlas/icone.svg' },
      { id: 'velha', nome: 'velha', ok: false, motivo: 'contrato "0" diferente do 1' },
    ],
  })
  const atlas = sistemas.find((s) => s.id === 'extensao-atlas')
  assert.equal(atlas.tipo, 'extensao')
  assert.equal(atlas.degradado, false)
  assert.equal(atlas.icone, 'https://localhost:8787/extensoes/atlas/icone.svg')
  const velha = sistemas.find((s) => s.id === 'extensao-velha')
  assert.equal(velha.degradado, true)
  assert.deepEqual(velha.problemas, ['contrato "0" diferente do 1'])
  assert.equal(sistemas[0].degradado, false, 'uma extensão quebrada não degrada o C.O.R.E.')
  assert.equal(nomeFalado('A.T.L.A.S.'), 'Atlas')
})
