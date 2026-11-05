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
import { gitServer } from './git.mjs'
import { visionServer } from './vision.mjs'
import { homedir, tmpdir } from 'node:os'
import { readFileSync, realpathSync } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve as resolvePath } from 'node:path'
import { openRemote, proxyError, vetTarget, PROXY_UA } from './net.mjs'
import { probeUrl, renderPage } from './page.mjs'
import { createRealtimeSession, realtimeKey, realtimeModel, voiceProvider } from './realtime.mjs'
import { fileURLToPath } from 'node:url'
import { criarAutodev } from './autodev/index.mjs'

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
 * Who is allowed to talk to this bridge.
 *
 * A WebSocket handshake is not subject to the same-origin policy: the browser
 * sends it on behalf of whatever page asked, no preflight stands in the way,
 * and the page reads every byte that comes back. Without a check here, any tab
 * the user happens to have open could open a socket to ws://localhost:8787,
 * drive the agent with every MCP server on this machine, and read back every
 * token and panel. The Origin header is the only thing that separates our own
 * dev server from someone else's page, so it is checked explicitly.
 *
 * A missing Origin means a non-browser client — curl, a script, a native app.
 * That is also exactly what local malware looks like, so it is refused on the
 * socket unless JARVIS_ALLOW_NO_ORIGIN=1 says otherwise.
 */
const EXTRA_ORIGINS = new Set(
  (process.env.JARVIS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean),
)
const ALLOW_NO_ORIGIN = process.env.JARVIS_ALLOW_NO_ORIGIN === '1'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Vite takes the next free port when 5173 is busy and `vite preview` starts at
 * 4173, so the dev ranges are allowed rather than two exact numbers. Anything
 * else — including localhost on a port some other app is serving — has to be
 * named in JARVIS_ALLOWED_ORIGINS.
 */
const isDevPort = (port) =>
  (port >= 5173 && port <= 5199) || (port >= 4173 && port <= 4199)

function originAllowed(origin) {
  if (!origin) return ALLOW_NO_ORIGIN
  if (EXTRA_ORIGINS.has(origin.replace(/\/+$/, ''))) return true
  let url
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.protocol !== 'http:') return false
  if (!LOCAL_HOSTS.has(url.hostname)) return false
  return isDevPort(Number(url.port))
}

/**
 * Voice is a bad interface for a confirmation dialog: there is no window to
 * click and the model can't pause for one. So the bridge decides.
 *
 * Read-only and generative tools run freely. Anything that writes to disk,
 * runs a shell, or changes the world waits for JARVIS_ALLOW_WRITES=1. Start
 * without it, and turn it on once you trust what you're demoing.
 */
const ALLOW_WRITES = process.env.JARVIS_ALLOW_WRITES === '1'

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

/**
 * Both spellings of every renamed built-in are listed on purpose. The SDK
 * presents several tools to the model under newer names — Task is Agent,
 * BashOutput is TaskOutput, KillShell is TaskStop, and the MCP resource tools
 * gained a "Tool" suffix — so a set holding only the old names never matches
 * and the tool falls through to the write branch, which is the opposite of
 * what these lists mean. Keep both until the old names are certainly gone.
 */
const READ_ONLY_BUILTINS = new Set([
  'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoWrite',
  'Task', 'Agent', 'ToolSearch',
  'ListMcpResources', 'ListMcpResourcesTool',
  'ReadMcpResource', 'ReadMcpResourceTool',
  'BashOutput', 'TaskOutput',
])
const WRITE_BUILTINS = new Set([
  'Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit',
  'KillShell', 'TaskStop',
])

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
function configuredServers() {
  try {
    const cfg = JSON.parse(
      readFileSync(join(homedir(), '.claude.json'), 'utf8'),
    )
    return {
      ...(cfg.mcpServers ?? {}),
      // Servers scoped to the home directory apply too, since that's our cwd.
      ...(cfg.projects?.[homedir()]?.mcpServers ?? {}),
    }
  } catch {
    return {}
  }
}

const MCP_SERVERS = configuredServers()

/** MCP tools arrive as `mcp__<server>__<tool>`. */
const mcpServerOf = (toolName) =>
  toolName.startsWith('mcp__') ? toolName.split('__')[1] : null

/** The tool half, which can itself contain underscores: `mcp__x__a__b` -> `a__b`. */
const mcpToolOf = (toolName) => toolName.split('__').slice(2).join('__')

/**
 * MCP policy, and why it is shaped this way.
 *
 * A short list of "servers that can change things" is the wrong default,
 * because it is a list of what we happened to think of. Every server not on it
 * runs unconditionally — and on a real machine that quietly includes placing a
 * phone call, spending an advertising budget, deleting a generated character
 * and writing files to disk. A voice assistant cannot ask "are you sure", so
 * the bridge has to be the one that is sure.
 *
 * So the default is deny, softened in two ways so the demo stays usable:
 *
 *   1. READ_ONLY_MCP is an explicit allowlist of servers whose whole surface is
 *      lookups and generation — search, registries, analytics reads. Anything
 *      there runs in read-only mode.
 *   2. Everywhere else, the tool has to argue for itself: its own name must
 *      begin with a read verb. `list_devices` runs; `install_apk` does not.
 *
 * On top of both sits a veto: a name containing a plainly effectful verb needs
 * ALLOW_WRITES no matter which server it came from, which is what keeps
 * `make_outbound_call` and `download_lottie` still until you ask for them.
 */
const READ_ONLY_MCP = new Set([
  'exa', 'exa-code', 'serper', 'serpapi', 'lottie-search', 'mcp-registry',
  'openrouter', 'openrouter-image', 'Microsoft_Clarity',
  // The generation servers belong here too, and leaving them out was a real
  // regression: `generate_image` begins with no read verb, so it fell to the
  // deny branch and "generate an image of the Mark VII suit" — the headline
  // demo — stopped working in the default mode.
  //
  // Putting them on the allowlist is safe because the veto below still applies
  // to allowlisted servers: it is what continues to withhold
  // make_outbound_call, delete_character, create_* and edit_image. Generation
  // runs; acting on the world does not.
  'higgsfield', 'heygen', 'elevenlabs',
])

/**
 * Anchored on the tool name, so it reads the verb rather than the noun.
 * `screenshot` is in here because it is a read that doesn't sound like one,
 * and the persona is told in as many words to put screenshots on the display.
 */
const READ_VERB =
  /^(get|list|read|search|find|query|fetch|check|describe|inspect|show|view|explain|screenshot)/i

/**
 * Unanchored on purpose — `make_outbound_call` and `Bulk-Edit-Events` both
 * hide their verb in the middle. `download` is here because it writes a file
 * even though it sounds like a read.
 */
const EFFECTFUL_VERB =
  /(send|call|post|create|delete|remove|update|edit|write|install|launch|tap|swipe|press|type|buy|pay|charge|publish|deploy|outbound|download)/i

/**
 * Tools whose names trip the veto without deserving it.
 *
 * The veto reads verbs out of names, which is the right instinct and
 * occasionally the wrong answer. `openrouter send-message` sends a prompt to a
 * language model and gets text back — nothing in the world changes — but it is
 * indistinguishable by name from sending mail. Asking a second model a question
 * is one of the better things this assistant can do, so it is named here
 * instead of being lost to a regex.
 *
 * Full `server__tool` keys, so an exemption can never leak across servers.
 */
const VETO_EXEMPT = new Set([
  'openrouter__send-message',
  'openrouter__send-feedback',
])

function decideTool(name) {
  if (READ_ONLY_BUILTINS.has(name)) return true
  if (WRITE_BUILTINS.has(name)) return ALLOW_WRITES

  const server = mcpServerOf(name)
  if (server) {
    // The HUD, and the interface controls beside it. Both run in this process
    // and draw on our own screen, so neither is something to withhold —
    // without them JARVIS has no display at all. They also have to be named
    // here rather than left to the verb rules below, which read `ui_theme` as
    // a write and would hold the whole surface back behind ALLOW_WRITES.
    if (server === 'apolo' || server === 'apolo_ui') return true

    // The browser server gates itself, at construction: chromeServer() only
    // builds the acting tools — click, type, form input, close tab — when
    // ALLOW_WRITES is set, so anything that reaches here at all is something
    // the same policy has already permitted. Deciding it a second time by
    // reading verbs out of the name would only get it wrong: `chrome_navigate`
    // begins with no read verb and would fall to the write branch, which would
    // withhold the one tool the whole server is for.
    if (server === 'apolo_navegador') return true

    // O ambiente: em que navegador e em que sistema a interface está, e as abas
    // que o A.P.O.L.O. abriu nela. Permitido pelo mesmo critério do servidor
    // acima — abrir uma aba é tão visível e tão reversível quanto navegar numa,
    // que já passa aqui, e nada disto escreve em disco, envia nada nem preenche
    // formulário. Nomeado em vez de deixado às regras de verbo porque
    // `browser_open_tab` não começa com verbo de leitura e ficaria preso atrás
    // de ALLOW_WRITES, o que tiraria do ar a metade útil do requisito. Agir
    // DENTRO de uma página continua sendo assunto de apolo_navegador, com o
    // gate dele.
    if (server === 'apolo_ambiente') return true

    // O repositório do próprio A.P.O.L.O. (RF-17, ADR 0013). Mesmo critério do
    // servidor do navegador: gitServer() só constrói `git_commit` e
    // `git_pull_request` quando ALLOW_WRITES está ligado, então o que chega
    // aqui já passou pela mesma política. Decidir de novo pelo nome erraria nas
    // duas pontas — `git_status` não começa com verbo de leitura e ficaria
    // atrás do gate, e `git_commit` não contém nenhum verbo da lista de efeito.
    if (server === 'apolo_git') return true

    // The camera. Not withheld behind ALLOW_WRITES: looking changes nothing,
    // and the real gate is the browser's own camera permission plus an
    // indicator the user can see for as long as it is live.
    if (server === 'apolo_visao') return true

    const tool = mcpToolOf(name)
    if (EFFECTFUL_VERB.test(tool) && !VETO_EXEMPT.has(`${server}__${tool}`)) {
      return ALLOW_WRITES
    }
    // The session tools this bridge is developed inside count as read-only too.
    if (READ_ONLY_MCP.has(server) || server.startsWith('ccd_session')) return true
    return READ_VERB.test(tool) ? true : ALLOW_WRITES
  }
  return ALLOW_WRITES
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
  estiver nela, informe o nome de uma branch nova.
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
const http = await import('node:http')

const handleRequest = async (req, res) => {
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
        // O supervisor usa isto para saber se a interface voltou depois de uma troca.
        interfaces: wss.clients.size,
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
      const page = await renderPage(target, mode, `http://localhost:${PORT}`)
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

const server = http.createServer((req, res) => {
  // The handler is async, so anything it throws would otherwise become an
  // unhandled rejection and leave the browser waiting on a socket that is
  // never going to answer.
  handleRequest(req, res).catch((err) => {
    console.error('[apolo] requisição falhou:', err)
    if (!res.headersSent) res.writeHead(500)
    res.end()
  })
})

const wss = new WebSocketServer({
  server,
  // The handshake is the only place a page can be turned away, so it happens
  // here rather than after the socket is open. Rejections are logged loudly:
  // the likeliest cause is a dev server on an unexpected port, and a silent
  // 403 would look like the bridge simply isn't running.
  verifyClient: ({ origin, req }, done) => {
    const path = (req.url ?? '/').split('?')[0]
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
const broadcast = (msg) => {
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(JSON.stringify(msg))
  }
}
/** A cópia do projeto que está no ar. O autodev e o sub-módulo git partem dela. */
const REPO = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')

const autodev = criarAutodev({
  repo: REPO,
  ligado: process.env.APOLO_AUTODEV === '1',
  supervisor: process.send ? (msg) => process.send(msg) : null,
  avisar: (estado) => broadcast({ type: 'autodev', estado }),
  interfaces: () => wss.clients.size,
})
process.on('message', (msg) => {
  if (msg?.type === 'autodev:resultado') autodev.resultado(msg)
})

console.log(`[apolo] ponte ouvindo em ws://localhost:${PORT}`)
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

wss.on('connection', (socket) => {
  console.log('[apolo] interface conectada')

  // Answer the HUD straight away rather than making it wait for the agent's
  // first turn. Refined later by the real init message.
  socket.send(
    JSON.stringify({ type: 'ready', servers: Object.keys(MCP_SERVERS) }),
  )
  socket.send(JSON.stringify({ type: 'autodev', estado: autodev.estado() }))

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
  const sendTurn = (msg) => send({ ...msg, ask: answering })

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
        // The interface controls, on the same socket. A separate key because
        // MCP tool names are `mcp__<key>__<tool>` and one key can only carry
        // one server; the underscore in it is why decideTool and announceTool
        // both name `apolo_ui` explicitly.
        apolo_ui: uiServer((op, args) => send({ type: 'ui', op, args })),
        // The user's own Chrome, over the extension's native-host socket. It
        // holds no per-connection state, but it is built here with the rest so
        // the write gate is read once, at the same point as everything else.
        apolo_navegador: chromeServer({ allowWrites: ALLOW_WRITES }),
        // O navegador em que a interface está aberta: qual é ele, qual o
        // sistema embaixo dele, e as abas e popups que o A.P.O.L.O. abriu lá
        // (RF-19, ADR 0012). Como a câmera, pergunta à interface e espera.
        apolo_ambiente: navegadorServer(ask),
        // O repositório do próprio A.P.O.L.O. (RF-17, ADR 0013): ver o que está
        // pendente, commitar numa branch e abrir pull request para a main. Como
        // o navegador, ele se fecha sozinho quando a escrita está bloqueada:
        // sem --writes, só as duas ferramentas de leitura existem.
        apolo_git: gitServer({
          repo: REPO,
          allowWrites: ALLOW_WRITES,
          // Commitar ou criar branch no meio de uma troca de versão mexeria no
          // repositório debaixo do supervisor, que está comparando shas.
          ocupado: () =>
            ['trabalhando', 'verificando', 'aplicando'].includes(autodev.estado().fase)
              ? 'o autodesenvolvimento está no meio de um trabalho'
              : null,
        }),
        // The camera, which unlike everything else here has to ask and wait.
        apolo_visao: visionServer(ask),
      },
      // A plain system prompt, not the claude_code preset. The preset is
      // tuned for a coding agent — verbose, file-oriented, and a large chunk
      // of input tokens on every turn. Replacing it makes the persona stick,
      // keeps answers short enough to speak, and cuts cost per turn.
      systemPrompt: SYSTEM_PROMPT,
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
      effort: EFFORT,
      maxTurns: 24,
      permissionMode: 'default',
      // Without this the SDK only emits whole assistant messages, and JARVIS
      // would sit silent until the entire answer was written. Partial events
      // are what let speech start on the first finished sentence.
      includePartialMessages: true,
      // Signature is (toolName, input, options) and it must return a
      // PermissionResult object. Returning a bare boolean silently denies
      // everything, with the tool name arriving undefined.
      //
      // Worth knowing: this is a last gate, not the only one. Calls the CLI
      // has already settled never arrive here — its own classifier waves
      // through a `Bash: echo hello` without asking, and only reaches us for
      // something with a consequence, like a `touch`. So a deny here is
      // reliable; an absence of a call here is not proof nothing ran.
      canUseTool: async (toolName) => {
        const ok = decideTool(toolName)
        console.log(`[apolo] ferramenta ${toolName} -> ${ok ? 'permitida' : 'negada'}`)
        return ok
          ? { behavior: 'allow' }
          : {
              behavior: 'deny',
              // Every word of this can end up spoken, so it carries no command
              // to read out — the persona is forbidden from saying one aloud.
              message:
                'Bloqueado: o A.P.O.L.O. está em modo somente leitura e não pode' +
                ' executar ações que mudem algo. Diga ao usuário que esta ação' +
                ' fica indisponível até ele liberar a escrita nesta máquina.',
            }
      },
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
              // lazily — so only drop the ones that are actually unusable.
              const usable = (msg.mcp_servers ?? [])
                .filter((s) => s.status !== 'needs-auth' && s.status !== 'failed')
                .map((s) => s.name)
              send({ type: 'ready', servers: usable })
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
    console.log('[apolo] interface desconectada')
    closed = true
    deliver?.(null)
    session.close?.()
  })
})
