/**
 * Rollback manual, para quando nem a voz nem a interface estão de pé.
 *
 * Com o A.P.O.L.O. parado: `npm run rollback` e depois `npm start`. Volta a
 * última alteração feita pelo autodesenvolvimento (docs/adr/0011).
 */

// Primeiro de todos: APOLO_AUTODEV_PASTA tem de valer aqui igual à ponte, e o
// .env.local tem de estar na memória antes de politica.mjs (ver bridge/env.mjs).
import '../bridge/env.mjs'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PASTA_AUTODEV } from '../bridge/autodev/politica.mjs'

const arqTransicao = join(PASTA_AUTODEV, 'transicao.json')
const arqHistorico = join(PASTA_AUTODEV, 'historico.json')

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

const historico = existsSync(arqHistorico) ? JSON.parse(readFileSync(arqHistorico, 'utf8')) : []
const pendente = existsSync(arqTransicao) ? JSON.parse(readFileSync(arqTransicao, 'utf8')) : null
const alvo = pendente ?? historico.at(-1)

if (!alvo) {
  console.log('Não há versão anterior registrada.')
  process.exit(0)
}
if (git('status', '--porcelain')) {
  console.error('Há alterações não commitadas; guarde-as antes do rollback. Nada foi trocado.')
  process.exit(1)
}

const { ref, sha } = alvo.de
if (ref === sha) git('switch', '--detach', sha)
else git('switch', ref)

if (pendente) rmSync(arqTransicao)
else writeFileSync(arqHistorico, JSON.stringify(historico.slice(0, -1), null, 2))

console.log(`Voltou para ${ref} (${sha.slice(0, 7)}). Inicie de novo com npm start.`)
