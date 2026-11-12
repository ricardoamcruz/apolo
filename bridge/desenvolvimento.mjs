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
