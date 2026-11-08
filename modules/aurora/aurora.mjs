#!/usr/bin/env node
/**
 * A.U.R.O.R.A. — Agenda, Últimas notícias, Recados, Obrigações, Rock e Alvorada
 * (docs/adr/0026). O bom dia do A.P.O.L.O.
 *
 *   node modules/aurora/aurora.mjs            serve o bom dia (GET /bom-dia)
 *   node modules/aurora/aurora.mjs autorizar  autoriza a leitura das playlists do YouTube
 *   node modules/aurora/aurora.mjs resumo     mostra o texto do bom dia, para conferir
 *
 * Tudo vem do ambiente (prefixo AURORA_, ou APOLO_ como no .env.local do A.P.O.L.O.):
 *
 *   AURORA_TOKEN              quem pode pedir o bom dia (32+ caracteres); sem ele, sai com 0
 *   AURORA_PORTA, AURORA_HOST 8791, 127.0.0.1
 *   AURORA_TLS_CERT/KEY       com eles, só HTTPS
 *   AURORA_GOOGLE_CLIENT_ID   cliente OAuth "TVs e dispositivos de entrada limitados"
 *   AURORA_GOOGLE_CLIENT_SECRET
 *   AURORA_AGENDA_ICS         link .ics da agenda
 *   AURORA_PASTA              token do YouTube e cache (padrão ~/.apolo/aurora)
 *   AURORA_CONFIG             temas, playlists e repositório (padrão aurora.config.json ao lado)
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { bomDia, textoParaVoz } from './src/resumo.mjs'
import { criarYoutube } from './src/youtube.mjs'

const env = process.env
const valor = (nome) => env[`AURORA_${nome}`]?.trim() || env[`APOLO_${nome}`]?.trim() || undefined
const ler = (arquivo) => (arquivo ? readFileSync(arquivo) : undefined)

const config = JSON.parse(readFileSync(valor('CONFIG') ?? new URL('./aurora.config.json', import.meta.url), 'utf8'))
const pasta = valor('PASTA') ?? join(homedir(), '.apolo', 'aurora')
const youtube = criarYoutube({ clienteId: valor('GOOGLE_CLIENT_ID'), segredo: valor('GOOGLE_CLIENT_SECRET'), pasta })
const montar = () => bomDia({ config, youtube, agendaIcs: valor('AGENDA_ICS') })

const subcomando = process.argv[2] ?? 'servir'

if (subcomando === 'autorizar') {
  try {
    await youtube.autorizar(({ codigo, endereco }) => {
      console.log(`\nAbra ${endereco} no navegador, entre com a conta do YouTube Music e digite o código:\n\n    ${codigo}\n`)
      console.log('Esperando a autorização...')
    })
    console.log('\nYouTube autorizado. A A.U.R.O.R.A. já consegue ler as suas playlists.')
    const faixas = await youtube.faixas({ playlists: config.musica?.playlists ?? [], filtro: config.musica?.filtroDePlaylist ?? 'rock' })
    console.log(`${faixas.length} faixas candidatas para o bom dia.`)
    process.exit(0)
  } catch (err) {
    console.error(`\nNão deu: ${err.message}`)
    process.exit(1)
  }
}

if (subcomando === 'resumo') {
  const r = await montar()
  console.log(textoParaVoz(r))
  if (r.avisoDaMusica) console.log(`(música: ${r.avisoDaMusica})`)
  process.exit(0)
}

if (subcomando !== 'servir') {
  console.error(`[aurora] não conheço "${subcomando}". Use: servir (padrão), autorizar ou resumo.`)
  process.exit(1)
}

const token = valor('AURORA_TOKEN') ?? env.AURORA_TOKEN?.trim()
if (!token || token.length < 32) {
  console.log('[aurora] sem APOLO_AURORA_TOKEN: nada a servir por aqui.')
  process.exit(0)
}
const resumo = (t) => createHash('sha256').update(String(t)).digest()
const autorizado = (cabecalho) => {
  const [esquema, recebido] = String(cabecalho ?? '').split(' ')
  return esquema === 'Bearer' && Boolean(recebido) && timingSafeEqual(resumo(recebido), resumo(token))
}

const responder = async (req, res) => {
  const json = (status, corpo) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(corpo))
  }
  if (req.method !== 'GET') return json(404, {})
  if (req.url === '/saude') return json(200, { ok: true, youtube: youtube.autorizado() })
  if (!autorizado(req.headers.authorization)) return json(401, { ok: false })
  if (req.url !== '/bom-dia') return json(404, {})
  try {
    const r = await montar()
    return json(200, { ok: true, musica: r.musica, texto: textoParaVoz(r), avisoDaMusica: r.avisoDaMusica, pendencias: r.pendencias })
  } catch (err) {
    return json(500, { ok: false, mensagem: err.message })
  }
}

const tls = valor('TLS_CERT') && valor('TLS_KEY') ? { cert: ler(valor('TLS_CERT')), key: ler(valor('TLS_KEY')) } : null
const servidor = tls ? createHttpsServer(tls, responder) : createServer(responder)
const porta = Number(valor('PORTA') ?? 8791)
servidor.listen(porta, valor('HOST') ?? '127.0.0.1', () => {
  console.log(`[aurora] A.U.R.O.R.A. servindo o bom dia na porta ${porta}${tls ? '' : ' (sem TLS)'}`)
  if (!youtube.autorizado()) console.log('[aurora] YouTube ainda não autorizado: rode npm run aurora:autorizar')
})
const sair = () => servidor.close(() => process.exit(0))
process.on('SIGINT', sair)
process.on('SIGTERM', sair)
