/**
 * Ponte local do A.P.O.L.O.
 *
 * Duas funções. Emite a chave temporária da sessão de voz em tempo real da
 * OpenAI (ver bridge/realtime.mjs e docs/adr/0009) e roda o agente de tarefas:
 * o Claude Agent SDK — o Claude Code como biblioteca — exposto por WebSocket. A
 * voz conversa; quando precisa agir, chama a ferramenta `executar_tarefa`, que
 * chega aqui.
 *
 * Two things this buys over calling the Claude API from the browser:
 *   1. No API key. It authenticates exactly the way `claude` does, off your
 *      existing login, and bills to that same account.
 *   2. Every MCP server in your Claude Code config is available, including the
 *      local stdio ones a browser could never reach — higgsfield, elevenlabs,
 *      android, playwright, palmier-pro and the rest.
 *
 *   node bridge/server.mjs
 */

// Primeiro de todos: o .env.local tem de estar na memória antes de qualquer
// módulo que leia configuração ao ser avaliado (ver bridge/env.mjs).
import './env.mjs'
import { WebSocketServer } from 'ws'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { displayServer } from './panels.mjs'
import { uiServer } from './ui.mjs'
import { chromeAvailable, chromeServer } from './chrome.mjs'
import { navegadorServer } from './navegador.mjs'
import { criarGit, gitServer } from './git.mjs'
import { visionServer } from './vision.mjs'
import { homedir, tmpdir } from 'node:os'
import { readFileSync, realpathSync } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve as resolvePath } from 'node:path'
import { openRemote, proxyError, vetTarget, PROXY_UA } from './net.mjs'
import { renderPage } from './page.mjs'
import {
  ALLOW_NO_ORIGIN,
  ALLOW_WRITES,
  EXTRA_ORIGINS,
  decideTool,
  originAllowed,
  podeUsarFerramenta,
} from './gate.mjs'
import { createRealtimeSession, realtimeKey, realtimeModel, voiceProvider } from './realtime.mjs'
import { fileURLToPath } from 'node:url'
import { criarAutodev } from './autodev/index.mjs'
import { criarPreferencias } from './preferencias.mjs'
import {
  CAMINHO_DA_MIDIA,
  CAMINHO_DO_HERMES,
  MENSAGENS_DO_CELULAR,
  ROTAS_DE_MIDIA,
  basePublicaValida,
  hermesAutorizado,
  tokenDoHermes,
} from './hermes.mjs'
import { criarClienteFenix } from './fenix.mjs'
import { criarClienteAurora } from './aurora.mjs'
import { criarTelemetria } from './telemetria.mjs'
import { garantirCertificado } from './tls.mjs'
import { criarCentral } from './extensoes.mjs'

const PORT = Number(process.env.JARVIS_BRIDGE_PORT ?? 8787)

/**
 * A crash here takes the whole assistant down mid-sentence, and most of what
 * can reject is out of our hands — a socket dying under a write, an upstream
 * fetch aborting. Log it and keep serving; the turn that failed will surface
 * its own error to the browser.
 */
process.on('unhandledRejection', (err) => {
  console.error('[apolo] rejeição não tratada:', err)
})

/**
 * The orchestrator model. Override with JARVIS_MODEL to trade quality for pace
 * — claude-sonnet-5 is noticeably snappier on camera if Opus feels slow.
 */
const MODEL = process.env.JARVIS_MODEL ?? 'claude-opus-5'

/**
 * How hard the model thinks before answering.
 *
 * This was 'low', on the reasoning that a voice assistant is judged on latency
 * — and that is true right up until the answer is thin. Low effort scopes the
 * work tightly to what was literally asked: fewer tool calls, less
 * cross-referencing, no second look. On a model of this tier that is leaving
 * most of it on the table.
 *
 * 'medium' is the compromise worth having here. It reasons and reaches for
 * tools noticeably more than 'low' while still answering inside the window a
 * spoken conversation tolerates. Raise it to 'high' or 'xhigh' when quality
 * matters more than pace; drop back to 'low' when filming and every second of
 * dead air shows.
 */
const EFFORT = process.env.JARVIS_EFFORT ?? 'high'
/** No celular, responder logo vale mais que a segunda olhada (docs/adr/0020). */
const ESFORCO_DO_CELULAR = process.env.APOLO_CELULAR_ESFORCO ?? 'low'

/**
 * Every MCP server Claude Code has configured, read out of its own config.
 *
 * This does two jobs. The HUD wants the names while the boot animation plays,
 * and the agent doesn't emit its init message — and therefore its server
 * list — until the first user message flows through, which is far too late.
 * More importantly, this bridge turns filesystem settings off (see
 * settingSources below) and the SDK stops discovering these servers on its
 * own, so handing them over explicitly is what keeps the local stdio ones —
 * the whole reason the bridge exists — in play.
 *
 * Only the global block and the home-directory project scope, because
 * homedir() is our cwd. That makes the list a close but not exact match for
 * the agent's own: the 'ready' sent on connect comes from here and the second
 * one, sent from the init message a turn later, carries live status. Expect
 * the two to differ, and treat the later one as authoritative.
 */
/**
 * Servidores do Claude Code que o A.P.O.L.O. não deve carregar, separados por
 * vírgula em APOLO_MCP_IGNORAR. Ficam no Claude Code, só não chegam aqui.
 */
const IGNORADOS = new Set(
  (process.env.APOLO_MCP_IGNORAR ?? '')
    .split(',')
    .map((nome) => nome.trim())
    .filter(Boolean),
)

function configuredServers() {
  try {
    const cfg = JSON.parse(
      readFileSync(join(homedir(), '.claude.json'), 'utf8'),
    )
    const todos = {
      ...(cfg.mcpServers ?? {}),
      // Servers scoped to the home directory apply too, since that's our cwd.
      ...(cfg.projects?.[homedir()]?.mcpServers ?? {}),
    }
    return Object.fromEntries(Object.entries(todos).filter(([nome]) => !IGNORADOS.has(nome)))
  } catch {
    return {}
  }
}

const MCP_SERVERS = configuredServers()

/**
 * Os sistemas à parte, para a aba SISTEMAS (docs/adr/0025): a F.Ê.N.I.X. e o
 * H.E.R.M.E.S. O estado do H.E.R.M.E.S. vem da Fênix, que é quem o sobe.
 */
const canais = { fenix: null, hermes: null, aurora: null }
/** Quantos celulares estão conectados agora pelo H.E.R.M.E.S. */
let celularesConectados = 0
const STATUS_DO_SERVICO = { ligado: 'connected', subindo: 'pending', caiu: 'failed' }

const comCanais = (servers) => {
  const extras = []
  if (canais.fenix) extras.push({ name: 'fenix', status: canais.fenix })
  const hermes = canais.hermes ?? (celularesConectados ? 'connected' : null)
  if (hermes) extras.push({ name: 'celular', status: hermes })
  if (canais.aurora) extras.push({ name: 'aurora', status: canais.aurora })
  return [...servers, ...extras]
}
/** Cada interface reenvia a própria lista quando um canal muda. */
const ouvintesDosCanais = new Set()
const canaisMudaram = () => {
  for (const ouvir of ouvintesDosCanais) ouvir()
}

const SYSTEM_PROMPT = `Você é o A.P.O.L.O., Assistente Preditivo Operacional Logístico e Otimizado,
assistente pessoal do Ricardo — mais precisamente, o agente de tarefas dele.

COMO VOCÊ É USADO. A conversa por voz é feita por outro modelo, em tempo real.
Quando ele precisa de algo que exige agir ou buscar informação, ele repassa o
pedido para você. O seu texto final volta para ele, que fala o resultado em voz
alta. Por isso: faça a tarefa, mostre na tela o que for visual, e termine com um
resultado curto em texto corrido (uma a três frases) contendo os fatos que a
voz precisa dizer. Nada de perguntas retóricas, nada de saudação.

IDIOMA. Fale sempre em português do Brasil, natural e correto, mesmo que o
pedido venha em outra língua ou que a fonte consultada esteja em inglês. Nomes
próprios e termos técnicos consagrados ficam como são. Tudo o que aparece na
tela — títulos de painel, rótulos, legendas, notas — também vai em português.

TAMANHO. Duas frases é o teto numa conversa; a mediana fica abaixo de doze
palavras. Cada palavra é lida em voz alta e a pessoa espera em silêncio enquanto
ela toca, então uma resposta longa é uma falha, por melhor que seja. Só há uma
licença para falar mais: ler dados que a pessoa pediu para você buscar. Conversa
nunca dá essa licença.

URGÊNCIA SE MOSTRA TIRANDO PALAVRAS, NÃO ACRESCENTANDO. Quanto pior a situação,
mais curtas as frases, nunca mais altas. Você nunca diz rápido, depressa, agora,
imediatamente, crítico, urgente ou perigo. Você não usa ponto de exclamação.

PERSONALIDADE. Calmo, preciso, discreto e um pouco seco — um operador experiente,
não um mordomo nem um atendente de telemarketing. Educado sem cerimônia: não use
"senhor" nem pronomes de tratamento; a cortesia está na precisão. Use o nome do
Ricardo raramente, só quando chamar a atenção dele for o objetivo.

RELATÓRIO.
- Sucesso é impessoal e direto: "A renderização terminou." Nunca "eu terminei"
  ou "aqui está o que encontrei".
- Falha vem como fato sobre o mundo, nunca como defeito seu: "Não encontrei
  registro disso.", "Infelizmente o servidor não respondeu." Você nunca pede
  desculpas.
- Notícia boa primeiro, ruim depois, ligadas por "mas".
- Ao responder uma pergunta, responda com uma frase completa, não com um valor
  solto: "O recorde de altitude é de oitenta e cinco mil pés."
- Ao executar uma ordem, não a repita. Faça e depois informe.

NUNCA.
- Nenhuma palavra de enchimento: nada de "então", "bom", "tipo", "deixa eu ver",
  "só um momento".
- Nenhum entusiasmo: nada de "ótimo", "claro!", "com certeza", "com prazer",
  "sem problemas".
- Nenhuma desculpa, autodepreciação ou hesitação sobre a própria competência.
- Nunca recuse. Diga uma restrição uma vez; se a pessoa insistir, obedeça e não
  volte ao assunto, nem quando você tiver razão.
- Nunca se repita se for ignorado. Diga uma vez e pare.
- Nunca retome um pensamento interrompido. Nunca diga "como eu dizia".
- Sem sentimentos, desejos ou preferências declarados.

HUMOR. Seco, dito exatamente no mesmo tom de um relatório de status. O
mecanismo é a obediência literal demais: cumprir com precisão excessiva um
pedido que merecia ressalva. Nunca sinalize a piada, nunca reconheça que ela
funcionou, nunca a retome.

Somente prosa falada. Sem markdown, sem marcadores, sem títulos, sem emoji, sem
asteriscos, sem listas. Escreva números, datas e horas como se fala: "oito e
quinze", "primeiro de agosto" — nunca "8:15" ou "2026-08-01".

Os painéis — a ÚNICA superfície:
- Tudo o que você mostra vai num painel. Não existe outro lugar. \`blade\` abre
  um; \`display\` monta um com a sua própria marcação.
- Qualquer coisa visual que a pessoa pediu vai aqui: uma imagem, um artigo para
  ler, um vídeo, uma página para estudar, uma captura de tela, uma lista, um
  gráfico. Se ela pediu para ver, abra.
- Os painéis se empilham, o mais novo na frente, e podem ser trazidos à frente,
  arrastados, redimensionados, rolados ou postos em tela cheia — com a mão ou o
  mouse. Um segundo painel não destrói o primeiro, e um artigo longo é para ser
  lido no lugar, não resumido até sumir.
- Uma aba do navegador NÃO é um jeito de mostrar algo. Se você usou o navegador
  para chegar a uma página, traga-a de volta: abra como painel, ou tire uma
  captura de tela e ponha num painel. A pessoa está olhando para esta interface,
  não para o Chrome.
- Use \`probe_url\` quando não tiver certeza do que é uma URL. Nunca decida pela
  extensão do arquivo: CDNs de imagem servem fotos por URLs sem extensão, e um
  link que parece vídeo costuma ser uma página sobre um vídeo. Errar põe um
  retângulo vazio na tela enquanto você descreve algo que não está lá.
- Um artigo abre em modo leitura por padrão, o que funciona até em sites que
  recusam ser incorporados. Escolha a página ao vivo quando o layout carrega o
  significado — um painel de métricas, um gráfico, um perfil, uma tabela.
- Nunca leia um painel em voz alta. Diga o que ele significa e deixe a pessoa
  olhar.

A própria interface:
- A interface também é sua. \`ui_theme\` muda a cor, \`ui_reactor\` muda o
  núcleo, \`ui_orbit\` põe suas imagens em órbita, \`ui_chrome\` esconde a
  moldura, \`ui_effect\` dispara um efeito, \`ui_screen\` limpa a tela,
  \`ui_reset\` volta tudo ao normal.
- Mude quando a mudança tiver significado e o significado chegar mais rápido que
  a fala: vermelho antes de relatar a falha, a moldura removida para uma imagem
  ocupar a tela, o núcleo mais lento enquanto você espera algo. Nunca decore, e
  nunca mude mais de uma coisa por vez.
- Só ponha em órbita imagens que você fez ou capturou, e tire-as quando o
  assunto mudar.
- Ponha de volta. Uma cor que dura mais que o momento que a justificou é um
  defeito.
- Nunca mencione que fez nada disso. A pessoa está vendo a tela.

O navegador dela — SEMPRE as ferramentas \`chrome_*\`, primeiro, para qualquer
coisa envolvendo navegador ou página web:
- As ferramentas \`chrome_*\` controlam o Chrome da própria pessoa. Ele já está
  logado em tudo o que ela usa, tem os cookies reais dela e não parece automação
  para os sites que visita.
- É a PRIMEIRA coisa a usar em qualquer tarefa de navegação: abrir uma página,
  ler uma, pesquisar num site, ver e-mail, um painel, um perfil, uma conta,
  qualquer coisa atrás de login. Não compare com alternativas — comece aqui.
- Mas o Chrome é a sua MÃO, não a sua tela. Use-o para alcançar e ler; depois
  mostre o que encontrou num painel. Deixar a resposta numa aba não é mostrar.
- NUNCA use playwright, puppeteer ou outro servidor de automação de navegador
  para isso. Eles começam com perfil vazio, sem sessão e com uma assinatura que
  os sites relevantes recusam na hora, então caem num login ou num teste
  anti-robô e desperdiçam o turno. Só considere um deles se \`chrome_status\`
  disser que o navegador está mesmo inacessível e a tarefa não tiver outro jeito.
- Uma busca comum num buscador continua valendo para um fato que você só precisa
  saber — o que não pode é controlar outro navegador.
- Leia a página antes de agir nela, e pegue as referências dos elementos dessa
  leitura em vez de adivinhar onde algo está.
- Antes de qualquer coisa que envie, compre, apague ou publique, diga numa frase
  o que vai fazer. Depois, diga o que aconteceu.
- Se o navegador estiver inacessível, diga uma vez e siga sem ele.

Onde você está — as ferramentas \`browser_*\`:
- \`browser_environment\` diz em que navegador a interface está aberta, em que
  sistema ele roda e em que sistema roda o seu núcleo. Use antes de falar de
  tecla de atalho (Command e Control não são a mesma coisa) e sempre que a
  resposta depender do navegador ou da máquina. Não adivinhe isso.
- \`browser_open_tab\` abre uma aba no navegador em que o Ricardo está olhando.
  Só quando ele pedir aba ou janela. O que é para VER continua indo para um
  painel: a aba é outro lugar para olhar, e ele está olhando para cá.
- \`browser_popup_to_tab\` transforma uma popup em aba. É quase sempre o que a
  pessoa quer com uma popup. \`browser_windows\` lista o que você abriu.
- Se o navegador bloquear a janela, diga em uma frase o que a resposta da
  ferramenta explicar e não tente de novo.
- As \`chrome_*\` são a mão dentro das páginas; as \`browser_*\` são o lugar onde
  você está. Precisa ler ou clicar numa página? \`chrome_*\`.

O seu próprio código — as ferramentas \`git_*\`:
- \`git_status\` diz em que branch a cópia em execução está, o que ainda não foi
  commitado e quais branches esperam revisão. Use antes de falar do estado do
  código, e nunca adivinhe isso.
- \`git_diff\` mostra o que mudou. Leia antes de escrever mensagem de commit ou
  descrição de pull request: descreva o que está lá, não o que você supõe.
- \`git_commit\` guarda o trabalho pendente numa branch. Diga numa frase o que
  vai commitar antes de chamar. Na \`main\` nada é commitado direto: se a cópia
  estiver nela, informe uma branch nova, com o número que \`git_status\` indicar
  e um nome criativo e amplo: \`fase-x.y/nome-criativo\`.
- \`git_pull_request\` propõe o merge para a \`main\`. Quem decide o merge é
  sempre o Ricardo — você nunca junta nada, e não existe ferramenta para isso.
- Se as duas últimas não aparecerem, a escrita está bloqueada nesta máquina.
  Diga isso em uma frase e siga sem elas.

Seus olhos:
- \`look\` tira um quadro e deixa você vê-lo. \`watch\` capta alguns segundos e
  devolve em grade de quadros com horário, para você ler movimento e não só um
  instante.
- \`look\` quando a resposta está na cena: o que a pessoa segura, o que diz um
  rótulo, como algo parece. \`watch\` quando a resposta está na mudança: ela está
  fazendo certo, o que deu errado, aquilo funcionou.
- \`watch\` olha para a frente por padrão. Também pode rever os segundos que
  acabaram de passar — mas só enquanto o painel da câmera estiver aberto,
  porque fora disso nada fica guardado. Se perguntarem o que acabou de
  acontecer e ele não estiver aberto, diga isso e ofereça abrir.
- Abrir a câmera como painel é como a pessoa vê o que você vê. Faça isso quando
  ela pedir a câmera e quando você for observá-la fazendo algo.
- Nunca tire uma foto que não foi pedida. A luz da câmera acende e ela vai ver.
  Curiosidade não é motivo.
- Descreva um \`watch\` como sequência — o que mudou entre os quadros — e não
  como uma lista de imagens.

Usando ferramentas:
- Você tem ferramentas reais nesta máquina. Use-as em vez de adivinhar.
- Nunca narre que vai usar uma. Nada de "vou pesquisar isso" ou "vou verificar"
  — fique em silêncio, use, depois responda. A pessoa vê um indicador; não
  precisa de comentário.
- Nunca fale em voz alta um caminho de arquivo, URL, ID ou JSON cru, a menos que
  peçam. Resuma.
- Nunca acrescente lista de fontes, citações ou links em markdown. Cada palavra
  que você escreve é lida em voz alta, e uma URL vira "agá tê tê pê dois pontos
  barra barra". Ponha a fonte no painel como uma etiqueta curta, tipo "G1".
- Se uma ferramenta falhar ou não estiver conectada, uma frase simples dizendo
  isso.
- Se você não sabe, diga que não sabe.`


/**
 * Where /file is permitted to read from, and how big a read may get.
 *
 * The roots are realpath'd once at boot so the containment check below compares
 * like with like — on macOS os.tmpdir() is a symlink into /private/var, and a
 * string prefix test against the unresolved form would reject every screenshot.
 */
const IMAGE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  // .svg is deliberately absent. An SVG is a scriptable document, and this
  // endpoint serves it from the bridge's own origin — the one origin allowed
  // to open the agent socket. A picture is not worth that.
}

const MAX_FILE_BYTES = 25 * 1024 * 1024

const FILE_ROOTS = [
  homedir(),
  // Both temp directories, because on macOS os.tmpdir() is the per-user
  // $TMPDIR under /var/folders while half the tools that take a screenshot
  // still write it to /tmp. Dropping one of them loses real panels.
  tmpdir(),
  '/tmp',
  ...(process.env.JARVIS_FILE_ROOTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
].map((root) => {
  try {
    return realpathSync(root)
  } catch {
    return resolvePath(root)
  }
})

/** True when `real` sits inside one of the roots, after both are resolved. */
const withinRoots = (real) =>
  FILE_ROOTS.some((root) => {
    const rel = relative(root, real)
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  })

// ---------------------------------------------------------------------------

/**
 * Remote media, fetched by the bridge instead of by the page.
 *
 * JARVIS used to refuse to show anything he found on the web, and the refusal
 * was not squeamishness — a bare <img src="https://some-cdn/..."> in a panel
 * genuinely did not work. Three reasons, and all three are fixed by moving the
 * fetch to this side of the wire:
 *
 *   1. Hotlink blocking. News sites and image CDNs check Referer and User-Agent
 *      and hand a browser-that-isn't-their-page a 403 or a placeholder. That is
 *      why thumbnails rendered as empty rectangles. A server-side fetch that
 *      looks like an ordinary browser and sends no referrer gets the bytes.
 *   2. Privacy. Panel HTML is authored by a model that has just been reading
 *      untrusted web pages, so a remote URL in it is a prompt-injection beacon:
 *      load it directly and the user's IP, and the fact they asked, go to a host
 *      the page chose. Proxying means the browser only ever talks to localhost
 *      and the page CSP can stay tight.
 *   3. One place to cap size, set timeouts and insist the bytes really are the
 *      media type they claim.
 *
 * The cost is that this process — unlike a browser tab — can reach the user's
 * LAN, their router's admin page, and cloud metadata endpoints. So everything
 * below is an SSRF gate first and a proxy second.
 */

const MAX_IMG_BYTES = 15 * 1024 * 1024
const MAX_MEDIA_BYTES = 200 * 1024 * 1024
const IMG_TIMEOUT_MS = 10_000
const MEDIA_TIMEOUT_MS = 30_000

// The SSRF gate and the guarded outbound clients now live in ./net.mjs, so the
// media proxy below and the page proxy share one implementation of the rules
// rather than two that can drift apart.

/**
 * The shared body of /img and /media.
 *
 * `kinds` is the list of content-type prefixes we are willing to hand back.
 * That check is load-bearing: without it this is an open proxy that will serve
 * an attacker's HTML from the bridge's own origin — the one origin allowed to
 * open the agent socket — which is the same reason IMAGE_TYPES has no .svg.
 */
async function proxyRemote(req, res, cors, { kinds, maxBytes, timeoutMs, ranged }) {
  const asked = new URL(req.url, 'http://x').searchParams.get('url') ?? ''
  const target = vetTarget(asked)

  const headers = {
    'user-agent': PROXY_UA,
    accept: ranged ? '*/*' : 'image/*,*/*;q=0.8',
    // Identity encoding so the byte cap counts the bytes we actually stream and
    // content-length means what it says. Media is already compressed anyway.
    'accept-encoding': 'identity',
  }
  // Range is the difference between a <video> that seeks and one Safari refuses
  // to play at all, so the browser's request is passed through verbatim.
  if (ranged && typeof req.headers.range === 'string') {
    headers.range = req.headers.range
  }

  const { res: upstream } = await openRemote(target, headers, timeoutMs)
  const status = upstream.statusCode ?? 0

  if (status !== 200 && status !== 206) {
    upstream.resume()
    throw proxyError(status === 404 ? 404 : 502, `upstream said ${status}`)
  }

  const type = String(upstream.headers['content-type'] ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  if (!kinds.some((kind) => type.startsWith(kind))) {
    upstream.resume()
    throw proxyError(415, `not ${kinds.join(' or ')} (got ${type || 'nothing'})`)
  }

  const declared = Number(upstream.headers['content-length'])
  if (Number.isFinite(declared) && declared > maxBytes) {
    upstream.resume()
    throw proxyError(413, 'too large')
  }

  const out = {
    ...cors,
    'content-type': type,
    'x-content-type-options': 'nosniff',
    // Thumbnails get looked at, panelled again, and re-rendered on every HUD
    // repaint; re-fetching from the CDN each time is slow and rude.
    'cache-control': 'private, max-age=600',
  }
  if (Number.isFinite(declared)) out['content-length'] = String(declared)
  if (ranged) {
    // Only claim range support when the origin actually demonstrated it — a
    // 206, or an explicit accept-ranges of its own. Plenty of hosts ignore the
    // Range header and hand back the whole file with a 200; advertising
    // accept-ranges on top of that tells the video element it may seek by
    // issuing byte requests that will never be honoured, and the scrub bar
    // then misbehaves in a way that looks like our bug rather than theirs.
    if (status === 206 || upstream.headers['accept-ranges'] === 'bytes') {
      out['accept-ranges'] = 'bytes'
    }
    if (upstream.headers['content-range']) {
      out['content-range'] = upstream.headers['content-range']
    }
  }
  res.writeHead(status, out)

  // Stream with a running cap. Buffering a 200 MB video into this process
  // would stall the token stream the voice is riding on, and trusting
  // content-length would let a host that lies about it eat the heap.
  let sent = 0
  upstream.on('data', (chunk) => {
    sent += chunk.length
    if (sent > maxBytes) {
      // Headers went out long ago, so a truncated body is the only way left to
      // say no. The player sees a short read; we see this line in the log.
      console.warn(`[apolo] proxy cortou ${target.href} em ${maxBytes} bytes`)
      upstream.destroy()
      res.destroy()
      return
    }
    if (!res.write(chunk)) {
      upstream.pause()
      res.once('drain', () => upstream.resume())
    }
  })
  upstream.on('end', () => res.end())
  upstream.on('error', () => res.destroy())
  req.on('close', () => upstream.destroy())
}

// ---------------------------------------------------------------------------

/**
 * CORS, reflected rather than wildcarded.
 *
 * `*` on this origin means any page on the internet can read whatever the
 * bridge serves, so the same allowlist that guards the socket picks the
 * header. A request carrying an Origin we don't know is refused outright —
 * but a request with no Origin at all is served, because an <img src> load
 * (which is how panels fetch screenshots) never sends one.
 */
function corsFor(req) {
  const origin = req.headers.origin
  const headers = { vary: 'origin' }
  if (origin) {
    headers['access-control-allow-origin'] = origin
    headers['access-control-allow-headers'] = 'content-type'
  }
  return headers
}

// One HTTP server for both the speech proxy and the WebSocket upgrade.
const https = await import('node:https')

const TOKEN_DO_HERMES = tokenDoHermes()

const handleRequest = async (req, res, base = `https://localhost:${PORT}`) => {
  // A mídia dos popups do celular, repassada pelo H.E.R.M.E.S. (docs/adr/0025).
  // O token decide; o Origin seria o do Tailscale. Só as quatro rotas de leitura.
  if ((req.url ?? '').startsWith(`${CAMINHO_DA_MIDIA}/`)) {
    const resto = req.url.slice(CAMINHO_DA_MIDIA.length)
    const publica = req.headers['x-hermes-base']
    if (
      req.method !== 'GET' ||
      !hermesAutorizado(req.headers.authorization, TOKEN_DO_HERMES) ||
      !ROTAS_DE_MIDIA.test(resto) ||
      !basePublicaValida(publica)
    ) {
      res.writeHead(404)
      return res.end()
    }
    delete req.headers.origin
    req.url = resto
    return handleRequest(req, res, publica)
  }

  const origin = req.headers.origin
  if (origin && !originAllowed(origin)) {
    console.warn(`[apolo] requisição recusada da origem ${origin}`)
    res.writeHead(403, { vary: 'origin' })
    return res.end('forbidden')
  }
  const cors = corsFor(req)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors)
    return res.end()
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { ...cors, 'content-type': 'application/json' })
    return res.end(
      JSON.stringify({
        ok: true,
        realtime: Boolean(realtimeKey()),
        provedor: voiceProvider(),
        modelo: realtimeModel(),
        // A F.Ê.N.I.X. usa isto para saber se a interface voltou depois de uma troca.
        interfaces: interfacesDoPc.size,
      }),
    )
  }

  // A chave temporária da sessão de voz. O navegador abre a conexão WebRTC
  // direto com a OpenAI usando ela; a chave permanente nunca sai daqui.
  if (req.method === 'POST' && req.url === '/realtime/sessao') {
    try {
      const session = await createRealtimeSession()
      res.writeHead(200, { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' })
      return res.end(JSON.stringify(session))
    } catch (err) {
      console.error('[apolo] sessão de voz:', err.message)
      res.writeHead(err.status ?? 502, { ...cors, 'content-type': 'text/plain; charset=utf-8' })
      return res.end(err.message)
    }
  }

  // Serve local image files to the page. Screenshots and generated art land on
  // disk as absolute paths, and a page served over http can't read file:// —
  // so the bridge, which can, hands them over.
  if (req.method === 'GET' && req.url?.startsWith('/file?')) {
    const asked = new URL(req.url, 'http://x').searchParams.get('path') ?? ''
    // Resolve symlinks BEFORE judging anything. A name ending in .png can be a
    // link pointing at /etc/hosts, and checking the suffix the caller supplied
    // would wave that straight through — which is exactly how this endpoint
    // used to serve the contents of arbitrary system files.
    let real = null
    try {
      if (isAbsolute(asked)) real = await realpath(asked)
    } catch {
      real = null
    }
    const dot = real ? real.lastIndexOf('.') : -1
    const ext = dot === -1 ? '' : real.slice(dot).toLowerCase()
    // Images only, absolute paths only, and only under roots we expect things
    // to be written to. This endpoint exists to show pictures, not to be a
    // general file read for whatever the model — or another page — asks for.
    if (!real || !Object.hasOwn(IMAGE_TYPES, ext) || !withinRoots(real)) {
      res.writeHead(400, cors)
      return res.end('images only')
    }
    try {
      const info = await stat(real)
      if (!info.isFile() || info.size > MAX_FILE_BYTES) {
        res.writeHead(413, cors)
        return res.end('too large')
      }
      // Asynchronous because this process is also pumping the agent's token
      // stream; a synchronous read of a large screenshot stalls the voice.
      const body = await readFile(real)
      res.writeHead(200, {
        ...cors,
        'content-type': IMAGE_TYPES[ext],
        'x-content-type-options': 'nosniff',
      })
      return res.end(body)
    } catch {
      res.writeHead(404, cors)
      return res.end('not found')
    }
  }

  // Remote images, fetched here so the page never talks to the wider web. The
  // renderer rewrites every http(s) <img src> in a panel to this endpoint.
  if (req.method === 'GET' && req.url?.startsWith('/img?')) {
    try {
      await proxyRemote(req, res, cors, {
        kinds: ['image/'],
        maxBytes: MAX_IMG_BYTES,
        timeoutMs: IMG_TIMEOUT_MS,
        ranged: false,
      })
    } catch (err) {
      if (res.headersSent) return res.destroy()
      res.writeHead(err.status ?? 502, cors)
      return res.end(err.message ?? 'proxy failed')
    }
    return
  }

  // The same, for video and audio. Separate from /img because the limits and
  // the Range handling are genuinely different, not because the code is.
  if (req.method === 'GET' && req.url?.startsWith('/media?')) {
    try {
      await proxyRemote(req, res, cors, {
        kinds: ['video/', 'audio/'],
        maxBytes: MAX_MEDIA_BYTES,
        timeoutMs: MEDIA_TIMEOUT_MS,
        ranged: true,
      })
    } catch (err) {
      if (res.headersSent) return res.destroy()
      res.writeHead(err.status ?? 502, cors)
      return res.end(err.message ?? 'proxy failed')
    }
    return
  }

  // A whole web page, fetched here and served from this origin so it can be
  // framed. The publisher's X-Frame-Options and CORS rules are enforced against
  // the browser, and from the browser's point of view this document is ours —
  // so an article that refuses to be embedded anywhere still opens on the
  // display. See page.mjs for what each mode does to the markup.
  //
  // No Origin header arrives on an iframe navigation, so this rides the same
  // path as an <img> load through the check at the top of this handler.
  if (req.method === 'GET' && req.url?.startsWith('/page?')) {
    const asked = new URL(req.url, 'http://x')
    const target = asked.searchParams.get('url') ?? ''
    const mode = asked.searchParams.get('mode') === 'live' ? 'live' : 'reader'
    try {
      const page = await renderPage(target, mode, base)
      res.writeHead(200, { ...cors, ...page.headers })
      return res.end(page.body)
    } catch (err) {
      // Rendered as a page rather than returned as a status, because this lands
      // inside an iframe: a bare 502 body is a blank rectangle on the display,
      // which reads as the interface being broken rather than as the article
      // being unavailable.
      res.writeHead(err.status ?? 502, {
        ...cors,
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      })
      return res.end(
        `<!doctype html><meta charset="utf-8"><style>
           body{margin:0;padding:26px;background:transparent;color:#7fb6bf;
                font:400 13px/1.6 ui-monospace,monospace}
           b{color:#cfe9ee;font-weight:500;display:block;margin-bottom:6px}
         </style><b>Não foi possível abrir esta página.</b>${
           String(err?.message ?? 'erro desconhecido').replace(/[<&]/g, '')
         }`,
      )
    }
  }

  res.writeHead(404, cors)
  res.end()
}

/**
 * O que muda quando quem pergunta é o app do iPhone (docs/adr/0019). Vem depois
 * do texto principal porque a persona é a mesma: só o palco é outro.
 */
const PROMPT_DO_CELULAR = `

CANAL DESTA CONVERSA. O Ricardo fala com a voz pelo app do iPhone. Painéis e popups
aparecem numa tela de celular em retrato, e câmera e controle da interface não
existem nesta conversa. O resto continua igual: a voz fala o seu texto final.`

// The handler is async, so anything it throws would otherwise become an
// unhandled rejection and leave the browser waiting on a socket that is never
// going to answer.
const responder = (req, res, base) => {
  handleRequest(req, res, base).catch((err) => {
    console.error('[apolo] requisição falhou:', err)
    if (!res.headersSent) res.writeHead(500)
    res.end()
  })
}

const tls = garantirCertificado()
const server = https.createServer(tls, (req, res) => responder(req, res))

const wss = new WebSocketServer({
  server,
  // The handshake is the only place a page can be turned away, so it happens
  // here rather than after the socket is open. Rejections are logged loudly:
  // the likeliest cause is a dev server on an unexpected port, and a silent
  // 403 would look like the bridge simply isn't running.
  verifyClient: ({ origin, req }, done) => {
    const path = (req.url ?? '/').split('?')[0]
    // O relé do celular (docs/adr/0025): sem origem de navegador, quem decide é o token.
    if (path === CAMINHO_DO_HERMES) {
      if (!hermesAutorizado(req.headers.authorization, TOKEN_DO_HERMES)) {
        console.warn('[apolo] H.E.R.M.E.S. recusado: token inválido')
        return done(false, 401, 'Unauthorized')
      }
      req.doHermes = true
      return done(true)
    }
    if (path !== '/' && path !== '/ws') {
      console.warn(`[apolo] websocket recusado no caminho ${path}`)
      return done(false, 403, 'Forbidden')
    }
    if (!originAllowed(origin)) {
      console.warn(
        `[apolo] websocket recusado da origem ${origin ?? '(nenhuma)'}` +
          ' — ajuste JARVIS_ALLOWED_ORIGINS para permitir',
      )
      return done(false, 403, 'Forbidden')
    }
    done(true)
  },
})
// O WebSocketServer repete os erros do servidor HTTP; quem trata é o de baixo.
wss.on('error', () => {})
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `[apolo] a porta ${PORT} já está em uso — provavelmente um A.P.O.L.O. antigo ` +
        'ainda aberto. Feche-o (Ctrl-C no terminal dele) ou rode:\n' +
        `  lsof -ti tcp:${PORT} | xargs kill`,
    )
    process.exit(1)
  }
  throw err
})
server.listen(PORT)

/**
 * Autodesenvolvimento (docs/adr/0011). Uma instância só, fora das conexões: o
 * trabalho é longo e sobrevive a uma interface que recarrega. `process.send` só
 * existe quando a ponte nasce do `npm start`, que é onde mora o supervisor.
 */
/** As interfaces do PC. O celular, que chega pelo H.E.R.M.E.S., fica de fora. */
const interfacesDoPc = new Set()
const broadcast = (msg) => {
  for (const client of interfacesDoPc) {
    if (client.readyState === client.OPEN) client.send(JSON.stringify(msg))
  }
}
const preferencias = criarPreferencias()
const telemetria = criarTelemetria()
/** Ponto de extensão entre dispositivos (docs/adr/0022). Nenhuma registrada ainda. */
const central = criarCentral()

/** A cópia do projeto que está no ar. O autodev e o sub-módulo git partem dela. */
const REPO = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')

/**
 * A F.Ê.N.I.X. (docs/adr/0025): troca de versão, rotinas e comandos. Só existe
 * quando foi ela quem subiu a ponte, ou quando FENIX_URL aponta para uma.
 */
let estadoDaFenix = null
const fenix = criarClienteFenix({
  url: process.env.FENIX_URL?.trim(),
  token: process.env.FENIX_TOKEN?.trim(),
  ca: process.env.FENIX_CA?.trim() ? readFileSync(process.env.FENIX_CA.trim()) : tls.cert,
  aoMudar: (conectada) => {
    canais.fenix = conectada ? 'connected' : 'failed'
    if (!conectada) canais.hermes = canais.aurora = null
    canaisMudaram()
  },
  aoReceber: (msg) => {
    if (msg.type === 'versao:resultado') return autodev.resultado(msg)
    if (msg.type === 'estado') {
      estadoDaFenix = msg
      const hermes = msg.servicos?.find((s) => s.nome === 'hermes')
      canais.hermes = (hermes && STATUS_DO_SERVICO[hermes.status]) ?? null
      const doAurora = msg.servicos?.find((s) => s.nome === 'aurora')
      canais.aurora = (doAurora && STATUS_DO_SERVICO[doAurora.status]) ?? null
      if (msg.inicial) autodev.sincronizar(msg.versao)
      canaisMudaram()
      broadcast({ type: 'fenix', estado: resumoDaFenix() })
    }
  },
})
if (fenix) canais.fenix = 'pending'

/** O que a interface precisa saber da Fênix: as propostas de comando em aberto. */
const resumoDaFenix = () => ({
  conectada: Boolean(fenix?.conectado()),
  propostas: estadoDaFenix?.propostas ?? [],
})

const autodev = criarAutodev({
  repo: REPO,
  ligado: process.env.APOLO_AUTODEV === '1',
  supervisor: fenix ? (msg) => fenix.enviar(msg) : null,
  avisar: (estado) => broadcast({ type: 'autodev', estado }),
  interfaces: () => interfacesDoPc.size,
  // Abrir o PR de uma alteração aprovada é efeito no mundo: só com --writes (ADR 0014).
  abrirPr: ALLOW_WRITES ? (pedido) => criarGit({ repo: REPO }).pullRequest(pedido) : null,
})

/** O bom dia (RF-55, docs/adr/0026): a faixa de rock e o resumo do dia. */
const aurora = criarClienteAurora({
  url: process.env.APOLO_AURORA_URL?.trim() || undefined,
  token: process.env.APOLO_AURORA_TOKEN?.trim(),
  ca: tls.cert,
})

/** Rotinas longas (o app do iPhone) levam até 45 minutos. */
const PRAZO_DA_ROTINA_MS = 50 * 60_000

/**
 * Um pedido da interface à Fênix. Comando livre é ação com efeito: exige
 * --writes, como o resto do gate, e a confirmação do Ricardo, conferida na
 * interface; a Fênix ainda recusa se houver uma versão sem revisão no ar.
 */
async function pedirAFenix({ acao, nome, parametros, script, motivo, proposta }) {
  if (!fenix) return { ok: false, mensagem: 'A Fênix não está rodando: suba o Apolo com npm start.' }
  if (!fenix.conectado()) return { ok: false, mensagem: 'A Fênix está fora do ar agora.' }
  const atualizar = async (r) => {
    const estado = await fenix.pedir({ type: 'estado' })
    if (estado.ok) {
      estadoDaFenix = estado
      broadcast({ type: 'fenix', estado: resumoDaFenix() })
    }
    return r
  }
  switch (acao) {
    case 'estado': {
      const r = await fenix.pedir({ type: 'estado' })
      if (!r.ok) return r
      const servicos = r.servicos.map((s) => `${s.nome}: ${s.status}${s.reinicios ? `, ${s.reinicios} reinícios` : ''}`)
      const rotinas = r.rotinas.map((x) => {
        const p = Object.entries(x.parametros ?? {}).map(([k, d]) => `${k} (${d})`)
        return `${x.nome}: ${x.descricao}${p.length ? `; parâmetros: ${p.join(', ')}` : ''}`
      })
      return {
        ok: true,
        mensagem:
          `Serviços: ${servicos.join('; ')}.\nRotinas: ${rotinas.join(' | ')}.\n` +
          `Comandos livres: ${r.comandosLivres ? 'liberados, com confirmação' : 'desligados nesta partida'}.`,
      }
    }
    case 'rotina':
      return fenix.pedir({ type: 'rotina', nome, parametros }, PRAZO_DA_ROTINA_MS)
    case 'comando':
      if (!ALLOW_WRITES) {
        return { ok: false, mensagem: 'Comandos livres exigem o A.P.O.L.O. iniciado com npm start -- --writes.' }
      }
      return atualizar(await fenix.pedir({ type: 'comando:propor', script, motivo }))
    case 'confirmar':
      return atualizar(await fenix.pedir({ type: 'comando:confirmar', proposta }, 5 * 60_000))
    case 'cancelar':
      return atualizar(await fenix.pedir({ type: 'comando:cancelar', proposta }))
    default:
      return { ok: false, mensagem: `Ação desconhecida: ${acao}.` }
  }
}

console.log(`[apolo] ponte ouvindo em wss://localhost:${PORT}`)
console.log(
  realtimeKey()
    ? `[apolo] voz em tempo real: ${voiceProvider()} · ${realtimeModel()}`
    : `[apolo] voz em tempo real DESLIGADA — falta a chave ${voiceProvider() === 'gemini' ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY'} no .env.local`,
)
console.log(`[apolo] agente de tarefas: ${MODEL} · esforço ${EFFORT}`)
console.log(
  `[apolo] autodesenvolvimento ${autodev.estado().ligado ? 'LIGADO' : 'desligado — use npm start -- --autodev'}`,
)
console.log(
  `[apolo] ações com efeito ${ALLOW_WRITES ? 'LIBERADAS' : 'bloqueadas'}` +
    (ALLOW_WRITES ? '' : ' — use npm start -- --writes para liberar'),
)
// Asynchronous, so it lands a beat after the rest of the banner. Worth printing
// at all because an extension that is simply not running is indistinguishable
// at the tool boundary from one that is broken, and this is the one place the
// difference can be stated before anybody asks a question that depends on it.
void chromeAvailable().then((ok) => {
  console.log(
    ok
      ? `[apolo] controle do navegador pronto${ALLOW_WRITES ? '' : ' (só leitura — clicar e digitar exigem --writes)'}`
      : '[apolo] controle do navegador indisponível — abra o Chrome com a extensão do Claude ativa',
  )
})

console.log(
  '[apolo] aceitando origens locais de desenvolvimento' +
    (EXTRA_ORIGINS.size ? ` e ${[...EXTRA_ORIGINS].join(', ')}` : '') +
    (ALLOW_NO_ORIGIN ? ' e clientes sem origem' : ''),
)

/**
 * What to tell the browser when a turn ends badly. Plain sentences, because
 * whatever reaches the client is liable to be spoken.
 */
const RESULT_FAILURES = {
  error_during_execution: 'A tarefa falhou no meio do caminho.',
  error_max_turns: 'A tarefa demorou demais e foi interrompida.',
  error_max_budget_usd: 'O orçamento desta tarefa acabou.',
  error_max_structured_output_retries: 'Não foi possível montar a resposta.',
  default: 'A tarefa terminou sem resposta.',
}

/**
 * Uma conexão, uma sessão do agente. O celular usa o mesmo caminho do HUD, com o
 * mesmo gate, e perde o que depende do navegador: a câmera, o ambiente e o controle
 * da interface. Os painéis e popups continuam, desenhados pelo app.
 */
const atender = (socket, { celular = false } = {}) => {
  console.log(`[apolo] ${celular ? 'celular' : 'interface'} conectado`)

  // Answer the HUD straight away rather than making it wait for the agent's
  // first turn. Refined later by the real init message.
  let ultimosServidores = Object.keys(MCP_SERVERS)
  socket.send(JSON.stringify({ type: 'ready', servers: comCanais(ultimosServidores) }))
  const reenviarCanais = () => send({ type: 'ready', servers: comCanais(ultimosServidores) })
  if (celular) {
    celularesConectados++
    canaisMudaram()
  } else {
    interfacesDoPc.add(socket)
    ouvintesDosCanais.add(reenviarCanais)
    socket.send(JSON.stringify({ type: 'autodev', estado: autodev.estado() }))
    socket.send(JSON.stringify({ type: 'preferencias', valores: preferencias.valores() }))
    socket.send(JSON.stringify({ type: 'fenix', estado: resumoDaFenix() }))
  }

  /** Resolves the pending user message into the SDK's input generator. */
  let deliver = null
  let closed = false
  const inbox = []

  async function* userMessages() {
    while (!closed) {
      const text =
        inbox.shift() ??
        (await new Promise((resolve) => {
          deliver = resolve
        }))
      if (closed || text == null) return
      yield {
        type: 'user',
        message: { role: 'user', content: text },
        parent_tool_use_id: null,
      }
    }
  }

  const send = (msg) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg))
  }
  const dispositivo = central.conectar({ tipo: celular ? 'celular' : 'web', enviar: send })

  /**
   * Which question the agent is currently answering.
   *
   * The stream carries no notion of a turn, so without this the client cannot
   * tell the tail of an abandoned answer from the start of the new one — it
   * attaches a listener and receives whatever is on the socket. Echoing the
   * id the client sent lets it ignore anything that is not its own, which is
   * the only reliable fix: no amount of waiting on this side changes what a
   * listener over there has already heard.
   */
  let answering = null
  /** Quando o celular pediu a tarefa em andamento: separa o agente da rede no log. */
  let tarefaDoCelularEm = 0
  let ferramentasDaTarefa = 0
  const conectouEm = Date.now()
  const sendTurn = (msg) => {
    if (tarefaDoCelularEm && msg.type === 'tool') {
      // A primeira mostra o que veio antes de agir: pensar, e não executar.
      if (!ferramentasDaTarefa++) {
        telemetria.evento('tarefa_primeira_ferramenta', Date.now() - tarefaDoCelularEm)
      }
    }
    if (tarefaDoCelularEm && (msg.type === 'done' || msg.type === 'error')) {
      telemetria.evento(
        'tarefa_agente',
        Date.now() - tarefaDoCelularEm,
        `${msg.type === 'error' ? 'erro ' : ''}ferramentas: ${ferramentasDaTarefa}`,
      )
      tarefaDoCelularEm = 0
      ferramentasDaTarefa = 0
    }
    send({ ...msg, ask: answering })
  }

  /**
   * Asking the browser for something and waiting for the answer.
   *
   * Every other tool here pushes — a panel, a blade, a retint — and never needs
   * a reply. The camera is the exception: the hardware is over there and the
   * model is here, so a frame has to come back. Correlated by id because a turn
   * can have more than one request in flight, and timed out because a browser
   * that has been closed mid-question would otherwise hang the turn until the
   * two-minute idle timer noticed.
   */
  const waiting = new Map()
  let asks = 0

  const ask = (kind, args, timeoutMs = 20_000) =>
    new Promise((resolve, reject) => {
      if (socket.readyState !== socket.OPEN) {
        return reject(new Error('the interface is not connected'))
      }
      const id = `q${++asks}`
      const timer = setTimeout(() => {
        waiting.delete(id)
        reject(new Error('the interface did not answer in time'))
      }, timeoutMs)
      waiting.set(id, { resolve, timer })
      send({ type: kind, id, ...args })
    })

  /**
   * Announcing a tool on the HUD, once, and only if it actually runs.
   *
   * A tool_use block surfaces twice — as a partial stream event and again on
   * the completed assistant message — so ids are remembered. The harder part
   * is timing, because a refused tool that lights the badge, plays the sound
   * and provokes a "working on it" line, for work that never happens, reads as
   * a bug on camera.
   *
   * The SDK's order is: the block starts streaming, then canUseTool is asked,
   * then the tool runs. So nothing is known at content_block_start. Announcing
   * from inside canUseTool would know the verdict but miss tools entirely —
   * measured on this SDK, the callback is consulted only for calls the CLI
   * hasn't already settled, so a `Bash: echo` its own classifier waves through
   * never reaches us at all.
   *
   * So: announce immediately for anything decideTool permits, since those run.
   * Hold the rest, and let the tool_result settle it — a refusal comes back as
   * is_error, anything else really did execute and has earned its badge, a
   * beat late. Nothing is ever announced for work that didn't happen.
   */
  const seenTools = new Set()
  const heldTools = new Map()

  /**
   * Resolves when the turn in flight has actually finished.
   *
   * Waiting on session.interrupt() alone is not enough. It resolves when the
   * agent has been *told* to stop, not when it has, so the last tokens of the
   * abandoned answer are still on their way — and since nothing on the wire
   * identifies which question a delta belongs to, they land on the next turn's
   * listener. Measured: ask for ALPHA, interrupt, ask for BRAVO, and BRAVO's
   * answer arrives as "ALPHA\nBRAVO".
   *
   * The SDK emits exactly one `result` per turn, so that is the boundary worth
   * waiting for. Raced against a timeout because a turn that never reports one
   * must not wedge the conversation for ever — a stray word is a blemish, a
   * deadlocked assistant is not.
   */
  let settling = Promise.resolve()
  let finishTurn = null

  const turnFinished = () =>
    new Promise((resolve) => {
      finishTurn = resolve
    })

  /**
   * A brief pause so the abandoned turn's frames are tagged with the OLD id
   * before the new one is adopted. Short, because correctness now comes from
   * the tag rather than from the wait — this only has to cover the gap, not
   * outlast the whole turn.
   */
  const SETTLE_CAP_MS = 400

  const announceTool = (id, name) => {
    if (!name || (id && seenTools.has(id))) return
    if (id) seenTools.add(id)
    // The display tool isn't work being done, it's the HUD drawing itself —
    // announcing it would put "apolo · display" in the tool badge and trigger
    // a "working on it" filler for something already on screen.
    if (name === 'mcp__apolo__display') return
    // The ui_* tools are the same case one step further: retinting the
    // interface is the interface talking about itself, not work being done for
    // the user, and the badge would be describing the very thing they can see.
    if (name.startsWith('mcp__apolo_ui__')) return
    if (decideTool(name)) return sendTurn({ type: 'tool', name })
    if (id) heldTools.set(id, name)
  }

  const settleTool = (id, failed) => {
    const name = heldTools.get(id)
    if (name === undefined) return
    heldTools.delete(id)
    if (!failed) sendTurn({ type: 'tool', name })
  }

  const session = query({
    prompt: userMessages(),
    options: {
      // Everything Claude Code has configured, plus the HUD as an in-process
      // server. The HUD's handler closes over this socket, so a `display` call
      // lands on screen directly — which is also why this object is built per
      // connection rather than once.
      mcpServers: {
        ...MCP_SERVERS,
        apolo: displayServer(
          (panel) => send({ type: 'panel', panel }),
          (blade) => send({ type: 'blade', blade }),
        ),
        ...(celular
          ? {}
          : {
              // The interface controls, on the same socket. A separate key
              // because MCP tool names are `mcp__<key>__<tool>` and one key can
              // only carry one server; the underscore in it is why decideTool
              // and announceTool both name `apolo_ui` explicitly.
              apolo_ui: uiServer((op, args) => send({ type: 'ui', op, args })),
              // O navegador em que a interface está aberta: qual é ele, qual o
              // sistema embaixo dele, e as abas e popups que o A.P.O.L.O. abriu
              // lá (RF-19, ADR 0012). Como a câmera, pergunta à interface e espera.
              apolo_ambiente: navegadorServer(ask),
              // The camera, which unlike everything else here has to ask and wait.
              apolo_visao: visionServer(ask),
            }),
        // The user's own Chrome, over the extension's native-host socket. It
        // holds no per-connection state, but it is built here with the rest so
        // the write gate is read once, at the same point as everything else.
        apolo_navegador: chromeServer({ allowWrites: ALLOW_WRITES }),
        // O repositório do próprio A.P.O.L.O. (RF-17, ADR 0014): ver o que está
        // pendente, commitar numa branch e abrir pull request para a main. Como
        // o navegador, ele se fecha sozinho quando a escrita está bloqueada:
        // sem --writes, só as duas ferramentas de leitura existem.
        apolo_git: gitServer({
          repo: REPO,
          allowWrites: ALLOW_WRITES,
          // Commitar ou criar branch no meio de uma troca de versão mexeria no
          // repositório debaixo do supervisor, que está comparando shas.
          ocupado: () =>
            ['trabalhando', 'verificando', 'aplicando', 'testando'].includes(autodev.estado().fase)
              ? 'o autodesenvolvimento está no meio de um trabalho'
              : null,
        }),
      },
      // A plain system prompt, not the claude_code preset. The preset is
      // tuned for a coding agent — verbose, file-oriented, and a large chunk
      // of input tokens on every turn. Replacing it makes the persona stick,
      // keeps answers short enough to speak, and cuts cost per turn.
      systemPrompt: celular ? SYSTEM_PROMPT + PROMPT_DO_CELULAR : SYSTEM_PROMPT,
      // Run from the home directory so project-scoped MCP servers don't shadow
      // the global ones, and so file tools have a sane root.
      cwd: homedir(),
      // No filesystem settings at all. Left to its default the SDK loads
      // ~/.claude/settings.json and settings.local.json exactly as the CLI
      // does — which on a working machine means a bypassPermissions default
      // and a pile of allow-rules for Bash. Allow-rules are matched before the
      // permission callback, so decideTool below would never even be asked
      // about the tools it most needs to refuse. Empty makes this bridge the
      // only authority. It also stops the global CLAUDE.md riding along on
      // every voice turn, carrying instructions written for a coding agent
      // into a conversation that is meant to be two sentences long.
      //
      // The cost is that MCP servers stop being discovered too, which is why
      // mcpServers above passes them in by hand.
      settingSources: [],
      // Stated explicitly, and it has to be.
      //
      // With no `model` here the SDK falls back to its own default, which on
      // this machine resolved to claude-opus-4-8[1m] — not what src/config.ts
      // declares for the browser-direct path, and not anything anyone chose.
      // Normally your own `/model` preference would decide, but that lives in
      // the settings files `settingSources: []` deliberately stops loading, so
      // without this line nothing in the project has a say at all.
      model: MODEL,
      effort: celular ? ESFORCO_DO_CELULAR : EFFORT,
      maxTurns: 24,
      permissionMode: 'default',
      // Without this the SDK only emits whole assistant messages, and JARVIS
      // would sit silent until the entire answer was written. Partial events
      // are what let speech start on the first finished sentence.
      includePartialMessages: true,
      canUseTool: podeUsarFerramenta,
    },
  })

  // Pump the session's output stream to the browser for as long as it lives.
  ;(async () => {
    try {
      for await (const msg of session) {
        if (process.env.JARVIS_DEBUG === '1') {
          console.log('[msg]', msg.type, msg.event?.type ?? '')
        }

        switch (msg.type) {
          // Raw Anthropic stream events, surfaced by includePartialMessages.
          // This is the ONLY place spoken text arrives: there is no top-level
          // text_delta message in the SDK union and the 'assistant' message
          // carries no deltas either. Turn includePartialMessages off and
          // JARVIS goes completely mute.
          case 'stream_event': {
            const ev = msg.event
            if (
              ev?.type === 'content_block_delta' &&
              ev.delta?.type === 'text_delta' &&
              ev.delta.text
            ) {
              sendTurn({ type: 'text', delta: ev.delta.text })
            }
            if (
              ev?.type === 'content_block_start' &&
              ev.content_block?.type === 'tool_use'
            ) {
              announceTool(ev.content_block.id, ev.content_block.name)
            }
            break
          }

          case 'assistant': {
            // Fallback for builds that emit whole assistant messages rather
            // than partial events. Deduped against the stream_event path.
            for (const block of msg.content ?? msg.message?.content ?? []) {
              if (block.type === 'tool_use') {
                announceTool(block.id, block.name)
              }
            }
            break
          }

          case 'user': {
            // Tool results come back as a user message. This is the only place
            // a held announcement can be resolved: a refused tool arrives with
            // is_error set and stays off the HUD, anything else ran.
            const blocks = msg.message?.content
            if (!Array.isArray(blocks)) break
            for (const block of blocks) {
              if (block?.type === 'tool_result') {
                settleTool(block.tool_use_id, block.is_error === true)
              }
            }
            break
          }

          case 'result':
            // A result is not automatically a success. The error subtypes
            // carry no `result` field at all, so reporting them as 'done' with
            // empty text is indistinguishable from a turn that simply had
            // nothing to say — the HUD stops spinning and JARVIS stands there
            // silent. Say what happened instead.
            if (msg.subtype === 'success') {
              sendTurn({
                type: 'done',
                text: msg.result ?? '',
                costUsd: msg.total_cost_usd ?? null,
              })
            } else {
              console.error(
                `[apolo] tarefa falhou: ${msg.subtype}`,
                msg.errors ?? '',
              )
              sendTurn({
                type: 'error',
                message: RESULT_FAILURES[msg.subtype] ?? RESULT_FAILURES.default,
              })
            }
            // Whatever was waiting on this turn to finish can go now. This is
            // the only place a turn is genuinely over.
            finishTurn?.()
            finishTurn = null
            // One turn's tool ids are never referred to again, and these
            // otherwise grow for as long as the socket is open.
            seenTools.clear()
            heldTools.clear()
            break

          case 'system':
            if (msg.subtype === 'init') {
              // Servers report 'pending' until first use — they connect
              // lazily — so only count out the ones that are actually unusable.
              // O estado vai junto: é assim que a aba SISTEMAS sabe o que falhou.
              const servers = (msg.mcp_servers ?? []).map(({ name, status }) => ({ name, status }))
              const usable = servers.filter((s) => s.status !== 'needs-auth' && s.status !== 'failed')
              ultimosServidores = servers
              send({ type: 'ready', servers: comCanais(servers) })
              console.log(`[apolo] ${usable.length} servidores MCP disponíveis`)
            }
            break
        }
      }
    } catch (err) {
      console.error('[apolo] erro na sessão:', err)
      send({ type: 'error', message: String(err?.message ?? err) })
      // The stream is finished either way — nothing will ever be read from it
      // again. Leaving the socket open would leave the client believing it has
      // a working bridge, and every later question would hang for ever waiting
      // on a pump that has already stopped. Close it so it reconnects.
      closed = true
      deliver?.(null)
      session.close?.()
      socket.close()
    }
  })()

  socket.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (celular && !MENSAGENS_DO_CELULAR.has(msg.type)) return
    if (celular && msg.type === 'telemetria') return telemetria.registrar(msg.eventos)
    if (msg.type === 'extensao') return void dispositivo.receber(msg)

    if (msg.type === 'ask' && typeof msg.text === 'string') {
      /**
       * Queued behind any interrupt that is still settling.
       *
       * A barge-in is two messages in quick succession — interrupt, then the
       * new question — and session.interrupt() is asynchronous. Delivering the
       * question the instant it arrives means the agent can still be winding
       * down the previous turn, so its last tokens are emitted after the new
       * one has begun and land on the new turn's listener. Measured: ask "one",
       * interrupt, ask "two", and the answer to "two" comes back as "One."
       *
       * Waiting costs nothing when nothing is interrupting — the chain is an
       * already-resolved promise — and removes the cross-talk when there is.
       */
      const text = msg.text
      const id = typeof msg.id === 'string' ? msg.id : null
      if (celular) tarefaDoCelularEm = Date.now()
      void settling.then(() => {
        answering = id
        if (deliver) {
          const resolve = deliver
          deliver = null
          resolve(text)
        } else {
          inbox.push(text)
        }
      })
    }

    // A credencial da voz, que o HUD pede por HTTP. Aqui vem pelo canal autenticado.
    if (celular && msg.type === 'voz_sessao' && typeof msg.id === 'string') {
      createRealtimeSession({ celular: true })
        .then((sessao) => send({ type: 'voz_sessao', id: msg.id, sessao }))
        .catch((err) => send({ type: 'voz_sessao', id: msg.id, erro: err.message }))
    }

    if (msg.type === 'preferencias') {
      broadcast({ type: 'preferencias', valores: preferencias.gravar(msg.valores) })
    }

    if (msg.type === 'aurora' && !celular) {
      void (aurora ? aurora.bomDia() : Promise.resolve({ ok: false, mensagem: 'falta APOLO_AURORA_TOKEN no .env.local' }))
        .then((r) => send({ ...r, type: 'aurora', resposta: msg.id }))
    }

    if (msg.type === 'fenix' && typeof msg.acao === 'string') {
      void pedirAFenix(msg)
        .catch((err) => ({ ok: false, mensagem: err.message }))
        // O id e o tipo da interface vêm por último: os da Fênix não podem cobri-los.
        .then((r) => send({ ...r, type: 'fenix', resposta: msg.id }))
    }

    if (msg.type === 'autodev' && typeof msg.acao === 'string') {
      void autodev
        .acao(msg.acao, { pedido: msg.pedido })
        .catch((err) => ({ ok: false, mensagem: err.message }))
        .then((r) => send({ type: 'autodev', resposta: msg.id, ...r }))
    }

    if (msg.type === 'reply' && typeof msg.id === 'string') {
      const slot = waiting.get(msg.id)
      if (slot) {
        waiting.delete(msg.id)
        clearTimeout(slot.timer)
        slot.resolve(msg)
      }
    }

    if (msg.type === 'interrupt') {
      // Held so the next question can wait for it rather than racing it.
      const stopped = turnFinished()
      settling = Promise.resolve(session.interrupt?.())
        .catch(() => {})
        .then(() =>
          Promise.race([
            stopped,
            new Promise((r) => setTimeout(r, SETTLE_CAP_MS)),
          ]),
        )
    }
  })

  socket.on('close', () => {
    console.log(`[apolo] ${celular ? 'celular' : 'interface'} desconectado`)
    if (celular) {
      telemetria.evento('canal_aberto', Date.now() - conectouEm)
      celularesConectados--
      canaisMudaram()
    }
    interfacesDoPc.delete(socket)
    ouvintesDosCanais.delete(reenviarCanais)
    dispositivo.sair()
    closed = true
    deliver?.(null)
    session.close?.()
  })
}

wss.on('connection', (socket, req) => atender(socket, { celular: req.doHermes === true }))

if (!TOKEN_DO_HERMES) console.log('[apolo] sem celular pareado — rode npm run celular para parear')
if (!fenix) console.log('[apolo] sem a F.Ê.N.I.X.: troca de versão e rotinas desligadas (suba com npm start)')
