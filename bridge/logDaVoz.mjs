/**
 * O log da voz em `~/.apolo/logs/voz-AAAA-MM-DD.log` (docs/adr/0035): os passos da
 * conexão que a interface relata, para entender um "ele não responde" depois que o
 * terminal fechou. São contagens e motivos, nunca o que foi dito.
 */
import { appendFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PASTA_DE_LOGS } from './telemetria.mjs'

const MAX_BYTES_POR_DIA = 5 * 1024 * 1024
const DIAS_GUARDADOS = 14

export function criarLogDaVoz({ pasta = PASTA_DE_LOGS, dias = DIAS_GUARDADOS, agora = Date.now } = {}) {
  let pronta = false
  return {
    registrar(texto) {
      try {
        if (!pronta) {
          mkdirSync(pasta, { recursive: true, mode: 0o700 })
          for (const nome of readdirSync(pasta)) {
            const arquivo = join(pasta, nome)
            if (/^voz-.*\.log$/.test(nome) && statSync(arquivo).mtimeMs < agora() - dias * 86_400_000) rmSync(arquivo)
          }
          pronta = true
        }
        const d = new Date(agora())
        const dois = (n) => String(n).padStart(2, '0')
        const dia = `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`
        const arquivo = join(pasta, `voz-${dia}.log`)
        if ((statSync(arquivo, { throwIfNoEntry: false })?.size ?? 0) > MAX_BYTES_POR_DIA) return
        appendFileSync(arquivo, `${d.toISOString()} ${texto}\n`, { mode: 0o600 })
      } catch {
        /* o log nunca atrapalha a voz */
      }
    },
  }
}
