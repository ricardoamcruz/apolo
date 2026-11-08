/**
 * As músicas do Ricardo no YouTube (o YouTube Music usa as mesmas playlists).
 *
 * A autorização é o fluxo de dispositivo do Google: a A.U.R.O.R.A. mostra um
 * código, o Ricardo o digita em google.com/device, e o token de renovação fica em
 * `<pasta>/youtube.json`, só para o usuário. O escopo é só leitura.
 *
 * Nada é baixado: a música toca no player oficial do YouTube, na tela do
 * A.P.O.L.O. Daqui sai só o id do vídeo e de onde começar.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const ESCOPO = 'https://www.googleapis.com/auth/youtube.readonly'
const DISPOSITIVO = 'https://oauth2.googleapis.com/device/code'
const TOKEN = 'https://oauth2.googleapis.com/token'
const API = 'https://www.googleapis.com/youtube/v3'
/** A lista de faixas muda pouco: um dia de cache poupa a cota da API. */
const CACHE_MS = 24 * 60 * 60_000

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

async function postar(url, campos, fetcher) {
  const r = await fetcher(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(campos),
  })
  return { status: r.status, corpo: await r.json().catch(() => ({})) }
}

/**
 * @param clienteId, segredo  o cliente OAuth "TVs e dispositivos de entrada limitados"
 * @param pasta               onde guardar o token e o cache
 */
export function criarYoutube({ clienteId, segredo, pasta, fetcher = fetch, agora = Date.now, aleatorio = Math.random }) {
  const arqToken = join(pasta, 'youtube.json')
  const arqCache = join(pasta, 'faixas.json')

  const lerJson = (arquivo) => {
    try {
      return JSON.parse(readFileSync(arquivo, 'utf8'))
    } catch {
      return null
    }
  }
  const gravar = (arquivo, dados) => {
    mkdirSync(pasta, { recursive: true, mode: 0o700 })
    writeFileSync(arquivo, JSON.stringify(dados, null, 2), { mode: 0o600 })
    chmodSync(arquivo, 0o600)
  }

  const configurado = () => Boolean(clienteId && segredo)
  const autorizado = () => configurado() && existsSync(arqToken)

  /** Pede o código e espera o Ricardo autorizar. `mostrar` recebe { codigo, endereco }. */
  async function autorizar(mostrar) {
    if (!configurado()) throw new Error('faltam APOLO_GOOGLE_CLIENT_ID e APOLO_GOOGLE_CLIENT_SECRET no .env.local')
    const { status, corpo } = await postar(DISPOSITIVO, { client_id: clienteId, scope: ESCOPO }, fetcher)
    if (status !== 200) throw new Error(`o Google recusou o pedido de código: ${corpo.error ?? status}`)
    mostrar({ codigo: corpo.user_code, endereco: corpo.verification_url })
    let intervalo = (corpo.interval ?? 5) * 1000
    const limite = agora() + (corpo.expires_in ?? 1800) * 1000
    while (agora() < limite) {
      await dormir(intervalo)
      const r = await postar(
        TOKEN,
        {
          client_id: clienteId,
          client_secret: segredo,
          device_code: corpo.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        },
        fetcher,
      )
      if (r.status === 200 && r.corpo.refresh_token) {
        gravar(arqToken, { refresh_token: r.corpo.refresh_token, escopo: ESCOPO, em: new Date(agora()).toISOString() })
        return true
      }
      if (r.corpo.error === 'slow_down') intervalo += 5000
      else if (r.corpo.error !== 'authorization_pending') throw new Error(`autorização recusada: ${r.corpo.error ?? r.status}`)
    }
    throw new Error('o código expirou antes da autorização')
  }

  let acesso = null
  async function token() {
    if (acesso && acesso.expira > agora() + 60_000) return acesso.valor
    const salvo = lerJson(arqToken)
    if (!salvo?.refresh_token) throw new Error('o YouTube ainda não foi autorizado: rode npm run aurora:autorizar')
    const r = await postar(
      TOKEN,
      { client_id: clienteId, client_secret: segredo, refresh_token: salvo.refresh_token, grant_type: 'refresh_token' },
      fetcher,
    )
    if (r.status !== 200) throw new Error(`o Google não renovou o acesso: ${r.corpo.error ?? r.status}`)
    acesso = { valor: r.corpo.access_token, expira: agora() + (r.corpo.expires_in ?? 3600) * 1000 }
    return acesso.valor
  }

  async function api(caminho, params) {
    const url = `${API}/${caminho}?${new URLSearchParams(params)}`
    const r = await fetcher(url, { headers: { authorization: `Bearer ${await token()}` } })
    const corpo = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(`YouTube ${caminho}: ${corpo.error?.message ?? r.status}`)
    return corpo
  }

  async function todasAsPaginas(caminho, params, max = 4) {
    const itens = []
    let pagina
    for (let i = 0; i < max; i++) {
      const r = await api(caminho, { ...params, maxResults: '50', ...(pagina ? { pageToken: pagina } : {}) })
      itens.push(...(r.items ?? []))
      pagina = r.nextPageToken
      if (!pagina) break
    }
    return itens
  }

  /**
   * As faixas candidatas: as playlists escolhidas, ou as que têm o filtro no nome
   * ("rock"), ou, sem nenhuma, as músicas curtidas.
   */
  async function faixas({ playlists = [], filtro = 'rock' } = {}) {
    const cache = lerJson(arqCache)
    if (cache && agora() - cache.em < CACHE_MS && cache.chave === JSON.stringify([playlists, filtro])) return cache.faixas
    let ids = playlists
    let origem = 'playlists escolhidas'
    if (!ids.length) {
      const minhas = await todasAsPaginas('playlists', { part: 'snippet', mine: 'true' }, 2)
      const re = new RegExp(filtro, 'i')
      ids = minhas.filter((p) => re.test(p.snippet?.title ?? '')).map((p) => p.id)
      origem = ids.length ? `playlists com "${filtro}" no nome` : 'músicas curtidas'
    }
    let lista = []
    if (ids.length) {
      for (const id of ids) {
        const itens = await todasAsPaginas('playlistItems', { part: 'snippet', playlistId: id })
        lista.push(
          ...itens
            .map((i) => ({ id: i.snippet?.resourceId?.videoId, titulo: i.snippet?.title, canal: i.snippet?.videoOwnerChannelTitle }))
            .filter((f) => f.id && f.titulo !== 'Private video' && f.titulo !== 'Deleted video'),
        )
      }
    } else {
      const curtidas = await todasAsPaginas('videos', { part: 'snippet', myRating: 'like' })
      lista = curtidas
        .filter((v) => v.snippet?.categoryId === '10')
        .map((v) => ({ id: v.id, titulo: v.snippet?.title, canal: v.snippet?.channelTitle }))
    }
    gravar(arqCache, { em: agora(), chave: JSON.stringify([playlists, filtro]), origem, faixas: lista })
    return lista
  }

  /** Uma faixa sorteada e um ponto de partida depois da introdução. */
  async function sortear(opcoes) {
    const lista = await faixas(opcoes)
    if (!lista.length) return null
    const faixa = lista[Math.floor(aleatorio() * lista.length)]
    return { ...faixa, inicio: 45 + Math.floor(aleatorio() * 30) }
  }

  return { configurado, autorizado, autorizar, faixas, sortear }
}
