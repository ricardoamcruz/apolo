/**
 * Rollback manual, para quando nem a voz nem a interface estão de pé.
 *
 * Com o A.P.O.L.O. parado: `npm run rollback` e depois `npm start`. Volta à versão
 * segura e descarta a alteração em teste (docs/adr/0015).
 */

// Primeiro de todos: APOLO_AUTODEV_PASTA tem de valer aqui igual à ponte, e o
// .env.local tem de estar na memória antes de politica.mjs (ver bridge/env.mjs).
import '../bridge/env.mjs'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { PASTA_AUTODEV } from '../bridge/autodev/politica.mjs'

const arqTransicao = join(PASTA_AUTODEV, 'transicao.json')
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

if (!existsSync(arqTransicao)) {
  console.log('Não há alteração em teste: já estou na versão segura.')
  process.exit(0)
}
if (git('status', '--porcelain')) {
  console.error('Há alterações não commitadas; guarde-as antes do rollback. Nada foi trocado.')
  process.exit(1)
}

const { de, para, aprovada } = JSON.parse(readFileSync(arqTransicao, 'utf8'))
if (de.ref === de.sha) git('switch', '--detach', de.sha)
else git('switch', de.ref)

if (!aprovada) {
  git('branch', '-D', para.ref)
  console.log(`Descartei ${para.ref}. Para recuperar: git branch recuperada ${para.sha}`)
}
rmSync(arqTransicao)

console.log(`Voltou para ${de.ref} (${de.sha.slice(0, 7)}). Inicie de novo com npm start.`)
