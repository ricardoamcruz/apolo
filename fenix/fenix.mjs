#!/usr/bin/env node
/**
 * F.Ê.N.I.X. — Fiadora da Estabilidade, do Nascimento, da Integridade e da
 * eXecução (docs/adr/0025).
 *
 *   node fenix/fenix.mjs [--config arquivo] [opções do projeto]
 *   node fenix/fenix.mjs rollback [--config arquivo]
 *
 * Sem `--config`, lê fenix.config.json da pasta atual. As opções (no A.P.O.L.O.,
 * --writes e --autodev) são as que o arquivo declara em "flags".
 *
 * A primeira forma sobe e guarda os serviços do projeto até Ctrl-C. A segunda é o
 * rollback manual, com tudo parado: volta à versão segura e descarta a alteração
 * em teste.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { lerConfig } from './src/config.mjs'
import { criarFenix, garantirToken } from './src/fenix.mjs'
import { encerrarNaPorta } from './src/servicos.mjs'

const args = process.argv.slice(2)
const subcomando = args[0] && !args[0].startsWith('--') ? args.shift() : 'iniciar'
const iConfig = args.indexOf('--config')
const arquivo = resolve(iConfig >= 0 ? args.splice(iConfig, 2)[1] : 'fenix.config.json')

if (!existsSync(arquivo)) {
  console.error(`[fenix] não achei ${arquivo}. Rode da pasta do projeto ou passe --config.`)
  process.exit(1)
}
const config = lerConfig(arquivo)

if (subcomando === 'rollback') {
  const arqTransicao = join(config.pasta, 'transicao.json')
  const git = (...a) => execFileSync('git', a, { cwd: config.repo, encoding: 'utf8' }).trim()
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
  process.exit(0)
}

if (subcomando !== 'iniciar') {
  console.error(`[fenix] não conheço "${subcomando}". Use: iniciar (padrão) ou rollback.`)
  process.exit(1)
}

const desconhecidas = args.filter((a) => a.startsWith('--') && !(a in config.flags))
if (desconhecidas.length) {
  console.error(`[fenix] opções desconhecidas: ${desconhecidas.join(', ')}. O projeto aceita: ${Object.keys(config.flags).join(', ') || 'nenhuma'}.`)
  process.exit(1)
}

// Antes dos serviços: o que o projeto precisa preparar (certificado, arquivos copiados).
for (const passo of config.preparar) {
  const [comando, ...resto] = passo
  const r = spawnSync(comando === 'node' ? process.execPath : comando, resto, { cwd: config.repo, stdio: 'inherit' })
  if (r.status !== 0) console.warn(`[fenix] a preparação "${passo.join(' ')}" falhou; sigo assim mesmo.`)
}

// Uma Fênix antiga esquecida num terminal seguraria a porta do canal.
encerrarNaPorta(config.escuta.porta, 'fenix/fenix.mjs', process.cwd())

// Como subir esta mesma Fênix de novo, se ela morrer (docs/adr/0028): o mesmo
// programa, a mesma configuração e as mesmas opções.
const renascer = {
  comando: [process.execPath, fileURLToPath(import.meta.url), '--config', arquivo, ...args],
  cwd: process.cwd(),
}
const renascida = process.env.FENIX_RENASCIDA === '1'
// A marca é desta partida: os serviços e uma próxima Fênix não a herdam.
delete process.env.FENIX_RENASCIDA
delete config.ambiente.FENIX_RENASCIDA
const fenix = criarFenix(config, { flags: args, token: garantirToken(config.pasta), renascer, renascida })

let saindo = false
async function sair(codigo) {
  if (saindo) return
  saindo = true
  console.log('\n[fenix] encerrando os serviços.')
  await fenix.encerrar().catch(() => {})
  process.exit(codigo)
}
process.on('SIGINT', () => void sair(0))
process.on('SIGTERM', () => void sair(0))

try {
  const porta = await fenix.iniciar()
  console.log(`\n[fenix] F.Ê.N.I.X. guardando ${config.nome} — canal em ${fenix.url()} (porta ${porta})`)
  const ativas = args.filter((a) => a in config.flags)
  if (ativas.length) console.log(`[fenix] opções: ${ativas.join(' ')}`)
  console.log('[fenix] Ctrl-C encerra tudo.\n')
} catch (err) {
  console.error(`[fenix] não consegui iniciar: ${err.message}`)
  if (/transi|switch|branch/i.test(err.message)) console.error('Resolva o que o Git apontou e rode npm run rollback.')
  await fenix.encerrar().catch(() => {})
  process.exit(1)
}
