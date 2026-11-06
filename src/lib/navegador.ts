/**
 * Controle do navegador, do lado da interface (RF-19, ADR 0012).
 *
 * Quem sabe em que navegador e em que sistema o A.P.O.L.O. está aberto é a
 * página — nada no servidor tem como saber. E quem consegue abrir uma aba no
 * navegador em que a pessoa está olhando também é a página. Por isso este
 * módulo existe aqui, e a ponte pergunta.
 *
 * Três coisas, e cada uma tem um limite que vale conhecer:
 *
 *   - Detecção. O navegador só conta de si o que quer: a versão do macOS vem
 *     congelada em 10.15.7 há anos, o Safari assina "Version/x Safari/y" e o
 *     Edge finge ser Chrome até o fim da linha. Então aqui tudo é lido na ordem
 *     do mais específico para o mais genérico, e o que não dá para afirmar volta
 *     como `null` em vez de palpite.
 *   - Abrir aba. Sem clique por trás, o bloqueador de popups recusa, e a recusa
 *     é a resposta honesta: `window.open` devolve `null` e a pessoa precisa
 *     liberar popups para este endereço, uma vez. Não há como contornar isso
 *     pela página, e tentar esconder a recusa seria mentir sobre uma aba que não
 *     existe.
 *   - Popup em aba. A página só alcança janelas que ela mesma abriu — é regra do
 *     navegador, não limitação daqui. Para as outras, o endereço precisa vir de
 *     fora (as ferramentas `chrome_*` sabem ler as abas do Chrome).
 *
 * Toda janela nasce em `about:blank`, perde o `opener` e só então navega para o
 * destino. É o que impede uma página aberta a partir de um endereço que o modelo
 * leu na web de mexer nesta aqui pelo `window.opener`.
 */

export type BrowserRequest = {
  action: 'environment' | 'open' | 'popup-to-tab' | 'windows'
  url?: string
  id?: string
  as?: 'tab' | 'popup'
  width?: number
  height?: number
}

export type BrowserReply = Record<string, unknown>

export type Environment = {
  browser: string
  version: string | null
  engine: string
  system: string
  systemVersion: string | null
  mobile: boolean
  touch: boolean
  screen: string
  language: string
  /** A interface está numa popup, e não numa aba normal. */
  inPopup: boolean
}

// ---------------------------------------------------------------------------
// Detecção
// ---------------------------------------------------------------------------

type Brand = { brand: string; version: string }

type UAData = { brands?: Brand[]; platform?: string; mobile?: boolean }

const uaData = (): UAData =>
  ((navigator as Navigator & { userAgentData?: UAData }).userAgentData ?? {}) as UAData

/** Versão declarada para um nome de produto no User-Agent. */
function versionOf(ua: string, product: string): string | null {
  const m = new RegExp(`${product}/([0-9][0-9._]*)`).exec(ua)
  return m ? m[1] : null
}

/**
 * Qual navegador, do mais específico para o mais genérico.
 *
 * A ordem é o algoritmo inteiro: Edge, Opera e Vivaldi carregam "Chrome/" no
 * User-Agent, e o Chrome carrega "Safari/". Perguntar por "Chrome" primeiro
 * responde "Chrome" para metade dos navegadores que existem.
 *
 * O Brave esconde a marca de propósito, para não ser rastreado por ela, e se
 * entrega por `navigator.brave`. O Arc não se declara de jeito nenhum — a
 * resposta honesta ali é "Chromium", que é o que ele é.
 */
function detectBrowser(ua: string): { browser: string; version: string | null } {
  const brands = uaData().brands ?? []
  const brand = (name: string) => brands.find((b) => b.brand.includes(name))

  if (/\bEdg[A-Z]?\//.test(ua)) {
    return { browser: 'Microsoft Edge', version: versionOf(ua, 'Edg[A-Z]?') }
  }
  if (/\bOPR\//.test(ua)) return { browser: 'Opera', version: versionOf(ua, 'OPR') }
  if (/\bVivaldi\//.test(ua)) return { browser: 'Vivaldi', version: versionOf(ua, 'Vivaldi') }
  if (/\bSamsungBrowser\//.test(ua)) {
    return { browser: 'Samsung Internet', version: versionOf(ua, 'SamsungBrowser') }
  }
  if ('brave' in navigator) {
    return { browser: 'Brave', version: versionOf(ua, 'Chrome') }
  }
  if (/\bFirefox\//.test(ua)) return { browser: 'Firefox', version: versionOf(ua, 'Firefox') }
  if (/\bChrome\//.test(ua)) {
    // `brands` distingue Chrome de um Chromium qualquer melhor que a string.
    const chrome = brand('Google Chrome')
    return {
      browser: chrome ? 'Google Chrome' : brand('Chromium') ? 'Chromium' : 'Google Chrome',
      version: chrome?.version ?? versionOf(ua, 'Chrome'),
    }
  }
  if (/\bSafari\//.test(ua)) return { browser: 'Safari', version: versionOf(ua, 'Version') }
  return { browser: 'desconhecido', version: null }
}

/** O motor, que é o que decide o comportamento quando o nome engana. */
function detectEngine(ua: string): string {
  if (/\bGecko\/\d/.test(ua)) return 'Gecko'
  if (/\bChrome\/|\bChromium\//.test(ua)) return 'Blink'
  if (/\bAppleWebKit\//.test(ua)) return 'WebKit'
  return 'desconhecido'
}

/**
 * Qual sistema, e qual versão quando ela quer dizer algo.
 *
 * O macOS é o caso que obriga a ressalva: desde 2021 todo navegador declara
 * `Mac OS X 10_15_7`, qualquer que seja a versão real. Devolver isso como fato
 * seria informação errada com cara de precisa, então vira `null` — a interface
 * prefere não saber a afirmar o que não é.
 */
function detectSystem(ua: string): { system: string; systemVersion: string | null } {
  const platform = uaData().platform

  if (/\b(iPhone|iPad|iPod)\b/.test(ua) || platform === 'iOS') {
    const m = /OS (\d+[._]\d+(?:[._]\d+)?)/.exec(ua)
    return { system: 'iOS', systemVersion: m ? m[1].replace(/_/g, '.') : null }
  }
  if (/\bAndroid\b/.test(ua) || platform === 'Android') {
    const m = /Android (\d+(?:\.\d+)*)/.exec(ua)
    return { system: 'Android', systemVersion: m ? m[1] : null }
  }
  if (/\bCrOS\b/.test(ua) || platform === 'Chrome OS') {
    return { system: 'ChromeOS', systemVersion: null }
  }
  if (/\bMac OS X\b/.test(ua) || platform === 'macOS') {
    const m = /Mac OS X (\d+[._]\d+(?:[._]\d+)?)/.exec(ua)
    const lida = m ? m[1].replace(/_/g, '.') : null
    return { system: 'macOS', systemVersion: lida === '10.15.7' ? null : lida }
  }
  if (/\bWindows NT\b/.test(ua) || platform === 'Windows') {
    // Windows 11 também se declara "NT 10.0"; a diferença só vem da API de alta
    // entropia, que é assíncrona e pede permissão. Não vale o preço.
    const m = /Windows NT (\d+\.\d+)/.exec(ua)
    return { system: 'Windows', systemVersion: m?.[1] === '10.0' ? '10 ou 11' : (m?.[1] ?? null) }
  }
  if (/\bLinux\b/.test(ua) || platform === 'Linux') {
    return { system: 'Linux', systemVersion: null }
  }
  return { system: platform || 'desconhecido', systemVersion: null }
}

/**
 * Esta página está numa popup?
 *
 * `window.opener` pega o caso de alguém ter aberto a interface por script.
 * `locationbar.visible` pega o caso de uma janela sem barra de endereço, que é
 * o que a pessoa chama de popup quando olha para a tela.
 */
function inPopup(): boolean {
  if (window.opener !== null) return true
  return window.locationbar?.visible === false
}

export function detectEnvironment(): Environment {
  const ua = navigator.userAgent
  return {
    ...detectBrowser(ua),
    engine: detectEngine(ua),
    ...detectSystem(ua),
    mobile: uaData().mobile ?? /\bMobi\b/.test(ua),
    touch: navigator.maxTouchPoints > 0,
    screen: `${window.screen.width}x${window.screen.height}`,
    language: navigator.language,
    inPopup: inPopup(),
  }
}

// ---------------------------------------------------------------------------
// Abas e popups
// ---------------------------------------------------------------------------

type Opened = { id: string; url: string; as: 'tab' | 'popup'; ref: Window }

const opened = new Map<string, Opened>()
let seq = 0

/** O que o usuário fechou na mão não existe mais; a lista se limpa sozinha. */
function forget() {
  for (const [id, janela] of opened) {
    if (janela.ref.closed) opened.delete(id)
  }
}

/**
 * Só http e https.
 *
 * O endereço pode ter vindo de uma página que o modelo acabou de ler, então
 * `javascript:` abriria código de terceiro dentro desta origem e `file:` leria
 * o disco. Nada disso é "abrir uma aba".
 */
function safeUrl(raw: string): URL | null {
  try {
    const url = new URL(String(raw).trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

const BLOCKED =
  'O navegador bloqueou a janela: ele só abre janelas que um clique pediu, e ' +
  'este pedido veio por voz. Para liberar, nas configurações do site desta ' +
  'página marque "Permitir pop-ups e redirecionamentos" — uma vez só.'

function open(raw: string, as: 'tab' | 'popup', width?: number, height?: number): BrowserReply {
  const url = safeUrl(raw)
  if (!url) {
    return { error: 'Endereço inválido: só abro endereços http ou https completos.' }
  }

  const features =
    as === 'popup'
      ? `popup=1,width=${Math.round(width ?? 900)},height=${Math.round(height ?? 700)}`
      : ''

  /**
   * Nasce em branco, perde o opener, e só então navega.
   *
   * `about:blank` aberta por nós é da nossa própria origem, então `opener =
   * null` funciona aqui — num destino de outra origem o navegador recusaria a
   * escrita e a página aberta ficaria com uma referência a esta, podendo
   * navegá-la para onde quisesse. Depois de desligado, o opener não volta.
   */
  const ref = window.open('about:blank', '_blank', features)
  if (!ref) return { error: BLOCKED }
  try {
    ref.opener = null
  } catch {
    /* alguma origem recusou: o navegador já está isolando mais que nós */
  }
  ref.location.replace(url.href)

  const id = `j${++seq}`
  opened.set(id, { id, url: url.href, as, ref })
  return { id, url: url.href, as }
}

/** Abre o endereço como aba e só então fecha a popup — nessa ordem. */
async function popupToTab(id?: string, url?: string): Promise<BrowserReply> {
  forget()
  const janela = id ? opened.get(id) : undefined
  if (id && !janela) {
    return {
      error:
        `Não há janela com o identificador ${id} — ou ela já foi fechada. ` +
        'Veja as janelas abertas, ou passe o endereço da popup.',
    }
  }
  const endereco = url ?? janela?.url
  if (!endereco) {
    return {
      error:
        'Sem identificador nem endereço não dá: a página não consegue ver uma ' +
        'popup que não foi ela que abriu.',
    }
  }

  const aba = open(endereco, 'tab')
  // A aba falhou. A popup fica onde está: perder a janela que a pessoa tinha
  // seria pior que não converter nada.
  if (aba.error) return aba

  let popupClosed: boolean | undefined
  if (janela) {
    try {
      janela.ref.close()
    } catch {
      /* o navegador recusou; o `closed` abaixo conta a verdade */
    }
    // `close()` é assíncrono o bastante para `closed` ainda ser falso no mesmo
    // instante. Um quadro é suficiente para a janela realmente sumir.
    await new Promise((ok) => setTimeout(ok, 150))
    popupClosed = janela.ref.closed
    if (popupClosed) opened.delete(janela.id)
  }

  return { ...aba, popupClosed }
}

/**
 * Um pedido da ponte (`bridge/navegador.mjs`). Nunca lança: do outro lado há um
 * turno esperando, e uma exceção aqui viraria silêncio até o tempo esgotar.
 */
export async function handleBrowser(req: BrowserRequest): Promise<BrowserReply> {
  try {
    switch (req.action) {
      case 'environment':
        return { environment: detectEnvironment() }
      case 'open':
        return open(req.url ?? '', req.as === 'popup' ? 'popup' : 'tab', req.width, req.height)
      case 'popup-to-tab':
        return await popupToTab(req.id, req.url)
      case 'windows':
        forget()
        return {
          windows: [...opened.values()].map(({ id, url, as }) => ({ id, url, as })),
        }
      default:
        return { error: `Não sei fazer "${req.action}" com o navegador.` }
    }
  } catch (err) {
    return { error: `Falhou no navegador: ${(err as Error)?.message ?? String(err)}` }
  }
}
