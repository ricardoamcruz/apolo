import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { arch, release } from 'node:os'
import { chromeAvailable } from './chrome.mjs'

/**
 * Controle do navegador onde o A.P.O.L.O. está aberto (RF-19).
 *
 * Isto não substitui `bridge/chrome.mjs`. São dois alcances diferentes, e a
 * diferença importa:
 *
 *   - `chrome_*` fala com a extensão do Claude por um socket local. É a MÃO
 *     dentro das páginas: ler, clicar, digitar, em qualquer aba do Chrome. Só
 *     existe se o Chrome estiver aberto com a extensão ativa.
 *   - `browser_*`, aqui, fala com a própria interface pelo WebSocket que já
 *     está aberto. É o CONTEXTO: em que navegador e em que sistema a interface
 *     está rodando, e as janelas que o A.P.O.L.O. abriu. Funciona em qualquer
 *     navegador, inclusive sem extensão nenhuma — e é o único jeito de saber o
 *     que está do outro lado da tela, porque quem sabe isso é a página.
 *
 * Como a câmera (`bridge/vision.mjs`), estas ferramentas precisam PERGUNTAR e
 * esperar: a resposta está no navegador, o modelo está aqui. Elas usam o mesmo
 * canal de pedido e resposta, com `type: 'browser'`.
 *
 * Um aviso que vale repetir, porque é a falha que o Ricardo vai encontrar
 * primeiro: abrir aba a partir de uma mensagem do WebSocket não tem "gesto do
 * usuário" por trás, e o bloqueador de popups do navegador recusa esse caso por
 * padrão. A interface detecta a recusa e diz isso em uma frase, com o que fazer
 * — liberar popups para o endereço da interface, uma vez. Ver ADR 0012.
 */

/** `process.platform` em nome de gente. */
const SISTEMAS = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
  freebsd: 'FreeBSD',
  openbsd: 'OpenBSD',
  sunos: 'SunOS',
  aix: 'AIX',
}

/** Quanto esperar pela interface. Generoso: abrir janela é instantâneo, mas a
 *  conversão fecha uma popup e confere o resultado antes de responder. */
const TIMEOUT_MS = 10_000

const texto = (text) => ({ content: [{ type: 'text', text }] })
const recusa = (text) => ({ isError: true, content: [{ type: 'text', text }] })

const ENVIRONMENT_DESCRIPTION = `Find out where A.P.O.L.O. is actually running.

Reports three things: which browser the interface is open in (name, version,
engine), which operating system that browser is on, and which system the bridge
process itself runs on. Also whether the Claude browser extension — the one the
chrome_* tools need — is reachable at all.

Call it when the user asks what browser or machine this is, when a keyboard
shortcut differs between platforms and you are about to name a key, or when a
browser action has just behaved oddly and the browser itself is a candidate.

The interface and the bridge are usually on the same machine, but they do not
have to be, so they are reported separately. Versions come from what the browser
is willing to say about itself and are routinely frozen or rounded — do not
present them as exact.`

const OPEN_TAB_DESCRIPTION = `Open a URL as a new tab in the browser the user is looking at.

This is their own browser, where the interface is open — not an automation
profile, and not necessarily Chrome.

Use it ONLY when the user asked for a tab or a window: "open this in a tab",
"leave it open for me", "I want it in the browser". Everything you merely want
to SHOW them goes on a panel instead, with \`blade\` or \`display\` — a tab is
somewhere else to look, and the interface is where they are looking. Reaching
into a page to read or act on it is chrome_*, not this.

Two shapes, via \`as\`: a tab (the default, and almost always right) or a popup
window, which exists mainly so there is something to convert back with
browser_popup_to_tab.

Browsers refuse to open windows that no click asked for, so the first call of a
session can come back blocked. That is a one-time browser setting, not a
failure of the page — the result says what to tell the user.`

const POPUP_TO_TAB_DESCRIPTION = `Turn a popup window into an ordinary tab.

A popup is a window with no address bar and no tab strip: easy to lose behind
something, impossible to bookmark, and it dies with whatever opened it. Moving
it into a tab is almost always what the user wants.

Give \`id\` for a popup A.P.O.L.O. opened — browser_windows lists them. Give
\`url\` for any other popup, including one a site opened by itself: the page
cannot see windows it did not open, so the address has to be named. chrome_tabs
can tell you the address of a popup the extension can see.

What happens: the address opens as a tab, and only then is the popup closed —
in that order, so a blocked tab never costs the user the window they had. The
result says whether the popup really closed, because a window the user has
navigated inside cannot always be closed by script.

One limit worth knowing: for a tracked popup the address used is the one it was
opened with. If the user browsed somewhere else inside it, that is not visible
from here — pass \`url\` when you know better.`

const WINDOWS_DESCRIPTION = `List the tabs and popups A.P.O.L.O. opened in this browser session.

Only those. A page cannot see windows it did not open, and closed ones drop off
the list on their own. For everything else in the browser, chrome_tabs.

Useful before browser_popup_to_tab, to get the id of the popup to convert.`

/**
 * @param {(kind: string, args: object, timeoutMs?: number) => Promise<object>} ask
 *   Manda um pedido à interface e resolve com a resposta dela.
 */
export function navegadorServer(ask) {
  /** Todo pedido à interface falha do mesmo jeito: a interface não está lá. */
  const pedir = async (args) => {
    try {
      return await ask('browser', args, TIMEOUT_MS)
    } catch (err) {
      return {
        error:
          `A interface não respondeu: ${err?.message ?? err}. ` +
          'Diga ao usuário que não dá para mexer no navegador agora e siga sem isso.',
      }
    }
  }

  return createSdkMcpServer({
    name: 'apolo_ambiente',
    version: '1.0.0',
    instructions:
      'Where A.P.O.L.O. is running — the browser the interface is open in, the ' +
      'system under it — and the tabs and popups it has opened there. For ' +
      'reading or acting inside a page, use the chrome_* tools instead.',
    // Atrás da busca de ferramentas, "em que navegador você está?" viraria um
    // palpite, que é exatamente o que este requisito existe para evitar.
    alwaysLoad: true,
    tools: [
      tool('browser_environment', ENVIRONMENT_DESCRIPTION, {}, async () => {
        const [resposta, extensao] = await Promise.all([
          pedir({ action: 'environment' }),
          chromeAvailable(),
        ])

        const nucleo = {
          sistema: SISTEMAS[process.platform] ?? process.platform,
          versaoDoKernel: release(),
          arquitetura: arch(),
          node: process.version,
        }

        if (resposta.error) {
          // A metade que dá para saber ainda vale: o sistema do núcleo vem
          // deste processo e não depende de a interface responder.
          return texto(
            `A interface não informou o navegador: ${resposta.error}\n` +
              `O núcleo roda em ${nucleo.sistema} ${nucleo.arquitetura}.\n` +
              `Extensão do Claude no navegador: ${extensao ? 'disponível' : 'indisponível'}.`,
          )
        }

        const i = resposta.environment ?? {}
        const versao = i.version ? ` ${i.version}` : ''
        const sistema = i.systemVersion ? `${i.system} ${i.systemVersion}` : i.system
        return texto(
          `A interface está no ${i.browser ?? 'navegador desconhecido'}${versao} ` +
            `(motor ${i.engine ?? 'desconhecido'}) sobre ${sistema ?? 'sistema desconhecido'}.\n` +
            `O núcleo roda em ${nucleo.sistema} ${nucleo.arquitetura}, Node ${nucleo.node}.\n` +
            `Extensão do Claude no navegador: ${extensao ? 'disponível' : 'indisponível'}.\n` +
            `Detalhes: ${JSON.stringify({ interface: i, nucleo }, null, 1)}`,
        )
      }),

      tool(
        'browser_open_tab',
        OPEN_TAB_DESCRIPTION,
        {
          url: z.string().describe('Absolute http or https address. Nothing else opens.'),
          as: z
            .enum(['tab', 'popup'])
            .optional()
            .catch(undefined)
            .describe('tab = the default. popup = a bare window, rarely what anyone wants.'),
          width: z
            .union([z.number(), z.string()])
            .optional()
            .catch(undefined)
            .describe('Popup width in pixels. Ignored for a tab.'),
          height: z
            .union([z.number(), z.string()])
            .optional()
            .catch(undefined)
            .describe('Popup height in pixels. Ignored for a tab.'),
        },
        async (args) => {
          const resposta = await pedir({
            action: 'open',
            url: String(args.url ?? ''),
            as: args.as === 'popup' ? 'popup' : 'tab',
            width: Number(args.width) || undefined,
            height: Number(args.height) || undefined,
          })
          if (resposta.error) return recusa(String(resposta.error))
          const tipo = resposta.as === 'popup' ? 'popup' : 'aba'
          return texto(
            `Aberto como ${tipo} (identificador ${resposta.id}): ${resposta.url}`,
          )
        },
      ),

      tool(
        'browser_popup_to_tab',
        POPUP_TO_TAB_DESCRIPTION,
        {
          id: z
            .string()
            .optional()
            .catch(undefined)
            .describe('Identifier of a popup A.P.O.L.O. opened, from browser_windows.'),
          url: z
            .string()
            .optional()
            .catch(undefined)
            .describe('The address to open as a tab. Required for any popup without an id.'),
        },
        async (args) => {
          const resposta = await pedir({
            // `windowId`, e não `id`: o canal de pedido e resposta já usa `id`
            // para casar a resposta com a pergunta, e um `id` aqui sobrescreveria
            // o dele — a resposta voltaria sem dono e o turno travaria.
            windowId: args.id ? String(args.id) : undefined,
            url: args.url ? String(args.url) : undefined,
            action: 'popup-to-tab',
          })
          if (resposta.error) return recusa(String(resposta.error))
          // Três desfechos diferentes, e dizer o errado faria o usuário procurar
          // uma janela que ainda está lá — ou fechar uma que já sumiu.
          const popup =
            resposta.popupClosed === true
              ? 'A popup foi fechada.'
              : resposta.popupClosed === false
                ? 'A popup antiga continuou aberta: o navegador não deixou fechá-la, ' +
                  'então ela fica para o usuário fechar.'
                : 'A popup antiga não foi tocada — ela não foi aberta por aqui, e a ' +
                  'página não alcança janelas que não abriu. Feche a aba dela com ' +
                  'chrome_close_tab se a extensão a estiver vendo; se não, diga ao ' +
                  'usuário para fechá-la.'
          return texto(
            `Agora é uma aba (identificador ${resposta.id}): ${resposta.url}. ${popup}`,
          )
        },
      ),

      tool('browser_windows', WINDOWS_DESCRIPTION, {}, async () => {
        const resposta = await pedir({ action: 'windows' })
        if (resposta.error) return recusa(String(resposta.error))
        const janelas = Array.isArray(resposta.windows) ? resposta.windows : []
        if (!janelas.length) {
          return texto('O A.P.O.L.O. não tem nenhuma aba ou popup aberta nesta sessão.')
        }
        return texto(
          janelas
            .map((j) => `${j.id} · ${j.as === 'popup' ? 'popup' : 'aba'} · ${j.url}`)
            .join('\n'),
        )
      }),
    ],
  })
}
