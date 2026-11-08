/**
 * Notícias por tema, dos feeds RSS do Google Notícias em português. Gratuitos e
 * sem chave. Os temas ficam em aurora.config.json, para o Ricardo mudar quando quiser.
 */

const feed = (busca) =>
  `https://news.google.com/rss/search?${new URLSearchParams({ q: `${busca} when:1d`, hl: 'pt-BR', gl: 'BR', ceid: 'BR:pt-419' })}`

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" }
const limpar = (t) =>
  t
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, e) => ENTIDADES[e])
    .replace(/<[^>]+>/g, '')
    .trim()

/** Título e fonte de cada item. O Google põe a fonte no fim do título: "... - Folha". */
export function lerFeed(xml, max = 3) {
  const itens = []
  for (const [, item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const titulo = limpar(/<title>([\s\S]*?)<\/title>/.exec(item)?.[1] ?? '')
    const fonte = limpar(/<source[^>]*>([\s\S]*?)<\/source>/.exec(item)?.[1] ?? '')
    if (!titulo) continue
    const semFonte = fonte && titulo.endsWith(` - ${fonte}`) ? titulo.slice(0, -fonte.length - 3) : titulo
    itens.push({ titulo: semFonte, fonte: fonte || null })
    if (itens.length >= max) break
  }
  return itens
}

export async function noticiasDoDia(temas, { porTema = 3, fetcher = fetch } = {}) {
  return Promise.all(
    temas.map(async ({ nome, busca }) => {
      try {
        const r = await fetcher(feed(busca), { signal: AbortSignal.timeout(10_000) })
        if (!r.ok) return { tema: nome, itens: [], motivo: `o Google Notícias respondeu ${r.status}` }
        return { tema: nome, itens: lerFeed(await r.text(), porTema) }
      } catch (err) {
        return { tema: nome, itens: [], motivo: err.message }
      }
    }),
  )
}
