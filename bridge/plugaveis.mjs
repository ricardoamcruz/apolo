/**
 * Extensões plugáveis (docs/adr/0033).
 *
 * Uma extensão é uma pasta em `extensoes/<id>/` com um manifesto
 * (`apolo.extensao.json`) e os arquivos que ele cita. Trocar a pasta troca a
 * extensão: nada é recompilado, e a interface recarrega só aquela extensão.
 *
 * Esta ponte só lê manifestos, serve os arquivos da pasta e entrega à voz as
 * ferramentas declaradas. Ela não executa código de extensão nenhum: quem roda o
 * módulo da interface é o navegador, com a API que o A.P.O.L.O. lhe passa
 * (src/lib/plugaveis.ts).
 *
 * Por enquanto, uma extensão só declara ferramentas `livre` (sem efeito no mundo:
 * mostrar, calcular, desenhar). Ferramenta que envia, apaga ou liga algo tem de
 * passar pelo gate, e esse caminho ainda não existe para extensões: o manifesto que
 * pedir outra coisa não carrega.
 *
 * Arquivo sensível (bridge/autodev/politica.mjs): decide o que a página carrega.
 */

import { existsSync, watch } from 'node:fs'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { extname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MANIFESTO = 'apolo.extensao.json'
export const CONTRATO = '1'

/** Onde ficam, salvo outra pasta em APOLO_EXTENSOES_PASTA. */
export const PASTA_PADRAO = fileURLToPath(new URL('../extensoes', import.meta.url))

const ID = /^[a-z][a-z0-9-]{0,31}$/
const FERRAMENTA = /^[a-z][a-z0-9_]{0,47}$/
const ARQUIVO = /^[a-z0-9][a-z0-9._-]{0,63}$/i
const MAX_BYTES = 8 * 1024 * 1024
const MAX_INSTRUCOES = 1500
const MAX_FERRAMENTAS = 8

/** O que pode ser servido, e com que tipo. Nada que o navegador execute fora do módulo. */
export const TIPOS = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
}

/**
 * Lê e valida um manifesto. Devolve a extensão pronta ou o motivo, em palavras,
 * de ela não carregar (vai para a aba SISTEMAS).
 *
 * @param {string} pasta a pasta da extensão
 * @param {Set<string>} reservadas nomes de ferramenta que já existem
 */
export async function lerExtensao(pasta, reservadas = new Set()) {
  const id = pasta.split(sep).at(-1)
  const falha = (motivo, nome = id) => ({ id, nome, ok: false, motivo })
  if (!ID.test(id)) return falha('nome de pasta inválido (letras minúsculas, números e hífen)')

  let m
  try {
    m = JSON.parse(await readFile(join(pasta, MANIFESTO), 'utf8'))
  } catch (err) {
    return falha(err.code === 'ENOENT' ? `sem ${MANIFESTO}` : 'manifesto não é um JSON válido')
  }
  if (!m || typeof m !== 'object') return falha('manifesto vazio')
  const nome = typeof m.nome === 'string' && m.nome.trim() ? m.nome.trim().slice(0, 40) : id
  if (String(m.apolo) !== CONTRATO) return falha(`contrato "${m.apolo}" diferente do ${CONTRATO}`, nome)
  if (m.id !== id) return falha(`o id do manifesto (${m.id}) não é o nome da pasta`, nome)
  if (typeof m.interface !== 'string' || !ARQUIVO.test(m.interface) || !/\.m?js$/.test(m.interface)) {
    return falha('"interface" precisa ser um arquivo .js da própria pasta', nome)
  }
  if (!existsSync(join(pasta, m.interface))) return falha(`falta o arquivo ${m.interface}`, nome)

  const brutas = m.ferramentas ?? []
  if (!Array.isArray(brutas) || brutas.length > MAX_FERRAMENTAS) {
    return falha(`"ferramentas" precisa ser uma lista de até ${MAX_FERRAMENTAS}`, nome)
  }
  const ferramentas = []
  for (const f of brutas) {
    if (!FERRAMENTA.test(f?.nome ?? '')) return falha(`ferramenta com nome inválido: ${f?.nome}`, nome)
    if (reservadas.has(f.nome)) return falha(`a ferramenta ${f.nome} já existe`, nome)
    if (f.permissao !== 'livre') {
      return falha(`a ferramenta ${f.nome} pede "${f.permissao}": extensões só têm ferramentas livres por enquanto`, nome)
    }
    if (typeof f.descricao !== 'string' || !f.descricao.trim()) return falha(`a ferramenta ${f.nome} não tem descrição`, nome)
    const parametros = f.parametros ?? { type: 'object', properties: {} }
    if (parametros.type !== 'object') return falha(`os parâmetros de ${f.nome} precisam ser um objeto`, nome)
    ferramentas.push({ type: 'function', name: f.nome, description: f.descricao.trim(), parameters: parametros })
  }

  // O ícone da aba SISTEMAS: um .svg da pasta. Inválido ou ausente, fica a reserva.
  const icone =
    typeof m.icone === 'string' && ARQUIVO.test(m.icone) && m.icone.endsWith('.svg') && existsSync(join(pasta, m.icone))
      ? m.icone
      : null

  const instrucoes = typeof m.instrucoes === 'string' ? m.instrucoes.trim() : ''
  if (instrucoes.length > MAX_INSTRUCOES) return falha(`"instrucoes" passa de ${MAX_INSTRUCOES} caracteres`, nome)

  return {
    id,
    nome,
    ok: true,
    pasta,
    versao: typeof m.versao === 'string' ? m.versao : '0.0.0',
    descricao: typeof m.descricao === 'string' ? m.descricao : '',
    interface: m.interface,
    icone,
    ferramentas,
    instrucoes,
    // Muda a cada alteração de qualquer arquivo: é o que faz a interface recarregar.
    assinatura: await assinatura(pasta),
  }
}

/** A data da última alteração na pasta, em milissegundos. */
async function assinatura(pasta) {
  let maior = 0
  for (const entrada of await readdir(pasta, { withFileTypes: true, recursive: true })) {
    if (!entrada.isFile()) continue
    const { mtimeMs } = await stat(join(entrada.parentPath ?? entrada.path, entrada.name))
    if (mtimeMs > maior) maior = mtimeMs
  }
  return Math.round(maior).toString(36)
}

/**
 * Todas as extensões da pasta. Uma que falhe não impede as outras (RNF-07).
 *
 * @param {{ pasta?: string, reservadas?: Iterable<string> }} opcoes
 */
export async function carregarExtensoes({ pasta = PASTA_PADRAO, reservadas = [] } = {}) {
  let nomes = []
  try {
    nomes = (await readdir(pasta, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_'))
      .map((d) => d.name)
      .sort()
  } catch {
    return []
  }
  const usadas = new Set(reservadas)
  const lista = []
  for (const nome of nomes) {
    const ext = await lerExtensao(join(pasta, nome), usadas)
    if (ext.ok) for (const f of ext.ferramentas) usadas.add(f.name)
    lista.push(ext)
  }
  return lista
}

/** O que a interface precisa saber, sem caminhos da máquina. */
export const paraInterface = (lista) =>
  lista.map((e) =>
    e.ok
      ? {
          id: e.id,
          nome: e.nome,
          ok: true,
          versao: e.versao,
          interface: e.interface,
          icone: e.icone,
          assinatura: e.assinatura,
          ferramentas: e.ferramentas.map((f) => f.name),
        }
      : { id: e.id, nome: e.nome, ok: false, motivo: e.motivo },
  )

/**
 * Acha um arquivo de uma extensão para servir. Só arquivos de tipo conhecido, só
 * dentro da pasta dela, com os links resolvidos antes de julgar.
 *
 * @returns {Promise<{ corpo: Buffer, tipo: string } | null>}
 */
export async function arquivoDaExtensao(lista, id, caminho) {
  const ext = lista.find((e) => e.ok && e.id === id)
  if (!ext) return null
  const partes = String(caminho ?? '').split('/')
  if (!partes.length || partes.some((p) => !ARQUIVO.test(p) || p.startsWith('.'))) return null
  const tipo = TIPOS[extname(caminho).toLowerCase()]
  if (!tipo) return null
  try {
    const raiz = await realpath(ext.pasta)
    const real = await realpath(join(ext.pasta, ...partes))
    if (!real.startsWith(raiz + sep)) return null
    const info = await stat(real)
    if (!info.isFile() || info.size > MAX_BYTES) return null
    return { corpo: await readFile(real), tipo }
  } catch {
    return null
  }
}

/** As ferramentas de todas as extensões que carregaram, para a sessão de voz. */
export const ferramentasDe = (lista) => lista.filter((e) => e.ok).flatMap((e) => e.ferramentas)

/** As instruções de cada extensão, com o nome dela, para a fala do modelo. */
export const instrucoesDe = (lista) =>
  lista
    .filter((e) => e.ok && e.instrucoes)
    .map((e) => `${e.nome}: ${e.instrucoes}`)
    .join('\n')

/**
 * Vigia a pasta e chama `aoMudar` depois que as alterações param por um instante:
 * copiar uma pasta inteira dispara dezenas de eventos.
 */
export function vigiarExtensoes(pasta, aoMudar, esperaMs = 400) {
  if (!existsSync(pasta)) return () => {}
  let timer = null
  let vigia
  try {
    vigia = watch(pasta, { recursive: true }, () => {
      clearTimeout(timer)
      timer = setTimeout(aoMudar, esperaMs)
    })
  } catch {
    return () => {}
  }
  vigia.on('error', () => {})
  return () => {
    clearTimeout(timer)
    vigia.close()
  }
}
