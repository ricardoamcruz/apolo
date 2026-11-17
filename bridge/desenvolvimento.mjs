/**
 * O estado do desenvolvimento do A.P.O.L.O., para o popup do bom dia (RF-55).
 *
 * Fica na ponte, e não na A.U.R.O.R.A., porque é a ponte que roda dentro do
 * repositório: a A.U.R.O.R.A. pode estar em outra máquina e só vê o GitHub.
 */
import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/**
 * As etapas com itens abertos em "Pendências em etapas" do roadmap. De cada item
 * fica o negrito que abre a linha, ou o trecho até o primeiro dois-pontos.
 */
export function pendenciasDoRoadmap(texto, maxPorEtapa = 4) {
  const secao = /^## Pendências em etapas[^\n]*\n([\s\S]*?)(?=^## )/m.exec(String(texto))?.[1] ?? ''
  const etapas = []
  for (const bloco of secao.split(/^### /m).slice(1)) {
    const [cabecalho, ...linhas] = bloco.split('\n')
    const abertos = linhas
      .filter((l) => /^- \[ \] /.test(l))
      .map((l) => {
        const item = l.slice(6)
        const negrito = /^\*\*(.+?)\*\*/.exec(item)?.[1]
        const texto = (negrito ?? item.split(/[:;(]/)[0]).replace(/[`*]/g, '').replace(/:$/, '').trim()
        return texto.length > 80 ? `${texto.slice(0, 79)}…` : texto
      })
    if (abertos.length) {
      etapas.push({ etapa: cabecalho.replace(/\s*\(.*\)\s*$/, '').trim(), total: abertos.length, itens: abertos.slice(0, maxPorEtapa) })
    }
  }
  return etapas
}

/** Branch no ar, autodev e roadmap. Uma parte que falha some; nunca rejeita. */
export async function estadoDoDesenvolvimento({ repo, autodev }) {
  const [branch, etapas] = await Promise.all([
    exec('git', ['symbolic-ref', '--short', '-q', 'HEAD'], { cwd: repo, timeout: 5000 })
      .then((r) => r.stdout.trim() || null)
      .catch(() => null),
    readFile(join(repo, 'docs/05-roadmap.md'), 'utf8')
      .then((t) => pendenciasDoRoadmap(t))
      .catch(() => []),
  ])
  const a = autodev?.ligado ? autodev : null
  return {
    branch,
    autodev: a && { fase: a.fase, pedido: a.pedido ?? null, resultado: a.resultado?.mensagem ?? null },
    etapas,
  }
}

/**
 * O backlog numerado, para o A.P.O.L.O. pegar uma tarefa pelo número, como o
 * Ricardo faz no chat do Claude ("faz o 1.3"). O número é a etapa e a posição do
 * item nela, contando também os feitos: marcar um item não renumera os outros.
 */
export function backlogDoRoadmap(texto) {
  const secao = /^## Pendências em etapas[^\n]*\n([\s\S]*?)(?=^## )/m.exec(String(texto))?.[1] ?? ''
  const itens = []
  secao.split(/^### /m).slice(1).forEach((bloco, i) => {
    const [cabecalho, ...linhas] = bloco.split('\n')
    const numero = /^Etapa (\d+)/.exec(cabecalho)?.[1] ?? String(i + 1)
    const etapa = cabecalho.replace(/\s*\(.*\)\s*$/, '').trim()
    let posicao = 0
    for (const linha of linhas) {
      const m = /^- \[( |x)\] (.+)$/.exec(linha)
      if (!m) continue
      posicao++
      if (m[1] === 'x') continue
      const titulo = (/^\*\*(.+?)\*\*/.exec(m[2])?.[1] ?? m[2].split(/[:;(]/)[0]).replace(/[`*]/g, '').replace(/:$/, '').trim()
      itens.push({ id: `${numero}.${posicao}`, etapa, titulo, texto: m[2].replace(/\*\*/g, '').trim() })
    }
  })
  return itens
}

/** O backlog em texto curto, para a voz ler e escolher. */
export function textoDoBacklog(itens, max = 12) {
  if (!itens.length) return 'O backlog do roadmap não tem itens abertos.'
  const linhas = itens.slice(0, max).map((i) => `${i.id} ${i.titulo}`)
  const resto = itens.length - linhas.length
  return `Itens abertos do backlog (número e título): ${linhas.join('; ')}${resto > 0 ? `; e mais ${resto}` : ''}.`
}

/**
 * O pedido ao agente para fazer um item do backlog: o texto inteiro do item e o
 * jeito de trabalhar que o Ricardo usa no chat, numa tarefa só.
 */
export function pedidoDaTarefa(item) {
  return (
    `Faça o item ${item.id} do backlog, em docs/05-roadmap.md ("${item.etapa}"): ${item.texto}\n\n` +
    'Trabalhe só nesse item, como numa tarefa pedida pelo chat: leia AGENTS.md e os documentos ' +
    'que ele indica para o assunto, implemente com testes, rode lint e build, e no mesmo commit ' +
    'atualize docs/05-roadmap.md (marque o item ou escreva o que ficou faltando), docs/01-requisitos.md ' +
    'e, se houver decisão de arquitetura, uma ADR nova. Se o item depende de algo que não está ao seu ' +
    'alcance (validar por voz, o iPhone, uma conta ou uma decisão do Ricardo), faça o que der e diga ' +
    'no resumo o que ficou para ele.'
  )
}

/* ------------------------------------------------------- registrar um bug */

const ROADMAP = 'docs/05-roadmap.md'
const BASE = 'main'
/** A etapa de bugs, achada pelo nome: o número dela pode mudar. */
const ETAPA_DE_BUGS = /^### Etapa \d+ — Bugs[^\n]*$/m

const umaLinha = (texto, max) =>
  String(texto ?? '')
    .replace(/[*`\r]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)

const hoje = (agora) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(agora)

/** A linha do backlog, no formato dos bugs que já estão lá. */
export function linhaDoBug({ titulo, detalhe }, agora = new Date()) {
  const t = umaLinha(titulo, 80).replace(/[.:]$/, '')
  if (!t) throw new Error('Falta o título do bug.')
  const d = umaLinha(detalhe, 600)
  return `- [ ] **${t} (${hoje(agora)}):**${d ? ` ${d}` : ''}`
}

/** Põe as linhas no fim da lista da etapa de bugs. */
export function incluirNoBacklog(texto, linhas) {
  const t = String(texto)
  const cabecalho = ETAPA_DE_BUGS.exec(t)
  if (!cabecalho) throw new Error('Não achei a etapa de bugs em docs/05-roadmap.md.')
  const inicio = cabecalho.index + cabecalho[0].length
  const proxima = t.slice(inicio).search(/^#{2,3} /m)
  const fim = proxima < 0 ? t.length : inicio + proxima
  const bloco = t.slice(inicio, fim).replace(/\s+$/, '')
  return `${t.slice(0, inicio)}${bloco}\n${linhas.join('\n')}\n${proxima < 0 ? '' : '\n'}${t.slice(fim)}`
}

/**
 * Registra um bug no backlog: a linha na etapa de bugs e um commit só do roadmap,
 * na branch no ar. Na `main` não há commit (nada vai direto para ela), e durante um
 * teste do autodev a cópia está na branch de teste: nos dois casos o bug fica em
 * `bugs-pendentes.md` e entra no próximo registro feito numa branch de fase.
 *
 * @returns {{ ok: boolean, mensagem: string }}. Nunca rejeita.
 */
export async function registrarBug({ repo, titulo, detalhe, emTeste = false, pasta = join(homedir(), '.apolo'), agora = new Date() }) {
  const git = async (...args) => (await exec('git', args, { cwd: repo, timeout: 15_000 })).stdout.trim()
  const pendentes = join(pasta, 'bugs-pendentes.md')
  let linha
  try {
    linha = linhaDoBug({ titulo, detalhe }, agora)
  } catch (err) {
    return { ok: false, mensagem: err.message }
  }
  try {
    const branch = await git('symbolic-ref', '--short', '-q', 'HEAD').catch(() => '')
    if (!branch || branch === BASE || emTeste) {
      await mkdir(pasta, { recursive: true })
      const antes = await readFile(pendentes, 'utf8').catch(() => '')
      await writeFile(pendentes, `${antes}${linha}\n`)
      const onde = emTeste ? 'há uma alteração em teste no ar' : `estou na ${branch || 'um commit solto'}, onde não faço commit`
      return {
        ok: true,
        mensagem: `Anotei o bug, mas ${onde}: ele entra no backlog no próximo registro feito numa branch de fase.`,
      }
    }
    if (await git('status', '--porcelain', '--', ROADMAP)) {
      return { ok: false, mensagem: 'O roadmap tem alterações não commitadas; não registrei para não levá-las junto.' }
    }
    // Os que ficaram anotados na main entram agora, antes deste.
    const anotados = (await readFile(pendentes, 'utf8').catch(() => '')).split('\n').filter((l) => l.startsWith('- [ ] '))
    const caminho = join(repo, ROADMAP)
    await writeFile(caminho, incluirNoBacklog(await readFile(caminho, 'utf8'), [...anotados, linha]))
    const resumo = umaLinha(titulo, 60)
    await git('commit', '-q', '-m', `Backlog: ${resumo}`, '--', ROADMAP)
    if (anotados.length) await rm(pendentes, { force: true })
    const extra = anotados.length ? ` Entraram também ${anotados.length} que estavam anotados.` : ''
    return { ok: true, mensagem: `Registrei no backlog, na etapa de bugs, com commit na ${branch}.${extra}` }
  } catch (err) {
    return { ok: false, mensagem: `Não consegui registrar: ${String(err.message).split('\n')[0]}` }
  }
}
