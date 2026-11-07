/**
 * Registro das medições do app do celular (docs/adr/0020).
 *
 * O app mede a conexão e manda os números pelo canal autenticado, e eles ficam em
 * `~/.apolo/logs/celular-AAAA-MM-DD.jsonl`, um evento por linha. Consulte com
 * `npm run logs:celular`.
 *
 * O que chega aqui vem pela rede, então só passam nome, duração e rótulos curtos.
 * Nunca o que foi dito, e nada que possa levar um token ou um endereço: o log serve
 * para achar lentidão, não para guardar conversa.
 */

import { appendFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const PASTA_DE_LOGS = process.env.APOLO_LOGS ?? join(homedir(), '.apolo', 'logs')
/** O app manda em lotes; um lote maior que isto não é o app. */
export const MAX_EVENTOS = 100
const MAX_MS = 3_600_000
const MAX_BYTES_POR_DIA = 5 * 1024 * 1024
const DIAS_GUARDADOS = 14
const REDES = new Set(['wifi', 'celular', 'outra', 'sem_rede'])
const NOME = /^[a-z][a-z_]{0,31}$/
/** Sem barra, `=` nem `@`: um rótulo não tem como carregar URL ou chave. */
const ROTULO = /^[\w .:-]{1,40}$/

const arquivoDoDia = (pasta, quando) => {
  const d = new Date(quando)
  const dois = (n) => String(n).padStart(2, '0')
  return join(pasta, `celular-${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}.jsonl`)
}

/** Devolve só os campos conhecidos e válidos, ou null se não for um evento. */
export function limparEvento(bruto, agora = Date.now()) {
  if (typeof bruto?.nome !== 'string' || !NOME.test(bruto.nome)) return null
  const t = Number.isFinite(bruto.t) && bruto.t > 0 ? Math.round(bruto.t) : agora
  const evento = { t, nome: bruto.nome }
  if (Number.isFinite(bruto.ms) && bruto.ms >= 0 && bruto.ms <= MAX_MS) evento.ms = Math.round(bruto.ms)
  if (typeof bruto.info === 'string' && ROTULO.test(bruto.info)) evento.info = bruto.info
  if (REDES.has(bruto.rede)) evento.rede = bruto.rede
  return evento
}

export function criarTelemetria({
  pasta = PASTA_DE_LOGS,
  maxBytes = MAX_BYTES_POR_DIA,
  dias = DIAS_GUARDADOS,
  agora = Date.now,
} = {}) {
  let pronta = false

  const preparar = () => {
    if (pronta) return
    pronta = true
    mkdirSync(pasta, { recursive: true, mode: 0o700 })
    const limite = agora() - dias * 86_400_000
    for (const nome of readdirSync(pasta)) {
      const arquivo = join(pasta, nome)
      if (/^celular-.*\.jsonl$/.test(nome) && statSync(arquivo).mtimeMs < limite) rmSync(arquivo)
    }
  }

  const gravar = (eventos) => {
    if (!eventos.length) return
    try {
      preparar()
      const arquivo = arquivoDoDia(pasta, agora())
      let tamanho = 0
      try {
        tamanho = statSync(arquivo).size
      } catch {
        /* primeiro evento do dia */
      }
      if (tamanho >= maxBytes) return
      const linhas = eventos.map((e) => JSON.stringify(e)).join('\n') + '\n'
      appendFileSync(arquivo, linhas, { mode: 0o600 })
    } catch (err) {
      // Medir nunca pode derrubar o que está sendo medido.
      console.warn(`[apolo] não foi possível gravar a telemetria: ${err.message}`)
    }
  }

  return {
    /** O lote que veio do app. Lixo é descartado em silêncio. */
    registrar: (eventos) => {
      if (!Array.isArray(eventos)) return
      const momento = agora()
      gravar(
        eventos
          .slice(0, MAX_EVENTOS)
          .map((e) => limparEvento(e, momento))
          .filter(Boolean)
          .map((e) => ({ ...e, origem: 'app' })),
      )
    },
    /** Um evento medido aqui na ponte. */
    evento: (nome, ms, info) => {
      const limpo = limparEvento({ nome, ms, info }, agora())
      if (limpo) gravar([{ ...limpo, origem: 'ponte' }])
    },
  }
}

export function lerEventos({ pasta = PASTA_DE_LOGS, desde = 0 } = {}) {
  let nomes = []
  try {
    nomes = readdirSync(pasta).filter((n) => /^celular-.*\.jsonl$/.test(n)).sort()
  } catch {
    return []
  }
  const eventos = []
  for (const nome of nomes) {
    for (const linha of readFileSync(join(pasta, nome), 'utf8').split('\n')) {
      if (!linha) continue
      try {
        const evento = JSON.parse(linha)
        if (evento.t >= desde) eventos.push(evento)
      } catch {
        /* linha cortada: o resto do arquivo ainda vale */
      }
    }
  }
  return eventos
}

const percentil = (ordenados, p) => ordenados[Math.min(ordenados.length - 1, Math.floor(ordenados.length * p))]

/** Uma linha por medida e por rede, para comparar Wi-Fi com dados móveis. */
export function resumir(eventos) {
  const grupos = new Map()
  for (const { nome, ms, rede } of eventos) {
    if (ms === undefined) continue
    const chave = `${nome}\t${rede ?? '-'}`
    grupos.set(chave, [...(grupos.get(chave) ?? []), ms])
  }
  return [...grupos]
    .map(([chave, valores]) => {
      const [nome, rede] = chave.split('\t')
      const ordenados = valores.sort((a, b) => a - b)
      return {
        nome,
        rede,
        vezes: ordenados.length,
        mediana: percentil(ordenados, 0.5),
        p95: percentil(ordenados, 0.95),
        max: ordenados.at(-1),
      }
    })
    .sort((a, b) => a.nome.localeCompare(b.nome) || a.rede.localeCompare(b.rede))
}
