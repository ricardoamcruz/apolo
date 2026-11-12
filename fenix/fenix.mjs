#!/usr/bin/env node
/**
 * F.Ê.N.I.X. — Fiadora da Estabilidade, do Nascimento, da Integridade e da
 * eXecução (docs/adr/0025).
 *
 *   node fenix/fenix.mjs [--config arquivo] [opções do projeto]
 *   node fenix/fenix.mjs rollback [--config arquivo]
 *   node fenix/fenix.mjs rotina <nome> [parametro=valor...] [--config arquivo]
 *   node fenix/fenix.mjs avisar <título> <texto> [--alta] [--config arquivo]
 *
 * Sem `--config`, lê fenix.config.json da pasta atual. As opções (no A.P.O.L.O.,
 * --writes e --autodev) são as que o arquivo declara em "flags".
 *
 * A primeira forma sobe e guarda os serviços do projeto até Ctrl-C. A segunda é o
 * rollback manual, com tudo parado: volta à versão segura e descarta a alteração
 * em teste. `rotina` e `avisar` falam com a Fênix que já está no ar, pelo canal:
 * rodam uma rotina (`rotina atualizar`) ou mandam um aviso à central de
 * notificações. Todas saem com 0 quando deu certo e com 1, e o motivo, quando não.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { pedirAFenix } from './src/cliente.mjs'
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

/** O Git do rollback: com a pasta, sem perguntar nada, e com o motivo em uma linha. */
function gitManual(...a) {
  try {
    return execFileSync('git', a, {
      cwd: config.repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }).trim()
  } catch (err) {
    const motivo = String(err.stderr ?? '').split('\n').map((l) => l.replace(/^(fatal|error):\s*/i, '').trim()).find(Boolean)
    throw new Error(`git ${a[0]} falhou: ${motivo ?? err.message}`)
  }
}

if (subcomando === 'rollback') {
  const arqTransicao = join(config.pasta, 'transicao.json')
  if (!existsSync(arqTransicao)) {
    console.log('Não há alteração em teste: já estou na versão segura.')
    process.exit(0)
  }
  try {
    if (gitManual('rev-parse', '--is-inside-work-tree') !== 'true') throw new Error(`${config.repo} não é um repositório Git`)
    const sujos = gitManual('status', '--porcelain', '--untracked-files=no')
    if (sujos) {
      console.error(`Há alterações não commitadas (${sujos.split('\n').map((l) => l.trim().replace(/^\S{1,2}\s+/, '')).slice(0, 5).join(', ')}); guarde-as antes do rollback. Nada foi trocado.`)
      process.exit(1)
    }
    const { de, para, aprovada } = JSON.parse(readFileSync(arqTransicao, 'utf8'))
    if (de.ref === de.sha) gitManual('switch', '--quiet', '--detach', de.sha)
    else {
      let existe = true
      try {
        gitManual('show-ref', '--verify', '--quiet', `refs/heads/${de.ref}`)
      } catch {
        existe = false
      }
      if (!existe) throw new Error(`a branch ${de.ref} não existe mais nesta cópia; volte à mão com git switch --detach ${de.sha}`)
      gitManual('switch', '--quiet', de.ref)
    }
    const agora = gitManual('rev-parse', '--abbrev-ref', 'HEAD')
    if (de.ref !== de.sha && agora !== de.ref) throw new Error(`pedi ${de.ref}, mas a cópia ficou em ${agora}`)
    if (!aprovada) {
      try {
        gitManual('branch', '-D', para.ref)
        console.log(`Descartei ${para.ref}. Para recuperar: git branch recuperada ${para.sha}`)
      } catch {
        console.log(`${para.ref} já não existia. Para recuperar a alteração: git branch recuperada ${para.sha}`)
      }
    }
    rmSync(arqTransicao)
    console.log(`Voltou para ${de.ref} (${gitManual('rev-parse', '--short', 'HEAD')}). Inicie de novo com npm start.`)
    process.exit(0)
  } catch (err) {
    console.error(`[fenix] o rollback não terminou: ${err.message}. O registro da troca continua em ${arqTransicao}.`)
    process.exit(1)
  }
}

if (subcomando === 'rotina' || subcomando === 'avisar') {
  const alta = args.includes('--alta')
  const posicionais = args.filter((a) => !a.startsWith('--'))
  const token = process.env.FENIX_TOKEN?.trim() || (() => {
    try {
      return readFileSync(join(config.pasta, 'token'), 'utf8').trim()
    } catch {
      return ''
    }
  })()
  if (!token) {
    console.error(`[fenix] não achei o token do canal (${join(config.pasta, 'token')} ou FENIX_TOKEN): a Fênix já subiu nesta máquina?`)
    process.exit(1)
  }
  let msg
  if (subcomando === 'rotina') {
    const [nome, ...pares] = posicionais
    if (!nome) {
      console.error('[fenix] diga qual rotina: node fenix/fenix.mjs rotina atualizar')
      process.exit(1)
    }
    msg = { type: 'rotina', nome, parametros: Object.fromEntries(pares.map((p) => p.split(/=(.*)/s).slice(0, 2))) }
  } else {
    const [titulo, ...resto] = posicionais
    if (!titulo || !resto.length) {
      console.error('[fenix] uso: node fenix/fenix.mjs avisar "título" "texto" [--alta]')
      process.exit(1)
    }
    msg = { type: 'avisar', titulo, texto: resto.join(' '), prioridade: alta ? 'alta' : 'normal' }
  }
  const host = ['0.0.0.0', '::', '127.0.0.1'].includes(config.escuta.host) ? 'localhost' : config.escuta.host
  const url = `${config.tls ? 'wss' : 'ws'}://${host}:${config.escuta.porta}/fenix`
  const ca = config.tls ? readFileSync(config.tls.cert) : undefined
  // Rotinas longas (o app do iPhone) levam até 45 minutos.
  const prazoMs = subcomando === 'rotina' ? (config.rotinas.find((r) => r.nome === msg.nome)?.prazoMs ?? 15 * 60_000) + 60_000 : 20_000
  const r = await pedirAFenix({ url, token, ca, msg, prazoMs })
  ;(r.ok ? console.log : console.error)(`[fenix] ${r.mensagem ?? (r.ok ? 'feito.' : 'falhou, sem detalhe.')}`)
  if (r.saida) console.log(r.saida)
  process.exit(r.ok ? 0 : 1)
}

if (subcomando !== 'iniciar') {
  console.error(`[fenix] não conheço "${subcomando}". Use: iniciar (padrão), rollback, rotina ou avisar.`)
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
