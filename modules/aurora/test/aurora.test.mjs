/** Testes da A.U.R.O.R.A., sem rede: o Google, o Outlook e o gh são de mentira. */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { agendaDeHoje, diaNoFuso, eventosDoDia } from '../src/agenda.mjs'
import { tarefasDoGithub } from '../src/github.mjs'
import { lerFeed } from '../src/noticias.mjs'
import { bomDia, textoParaVoz } from '../src/resumo.mjs'
import { criarYoutube } from '../src/youtube.mjs'

const ICS = `BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:Reunião com
  o cliente
DTSTART;TZID=E. South America Standard Time:20261109T140000
LOCATION:Sala 2\\, prédio A
END:VEVENT
BEGIN:VEVENT
SUMMARY:Aniversário
DTSTART;VALUE=DATE:20261109
END:VEVENT
BEGIN:VEVENT
SUMMARY:Daily
DTSTART:20261102T120000Z
RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR
EXDATE:20261111T120000Z
END:VEVENT
BEGIN:VEVENT
SUMMARY:Cancelado
DTSTART:20261109T100000
STATUS:CANCELLED
END:VEVENT
BEGIN:VEVENT
SUMMARY:Outro dia
DTSTART:20261110T100000
END:VEVENT
END:VCALENDAR`

test('a agenda do dia: horário local, UTC no fuso, dia inteiro, recorrência e cancelados', () => {
  assert.deepEqual(eventosDoDia(ICS, '20261109'), [
    { titulo: 'Aniversário', hora: null, local: null },
    { titulo: 'Daily', hora: '09:00', local: null },
    { titulo: 'Reunião com o cliente', hora: '14:00', local: 'Sala 2, prédio A' },
  ])
  // Quarta com EXDATE: a daily não acontece; terça não tem daily.
  assert.deepEqual(eventosDoDia(ICS, '20261111').map((e) => e.titulo), [])
  assert.deepEqual(eventosDoDia(ICS, '20261110').map((e) => e.titulo), ['Outro dia'])
  assert.deepEqual(eventosDoDia(ICS, '20261113').map((e) => e.titulo), ['Daily'])
})

test('o dia de hoje é contado no fuso do Ricardo', () => {
  // 01:30 UTC de 9/11 ainda é 8/11 em São Paulo.
  assert.equal(diaNoFuso(new Date('2026-11-09T01:30:00Z')), '20261108')
})

test('sem o link, a agenda diz por quê; com erro HTTP, também', async () => {
  assert.equal((await agendaDeHoje('')).disponivel, false)
  const r = await agendaDeHoje('https://x/cal.ics', { fetcher: async () => ({ ok: false, status: 404 }) })
  assert.match(r.motivo, /404/)
})

test('o feed vira título e fonte, sem a fonte repetida no título', () => {
  const xml = `<rss><channel>
    <item><title>Dólar cai &amp; bolsa sobe - Folha</title><source url="x">Folha</source></item>
    <item><title><![CDATA[IA nova chega]]></title></item>
    <item><title>Terceira</title></item></channel></rss>`
  assert.deepEqual(lerFeed(xml, 2), [
    { titulo: 'Dólar cai & bolsa sobe', fonte: 'Folha' },
    { titulo: 'IA nova chega', fonte: null },
  ])
})

test('GitHub: issues desligadas não são falha; gh quebrado é', async () => {
  const rodar = async (args) => {
    if (args[0] === 'issue') throw new Error("the 'x/y' repository has disabled issues")
    return { stdout: JSON.stringify([{ number: 10, title: 'Fênix' }]) }
  }
  assert.deepEqual(await tarefasDoGithub('x/y', { rodar }), { disponivel: true, prs: [{ number: 10, title: 'Fênix' }], issues: [] })
  const quebrado = await tarefasDoGithub('x/y', { rodar: async () => Promise.reject(new Error('gh: not logged in')) })
  assert.equal(quebrado.disponivel, false)
})

/** Um Google de mentira, com o fluxo de dispositivo e a API do YouTube. */
function googleFalso({ playlists, itens, curtidas = [] }) {
  const pedidos = []
  let pendente = 1
  const fetcher = async (url, opcoes = {}) => {
    pedidos.push(String(url))
    const corpo = (dados, status = 200) => ({ ok: status === 200, status, json: async () => dados })
    if (String(url).endsWith('/device/code')) {
      return corpo({ device_code: 'd', user_code: 'ABC-DEF', verification_url: 'https://www.google.com/device', interval: 0, expires_in: 60 })
    }
    if (String(url).endsWith('/token')) {
      const p = new URLSearchParams(opcoes.body)
      if (p.get('grant_type') === 'refresh_token') return corpo({ access_token: 'at', expires_in: 3600 })
      if (pendente-- > 0) return corpo({ error: 'authorization_pending' }, 428)
      return corpo({ refresh_token: 'rt', access_token: 'at' })
    }
    const u = new URL(url)
    if (u.pathname.endsWith('/playlists')) return corpo({ items: playlists })
    if (u.pathname.endsWith('/playlistItems')) return corpo({ items: itens[u.searchParams.get('playlistId')] ?? [] })
    if (u.pathname.endsWith('/videos')) return corpo({ items: curtidas })
    return corpo({}, 404)
  }
  return { fetcher, pedidos }
}

const item = (id, titulo) => ({ snippet: { title: titulo, videoOwnerChannelTitle: 'Banda - Topic', resourceId: { videoId: id } } })

test('YouTube: autoriza por código, guarda só o token de renovação, e sorteia das playlists de rock', async () => {
  const pasta = mkdtempSync(join(tmpdir(), 'aurora-'))
  const g = googleFalso({
    playlists: [{ id: 'P1', snippet: { title: 'Rock pesado' } }, { id: 'P2', snippet: { title: 'Lo-fi' } }],
    itens: { P1: [item('v1', 'Música A'), item('v2', 'Private video')], P2: [item('x', 'Não')] },
  })
  const yt = criarYoutube({ clienteId: 'c', segredo: 's', pasta, fetcher: g.fetcher, aleatorio: () => 0 })
  assert.equal(yt.autorizado(), false)
  let mostrado
  await yt.autorizar((m) => (mostrado = m))
  assert.deepEqual(mostrado, { codigo: 'ABC-DEF', endereco: 'https://www.google.com/device' })
  const salvo = JSON.parse(readFileSync(join(pasta, 'youtube.json'), 'utf8'))
  assert.equal(salvo.refresh_token, 'rt')
  assert.equal('access_token' in salvo, false)
  assert.equal(statSync(join(pasta, 'youtube.json')).mode & 0o777, 0o600)

  const faixa = await yt.sortear({ filtro: 'rock' })
  assert.deepEqual([faixa.id, faixa.titulo, faixa.inicio, faixa.playlist], ['v1', 'Música A', 45, 'P1'])
  assert.equal(g.pedidos.some((u) => u.includes('playlistId=P2')), false, 'a playlist sem "rock" fica de fora')
})

test('YouTube: sem playlist de rock, usa as músicas curtidas', async () => {
  const pasta = mkdtempSync(join(tmpdir(), 'aurora-'))
  const g = googleFalso({
    playlists: [{ id: 'P2', snippet: { title: 'Lo-fi' } }],
    itens: {},
    curtidas: [
      { id: 'm1', snippet: { title: 'Rock curtido', channelTitle: 'Banda', categoryId: '10' } },
      { id: 'n1', snippet: { title: 'Vlog', channelTitle: 'Alguém', categoryId: '22' } },
    ],
  })
  const yt = criarYoutube({ clienteId: 'c', segredo: 's', pasta, fetcher: g.fetcher, aleatorio: () => 0 })
  await yt.autorizar(() => {})
  assert.deepEqual((await yt.faixas({ filtro: 'rock' })).map((f) => [f.id, f.playlist]), [['m1', 'LM']])
})

test('sem credenciais do Google, autorizar explica o que falta', async () => {
  const yt = criarYoutube({ pasta: mkdtempSync(join(tmpdir(), 'aurora-')) })
  await assert.rejects(yt.autorizar(() => {}), /APOLO_GOOGLE_CLIENT_ID/)
})

test('o bom dia junta tudo, e uma parte quebrada não derruba as outras', async () => {
  const config = { noticias: { temas: [{ nome: 'Tecnologia e IA', busca: 'ia' }] }, tarefas: { github: 'x/y' } }
  const fetcher = async (url) => {
    if (String(url).includes('news.google.com')) {
      return { ok: true, status: 200, text: async () => '<item><title>IA nova - G1</title><source>G1</source></item>' }
    }
    throw new Error('sem rede')
  }
  const r = await bomDia({
    config,
    youtube: { autorizado: () => false },
    agendaIcs: 'https://x/cal.ics',
    fetcher,
    agora: new Date('2026-11-09T12:00:00Z'),
    rodarGh: async () => ({ stdout: '[]' }),
  })
  assert.equal(r.musica, null)
  assert.match(r.avisoDaMusica, /não foi autorizado/)
  assert.equal(r.agenda.disponivel, false)
  const texto = textoParaVoz(r, new Date('2026-11-09T12:00:00Z'))
  assert.match(texto, /segunda-feira, 9 de novembro/)
  assert.match(texto, /Tecnologia e IA: IA nova\./)
  assert.match(texto, /GitHub: 0 PRs abertos e 0 issues\./)
  assert.match(texto, /Agenda indisponível/)
})

test('a A.U.R.O.R.A. não importa nada de fora da própria pasta', () => {
  const raiz = fileURLToPath(new URL('..', import.meta.url))
  const arquivos = []
  const varrer = (pasta) => {
    for (const nome of readdirSync(pasta)) {
      const caminho = join(pasta, nome)
      if (statSync(caminho).isDirectory()) varrer(caminho)
      else if (nome.endsWith('.mjs')) arquivos.push(caminho)
    }
  }
  varrer(raiz)
  for (const arquivo of arquivos) {
    for (const [, alvo] of readFileSync(arquivo, 'utf8').matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)) {
      assert.ok(alvo.startsWith('node:') || alvo.startsWith('./') || /^\.\.\/src\//.test(alvo), `${arquivo} importa ${alvo}`)
    }
  }
})
