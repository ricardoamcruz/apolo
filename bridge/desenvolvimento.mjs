/**
 * O estado do desenvolvimento do A.P.O.L.O., para o popup do bom dia (RF-55).
 *
 * Fica na ponte, e não na A.U.R.O.R.A., porque é a ponte que roda dentro do
 * repositório: a A.U.R.O.R.A. pode estar em outra máquina e só vê o GitHub.
 */
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
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
