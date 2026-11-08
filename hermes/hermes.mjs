#!/usr/bin/env node
/**
 * H.E.R.M.E.S. — Hub de Enlace Remoto Móvel, Escuta e Sincronia (docs/adr/0019,
 * 0018 e 0025).
 *
 *   node hermes/hermes.mjs
 *
 * A porta do celular: confere o token do app e repassa a conversa ao assistente.
 * Tudo vem do ambiente:
 *
 *   HERMES_TOKEN        o token do celular (ou APOLO_GATEWAY_TOKEN, do pareamento)
 *   HERMES_PORTA        a porta do celular, 8788 (ou APOLO_GATEWAY_PORT)
 *   HERMES_HOST         onde ouvir, 127.0.0.1 (ou APOLO_GATEWAY_HOST); o Tailscale entrega aqui
 *   HERMES_TLS_CERT     certificado e chave: com eles, só HTTPS
 *   HERMES_TLS_KEY
 *   HERMES_APOLO_URL    o assistente, wss://localhost:8787
 *   HERMES_APOLO_TOKEN  o token que o assistente espera; sem ele, derivado do token do celular
 *   HERMES_APOLO_CA     a autoridade do certificado do assistente
 *
 * Sem token do celular, não há o que fazer: sai com código 0, e quem o guarda
 * entende que não é queda.
 */
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { PORTA_PADRAO, criarGateway } from './src/gateway.mjs'
import { criarRele, tokenDerivado } from './src/rele.mjs'

const env = process.env
const valor = (...nomes) => nomes.map((n) => env[n]?.trim()).find(Boolean)
const ler = (arquivo) => (arquivo ? readFileSync(arquivo) : undefined)

const token = valor('HERMES_TOKEN', 'APOLO_GATEWAY_TOKEN')
if (!token) {
  console.log('[hermes] nenhum celular pareado — rode npm run celular para parear')
  process.exit(0)
}

const certificado = valor('HERMES_TLS_CERT')
const chave = valor('HERMES_TLS_KEY')
const tls = certificado && chave ? { cert: ler(certificado), key: ler(chave) } : undefined

const rele = criarRele({
  apolo: valor('HERMES_APOLO_URL') ?? 'wss://localhost:8787',
  token: valor('HERMES_APOLO_TOKEN') ?? tokenDerivado(token),
  ca: ler(valor('HERMES_APOLO_CA')),
})

try {
  const gateway = criarGateway({
    token,
    host: valor('HERMES_HOST', 'APOLO_GATEWAY_HOST'),
    porta: Number(valor('HERMES_PORTA', 'APOLO_GATEWAY_PORT') ?? PORTA_PADRAO),
    tls,
    atender: rele.atender,
    servirMidia: rele.servirMidia,
  })
  const porta = await gateway.ligar()
  console.log(`[hermes] H.E.R.M.E.S. ouvindo o celular na porta ${porta}${tls ? '' : ' (sem TLS)'}`)
  const sair = () => gateway.fechar().then(() => process.exit(0))
  process.on('SIGINT', sair)
  process.on('SIGTERM', sair)
} catch (err) {
  console.error(`[hermes] não consegui abrir a porta do celular: ${err.message}`)
  process.exit(1)
}
