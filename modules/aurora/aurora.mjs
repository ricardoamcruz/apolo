#!/usr/bin/env node
/**
 * A.U.R.O.R.A. — Agenda, Últimas notícias, Recados, Obrigações, Rock e Alvorada
 * (docs/adr/0026). O bom dia do A.P.O.L.O.
 *
 *   node modules/aurora/aurora.mjs            serve o bom dia (GET /bom-dia) e os
 *                                            temas de notícia (GET/POST /noticias)
 *   node modules/aurora/aurora.mjs autorizar  autoriza a leitura das playlists do YouTube
 *   node modules/aurora/aurora.mjs resumo     mostra o texto do bom dia, para conferir
 *
 * Tudo vem do ambiente (prefixo AURORA_, ou APOLO_ como no .env.local do A.P.O.L.O.):
 *
 *   AURORA_TOKEN              quem pode pedir o bom dia (32+ caracteres); sem ele, sai com 0
 *   AURORA_PORTA, AURORA_HOST 8791 (ou APOLO_AURORA_PORTA), 127.0.0.1
 *   AURORA_TLS_CERT/KEY       com eles, só HTTPS; sem eles, ~/.apolo/tls, se existir
 *   AURORA_GOOGLE_CLIENT_ID   cliente OAuth "TVs e dispositivos de entrada limitados"
 *   AURORA_GOOGLE_CLIENT_SECRET
 *   AURORA_AGENDA_ICS         link .ics da agenda
 *   AURORA_PASTA              token do YouTube, cache e os temas que ele mudou por voz
 *                             (padrão ~/.apolo/aurora)
 *   AURORA_CONFIG             temas, playlists e repositório (padrão aurora.config.json ao lado)
 *   AURORA_NOTIFICAR_URL      a central de notificações (padrão https://localhost:8792/notificar)
 *   AURORA_NOTIFICAR_TOKEN    o token dela (ou APOLO_NOTIFICAR_TOKEN); sem ele, nenhum aviso
 *   AURORA_NOTIFICAR_CA       a autoridade do certificado dela (padrão: o próprio certificado)
 *
 * Nada aqui depende de quem a subiu (docs/adr/0029): os padrões são dela, `npm run
 * aurora` lê o .env.local sozinho, e se a F.Ê.N.I.X. cair ela continua servindo,
 * com a saída em AURORA_PASTA/aurora.log. `GET /saude` é o contrato de quem a vigia.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { avisoDaMusica, criarAvisos } from './src/avisos.mjs'
import { bomDia, textoParaVoz } from './src/resumo.mjs'
import { protegerSaidas } from './src/saidas.mjs'
import { criarTemas } from './src/temas.mjs'
import { criarYoutube } from './src/youtube.mjs'

const env = process.env
const valor = (nome) => env[`AURORA_${nome}`]?.trim() || env[`APOLO_${nome}`]?.trim() || undefined
const ler = (arquivo) => (arquivo ? readFileSync(arquivo) : undefined)

const config = JSON.parse(readFileSync(valor('CONFIG') ?? new URL('./aurora.config.json', import.meta.url), 'utf8'))
const pasta = valor('PASTA') ?? join(homedir(), '.apolo', 'aurora')
/** O padrão do projeto (docs/adr/0021), só quando o arquivo existe. */
const seExistir = (arquivo) => (existsSync(arquivo) ? arquivo : undefined)
const certificado = valor('TLS_CERT') ?? seExistir(join(homedir(), '.apolo', 'tls', 'apolo.pem'))
const chave = valor('TLS_KEY') ?? seExistir(join(homedir(), '.apolo', 'tls', 'apolo-chave.pem'))
const youtube = criarYoutube({ clienteId: valor('GOOGLE_CLIENT_ID'), segredo: valor('GOOGLE_CLIENT_SECRET'), pasta })
/** Os temas de notícia, com o que ele mudou por voz por cima do aurora.config.json. */
const temas = criarTemas({ pasta, config })
/** A central de notificações, para o que ele precisa saber sem perguntar (docs/adr/0039). */
const avisos = criarAvisos({
  url: valor('NOTIFICAR_URL') ?? `https://localhost:${valor('NOTIFICAR_PORTA') ?? 8792}/notificar`,
  token: valor('NOTIFICAR_TOKEN'),
  ca: ler(valor('NOTIFICAR_CA') ?? certificado),
})
/**
 * O que está quebrado na música, para o `/saude`: o processo de pé não quer dizer
 * que o bom dia tem rock. Conferido de tempos em tempos e a cada bom dia.
 */
let problemaDaMusica = null
/** A primeira conferência só registra: o aviso é para a mudança, não para a partida. */
let conferiuUmaVez = false
const CONFERENCIA_MS = 10 * 60_000
/** Quebrou ou voltou: é a mudança que vira aviso, nunca o mesmo problema de novo. */
const anotarMusica = (problema) => {
  const aviso = conferiuUmaVez ? avisoDaMusica(problemaDaMusica, problema ?? null) : null
  problemaDaMusica = problema ?? null
  conferiuUmaVez = true
  if (aviso) void avisos.avisar(aviso)
}
const conferirMusica = async () => {
  anotarMusica(await youtube.conferir())
}
const montar = async () => {
  const r = await bomDia({ config, youtube, agendaIcs: valor('AGENDA_ICS'), noticias: temas.estado() })
  anotarMusica(r.avisoDaMusica)
  return r
}

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

protegerSaidas({ nome: 'aurora', arquivo: join(pasta, 'aurora.log') })

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

/** O corpo de um pedido, em JSON e pequeno: daqui não entra nada grande. */
const CORPO_MAX = 4 * 1024
const corpoEmJson = (req) =>
  new Promise((resolve) => {
    let texto = ''
    req.setEncoding('utf8')
    req.on('data', (p) => {
      texto += p
      if (texto.length > CORPO_MAX) {
        resolve(null)
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(texto || '{}'))
      } catch {
        resolve(null)
      }
    })
    req.on('error', () => resolve(null))
  })

const responder = async (req, res) => {
  const json = (status, corpo) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(corpo))
  }
  if (req.method !== 'GET' && req.method !== 'POST') return json(404, {})
  if (req.method === 'GET' && req.url === '/saude') {
    // `degradado`: de pé, mas com uma parte quebrada (docs/adr/0029).
    return json(200, {
      ok: true,
      servico: 'aurora',
      youtube: youtube.autorizado() && !problemaDaMusica,
      ...(problemaDaMusica && { degradado: `música do bom dia: ${problemaDaMusica}` }),
    })
  }
  if (!autorizado(req.headers.authorization)) return json(401, { ok: false })
  // Os temas de notícia: ler e mudar por voz (docs/adr/0039). A escolha fica na
  // pasta da A.U.R.O.R.A., nunca no arquivo do repositório.
  if (req.url === '/noticias') {
    if (req.method === 'GET') return json(200, { ok: true, ...temas.estado() })
    const pedido = await corpoEmJson(req)
    if (!pedido) return json(400, { ok: false, mensagem: 'não entendi o pedido' })
    const r = temas.editar(pedido)
    return json(r.ok ? 200 : 400, r)
  }
  if (req.method !== 'GET' || req.url !== '/bom-dia') return json(404, {})
  try {
    const r = await montar()
    // Os dados vão junto do texto: a interface monta com eles os popups do bom dia.
    return json(200, {
      ok: true,
      musica: r.musica,
      texto: textoParaVoz(r),
      avisoDaMusica: r.avisoDaMusica,
      pendencias: r.pendencias,
      agenda: r.agenda,
      noticias: r.noticias,
      tarefas: r.tarefas,
    })
  } catch (err) {
    return json(500, { ok: false, mensagem: err.message })
  }
}

const tls = certificado && chave ? { cert: ler(certificado), key: ler(chave) } : null
const servidor = tls ? createHttpsServer(tls, responder) : createServer(responder)
const porta = Number(valor('PORTA') ?? env.APOLO_AURORA_PORTA?.trim() ?? 8791)
servidor.on('error', (err) => {
  console.error(`[aurora] não consegui abrir a porta ${porta}: ${err.message}`)
  process.exit(1)
})
servidor.listen(porta, valor('HOST') ?? '127.0.0.1', () => {
  console.log(`[aurora] A.U.R.O.R.A. servindo o bom dia na porta ${porta}${tls ? '' : ' (sem TLS)'}`)
  if (!youtube.autorizado()) console.log('[aurora] YouTube ainda não autorizado: rode npm run aurora:autorizar')
  void conferirMusica().then(() => problemaDaMusica && console.log(`[aurora] música do bom dia: ${problemaDaMusica}`))
  setInterval(() => void conferirMusica(), CONFERENCIA_MS).unref()
})
const sair = () => servidor.close(() => process.exit(0))
process.on('SIGINT', sair)
process.on('SIGTERM', sair)
