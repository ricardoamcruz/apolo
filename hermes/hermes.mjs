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
 *   HERMES_TLS_CERT     certificado e chave: com eles, só HTTPS (ou APOLO_TLS_CERT e
 *   HERMES_TLS_KEY      APOLO_TLS_KEY; sem nenhum, ~/.apolo/tls, se existir)
 *   HERMES_APOLO_URL    o assistente, wss://localhost:8787 (a porta de JARVIS_BRIDGE_PORT)
 *   HERMES_APOLO_TOKEN  o token que o assistente espera; sem ele, derivado do token do celular
 *   HERMES_APOLO_CA     a autoridade do certificado do assistente (padrão: o próprio certificado)
 *   HERMES_PASTA        onde fica o registro quando ninguém lê a saída (~/.apolo/hermes)
 *
 * Notificações (docs/adr/0027):
 *
 *   HERMES_NOTIFICAR_TOKEN  quem pode pedir notificações (ou APOLO_NOTIFICAR_TOKEN)
 *   HERMES_NOTIFICAR_PORTA  a porta local dos serviços, 8792 (ou APOLO_NOTIFICAR_PORTA);
 *                           responde GET /saude mesmo sem notificações
 *   HERMES_NTFY_TOPICO      o tópico do ntfy (ou APOLO_NTFY_TOPICO); a entrada é <tópico>-mac
 *   HERMES_NTFY_URL         o servidor do ntfy, https://ntfy.sh
 *   HERMES_URL_PUBLICA      o endereço do H.E.R.M.E.S. visto do iPhone (Tailscale); sem ele, sem botões
 *
 * Sem token do celular nem das notificações, não há o que fazer: sai com código 0,
 * e quem o guarda entende que não é queda.
 *
 * Nada aqui depende de quem o subiu (docs/adr/0029): os padrões são do próprio
 * H.E.R.M.E.S., `npm run hermes` lê o .env.local sozinho, e se a F.Ê.N.I.X. cair
 * ele continua de pé, registrando a saída em HERMES_PASTA.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { PORTA_PADRAO, criarGateway } from './src/gateway.mjs'
import { criarRele, tokenDerivado } from './src/rele.mjs'
import { criarCentral, criarNtfy, criarPortaDosServicos, notificarNoMac } from './src/notificacoes.mjs'
import { protegerSaidas } from './src/saidas.mjs'

const env = process.env
const valor = (...nomes) => nomes.map((n) => env[n]?.trim()).find(Boolean)
const ler = (arquivo) => (arquivo ? readFileSync(arquivo) : undefined)
/** O padrão do projeto (docs/adr/0021), só quando o arquivo existe. */
const seExistir = (arquivo) => (existsSync(arquivo) ? arquivo : undefined)

const pasta = valor('HERMES_PASTA') ?? join(homedir(), '.apolo', 'hermes')
protegerSaidas({ nome: 'hermes', arquivo: join(pasta, 'hermes.log') })

const token = valor('HERMES_TOKEN', 'APOLO_GATEWAY_TOKEN')
const tokenDasNotificacoes = valor('HERMES_NOTIFICAR_TOKEN', 'APOLO_NOTIFICAR_TOKEN')
if (!token && !tokenDasNotificacoes) {
  console.log('[hermes] nenhum celular pareado nem notificações configuradas — nada a fazer')
  process.exit(0)
}

const certificado = valor('HERMES_TLS_CERT', 'APOLO_TLS_CERT') ?? seExistir(join(homedir(), '.apolo', 'tls', 'apolo.pem'))
const chave = valor('HERMES_TLS_KEY', 'APOLO_TLS_KEY') ?? seExistir(join(homedir(), '.apolo', 'tls', 'apolo-chave.pem'))
const tls = certificado && chave ? { cert: ler(certificado), key: ler(chave) } : undefined
const fechamentos = []

// ── notificações ────────────────────────────────────────────────────────────
const topico = valor('HERMES_NTFY_TOPICO', 'APOLO_NTFY_TOPICO')
const ntfy = criarNtfy({ servidor: valor('HERMES_NTFY_URL') ?? 'https://ntfy.sh', topico })
const central = criarCentral({
  entregar: { mac: notificarNoMac, ntfy: ntfy ? (n) => ntfy.publicar(n) : null },
  // Os botões chegam pela porta do celular: sem ela, não há como tocar neles.
  urlPublica: token ? valor('HERMES_URL_PUBLICA', 'APOLO_HERMES_URL_PUBLICA') : undefined,
})
// A porta local abre sempre: as notificações precisam do token, a saúde não.
try {
  const servicos = criarPortaDosServicos({
    token: tokenDasNotificacoes,
    central,
    porta: Number(valor('HERMES_NOTIFICAR_PORTA', 'APOLO_NOTIFICAR_PORTA') ?? 8792),
    tls,
    saude: () => ({ ok: true, celular: Boolean(token), notificacoes: Boolean(tokenDasNotificacoes), ntfy: Boolean(ntfy) }),
  })
  const p = await servicos.ligar()
  fechamentos.push(() => servicos.fechar())
  console.log(
    tokenDasNotificacoes
      ? `[hermes] notificações ouvindo os serviços na porta ${p}${ntfy ? ', com o ntfy' : ', só no Mac (sem tópico do ntfy)'}`
      : `[hermes] sem notificações configuradas; a porta ${p} só responde a saúde`,
  )
} catch (err) {
  console.error(`[hermes] não consegui abrir a porta dos serviços: ${err.message}`)
}
// O que o Ricardo publicar no tópico de entrada aparece na central do macOS.
if (ntfy) fechamentos.push(ntfy.assinar(`${topico}-mac`, (n) => void notificarNoMac(n)))

const sair = () => Promise.all(fechamentos.map((f) => f())).then(() => process.exit(0))
process.on('SIGINT', sair)
process.on('SIGTERM', sair)

if (!token) {
  console.log('[hermes] sem celular pareado: só as notificações')
} else {
  const rele = criarRele({
    apolo: valor('HERMES_APOLO_URL') ?? `wss://localhost:${valor('JARVIS_BRIDGE_PORT') ?? 8787}`,
    token: valor('HERMES_APOLO_TOKEN') ?? tokenDerivado(token),
    ca: ler(valor('HERMES_APOLO_CA') ?? certificado),
  })
  try {
    const gateway = criarGateway({
      token,
      host: valor('HERMES_HOST', 'APOLO_GATEWAY_HOST'),
      porta: Number(valor('HERMES_PORTA', 'APOLO_GATEWAY_PORT') ?? PORTA_PADRAO),
      tls,
      atender: rele.atender,
      servirMidia: rele.servirMidia,
      responderAcao: central.responderAcao,
    })
    const porta = await gateway.ligar()
    fechamentos.push(() => gateway.fechar())
    console.log(`[hermes] H.E.R.M.E.S. ouvindo o celular na porta ${porta}${tls ? '' : ' (sem TLS)'}`)
  } catch (err) {
    console.error(`[hermes] não consegui abrir a porta do celular: ${err.message}`)
    process.exit(1)
  }
}
