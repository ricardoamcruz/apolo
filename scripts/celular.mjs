#!/usr/bin/env node
/**
 * Pareia o iPhone com este Mac (docs/adr/0019).
 *
 * Garante o token no .env.local, publica o gateway no Tailscale e copia para a
 * área de transferência o código que o app pede. O token nunca aparece no
 * terminal, para não ficar no histórico nem em tela compartilhada.
 */
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { appendFileSync, chmodSync, existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ENV = fileURLToPath(new URL('../.env.local', import.meta.url))
const PORTA = process.env.APOLO_GATEWAY_PORT ?? '8788'
const CLI_DO_APP = '/Applications/Tailscale.app/Contents/MacOS/Tailscale'

function sair(mensagem) {
  console.error(`\n${mensagem}\n`)
  process.exit(1)
}

function garantirToken() {
  const atual = existsSync(ENV) ? readFileSync(ENV, 'utf8') : ''
  const achado = /^APOLO_GATEWAY_TOKEN=(.+)$/m.exec(atual)?.[1]?.trim()
  if (achado) return { token: achado, novo: false }
  const token = randomBytes(32).toString('base64url')
  const quebra = atual && !atual.endsWith('\n') ? '\n' : ''
  appendFileSync(ENV, `${quebra}APOLO_GATEWAY_TOKEN=${token}\n`)
  chmodSync(ENV, 0o600)
  return { token, novo: true }
}

function acharTailscale() {
  for (const cli of ['tailscale', CLI_DO_APP]) {
    try {
      execFileSync(cli, ['version'], { stdio: 'ignore' })
      return cli
    } catch {
      // Tenta o próximo.
    }
  }
  return null
}

// Nada é gravado antes de o Tailscale responder: uma tentativa que falha não deixa rastro.
const tailscale = acharTailscale()
if (!tailscale) {
  sair(
    'Falta o Tailscale. Instale pela App Store no Mac e no iPhone, entre com a mesma\n' +
      'conta nos dois e rode npm run celular de novo.',
  )
}

const status = JSON.parse(execFileSync(tailscale, ['status', '--json'], { encoding: 'utf8' }))
const host = status.Self?.DNSName?.replace(/\.$/, '')
if (status.BackendState !== 'Running' || !host) {
  sair('O Tailscale está instalado, mas desligado. Abra o app, entre na conta e tente de novo.')
}

const { token, novo } = garantirToken()

try {
  // stdio herdado: na primeira vez, o Tailscale mostra um link para ativar o HTTPS.
  execFileSync(tailscale, ['serve', '--bg', `https+insecure://127.0.0.1:${PORTA}`], { stdio: 'inherit' })
} catch {
  sair('O tailscale serve falhou. Se ele mostrou um link, ative o HTTPS por lá e tente de novo.')
}

const codigo = `https://${host}#${token}`
let copiado = false
try {
  execFileSync('pbcopy', { input: codigo })
  copiado = true
} catch {
  // Fora do macOS não há pbcopy; o token continua no .env.local.
}

console.log(`\nGateway publicado em https://${host}`)
console.log('Só os aparelhos da sua conta Tailscale alcançam este endereço.')
console.log(
  copiado
    ? 'Código de pareamento copiado. Cole no app (a área de transferência passa ao iPhone por Handoff).'
    : `Monte o código de pareamento: https://${host}#<APOLO_GATEWAY_TOKEN do .env.local>`,
)
if (novo) console.log('Token novo: reinicie o A.P.O.L.O. (npm start) para o gateway subir.')
