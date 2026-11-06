/**
 * VS Code para acompanhar o trabalho: opcional e desligado por padrão, porque o
 * agente não precisa dele. Só abre com APOLO_AUTODEV_VSCODE=1.
 *
 * Uma instância à parte, com perfil próprio, porque o editor não tem comando para
 * fechar uma janela: é esse perfil que permite encerrar só o que abrimos aqui, sem
 * tocar nas janelas do Ricardo.
 */

import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { PASTA_AUTODEV } from './politica.mjs'

/** Curto de propósito: o VS Code cria um socket aqui, limitado a 103 caracteres. */
const PERFIL = join(PASTA_AUTODEV, 'vscode')
const BIN =
  process.env.APOLO_VSCODE_BIN || '/Applications/Visual Studio Code.app/Contents/MacOS/Code'

/**
 * O binário direto, e não o comando `code`: dentro de um terminal do VS Code ele
 * repassaria o pedido à janela aberta. Pelo mesmo motivo, sai do ambiente tudo o
 * que o editor deixa para os filhos, como ELECTRON_RUN_AS_NODE.
 */
export function abrirEditor(pasta) {
  if (process.env.APOLO_AUTODEV_VSCODE !== '1' || !existsSync(BIN)) return
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([nome]) => !/^(VSCODE_|ELECTRON_)/.test(nome)),
  )
  const extensoes = join(homedir(), '.vscode', 'extensions')
  const args = ['--user-data-dir', PERFIL, '--extensions-dir', extensoes, '--new-window', pasta]
  const filho = spawn(BIN, args, { stdio: 'ignore', detached: true, env })
  filho.on('error', () => {})
  filho.unref()
}

/** Encerra a instância do perfil próprio, e nada além dela. */
export function fecharEditor() {
  const lista = execFileSync('ps', ['ax', '-o', 'pid=,command='], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  for (const linha of lista.split('\n')) {
    if (!linha.includes(`--user-data-dir ${PERFIL}`)) continue
    try {
      process.kill(Number(linha.trim().split(/\s+/)[0]), 'SIGTERM')
    } catch {
      /* já tinha saído */
    }
  }
}
