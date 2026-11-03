/**
 * Falas de preenchimento.
 *
 * Uma ferramenta pode levar dez segundos, e um silêncio desse tamanho parece
 * travamento. Então o A.P.O.L.O. diz algo assim que o trabalho começa — e fica
 * quieto até ter a resposta. Uma confirmação, sem narrar o progresso.
 *
 * O tom segue a persona (ver SYSTEM_PROMPT em bridge/server.mjs):
 *
 *   - Frases curtas e impessoais: "Pesquisando.", "Cruzando os dados." Nunca
 *     "deixa eu ver" ou "só um momento".
 *   - Sem pressa servil nem entusiasmo: nada de "Claro!", "Com certeza!".
 *   - Sem palavras de enchimento, sem desculpas, sem pontos de exclamação.
 *   - Sem pronome de tratamento ("senhor"); a cortesia está na precisão.
 */

/** Dita uma vez ao ligar. Sem palavras em inglês: a voz própria tropeça nelas. */
export const INTRO = 'Apolo ativo. Todos os sistemas operacionais.'

/** Dita assim que a primeira ferramenta dispara, antes de haver resposta. */
const WORKING = [
  'Trabalhando nisso.',
  'Compilando.',
  'Buscando.',
  'Consultando o arquivo.',
  'Cruzando os dados.',
  'Executando a consulta.',
  'Pesquisando.',
  'Em andamento.',
]

/** Confirmação de uma ordem que não envolve ferramenta. */
const ACKNOWLEDGE = [
  'Entendido.',
  'Feito.',
  'Pode deixar.',
  'Certo.',
  'Considere feito.',
  'Agora mesmo.',
]

/** Respondendo ao nome, antes de o usuário dizer o que quer. */
const ATTENTION = [
  'Pois não?',
  'Sim?',
  'Estou aqui.',
  'À disposição.',
  'Pode falar.',
]

/**
 * Avoids repeating the same phrase twice running, which is what makes canned
 * lines sound canned. Keeps one slot of history per pool.
 */
function makePicker(pool: string[]) {
  let last = -1
  return () => {
    if (pool.length < 2) return pool[0] ?? ''
    let i = last
    while (i === last) i = Math.floor(Math.random() * pool.length)
    last = i
    return pool[i]
  }
}

export const working = makePicker(WORKING)
export const acknowledge = makePicker(ACKNOWLEDGE)
export const attention = makePicker(ATTENTION)

/**
 * Naming the task is warmer than a generic acknowledgement and shows the
 * integration off on camera. Still participial, still under five words.
 *
 * MCP tool names are `mcp__<server>__<tool>`, and the two halves say different
 * things: the server is who is being asked, the tool is what is being asked
 * for. Matching one flat substring against the whole string gets both wrong —
 * `mcp__playwright__browser_click` announced a web search because "browse"
 * appeared earlier in the table than "browser", `Get-Report` looked like a code
 * repository, `Get-Events` like a calendar entry, and "highlight" like a lamp.
 *
 * So: split the name, match the halves separately, order the table so the
 * specific beats the general, and put word boundaries on the short words that
 * hide inside longer ones. Either half matching is enough — the server is the
 * better signal when a name gives one, but plenty of them don't.
 */
type Rule = {
  /** Matched against the server segment, if there is one. */
  server?: RegExp
  /** Matched against the tool segment, or the whole name for a built-in. */
  tool?: RegExp
  lines: string[]
}

const FOOTAGE = ['Montando o vídeo.', 'Renderizando a sequência.']

const BY_TOOL: Rule[] = [
  // Video sits above image because higgsfield and palmier both do either, so
  // the verb in the tool name is the only thing separating them — a rule on the
  // server alone would send every generate_video to "Rendering."
  { tool: /video|footage|\bclip\b|\breel\b|talking_head/, lines: FOOTAGE },
  {
    server: /higgsfield|openrouter-image|dalle|flux|midjourney/,
    tool: /image|photo|thumbnail|render|upscale|seedream/,
    lines: ['Renderizando.', 'Compondo a imagem.'],
  },
  // The editors, once the two rules that read the verb have had their turn.
  { server: /palmier|heygen|runway|descript/, lines: FOOTAGE },
  {
    server: /playwright|puppeteer|browserbase|chrome|navegador/,
    tool: /\bbrowser\b|navigate/,
    lines: ['Abrindo o navegador.', 'Navegando.'],
  },
  {
    server: /android|\badb\b|simulator/,
    tool: /\bdevice\b|\bapk\b|\bphone\b/,
    lines: ['Acessando o aparelho.', 'Conectando ao seu celular.'],
  },
  {
    server: /gmail|\bmail\b/,
    tool: /gmail|\bmail\b|email|inbox/,
    lines: ['Verificando seu e-mail.', 'Lendo a caixa de entrada.'],
  },
  // Calendar keys off "calendar" alone. "event" used to live here, which is how
  // a Mixpanel event query came out as "Checking your calendar."
  {
    tool: /calendar|\bdiary\b|\bmeeting\b/,
    lines: ['Verificando sua agenda.', 'Consultando os compromissos.'],
  },
  {
    server: /elevenlabs|openai-tts/,
    tool: /speech|\bvoice\b|\btts\b|text_to_sound/,
    lines: ['Sintetizando.', 'Trabalhando nisso.'],
  },
  {
    server: /spotify|sonos/,
    tool: /\bplay\b|\bmusic\b|playlist|\btrack\b/,
    lines: ['Colocando na fila.', 'Tocando.'],
  },
  {
    server: /^home|homeassistant|\bhue\b|\bhass\b/,
    tool: /\blights?\b|thermostat|\bdimmer\b/,
    lines: ['Ajustando.', 'Cuidando disso.'],
  },
  {
    server: /github|linear|jira|sentry/,
    tool: /\brepo\b|repository|\bissues?\b|pull_request|\bcommit\b/,
    lines: ['Verificando o repositório.', 'Consultando as tarefas.'],
  },
  // Also where the anonymously named analytics servers land — theirs are bare
  // UUIDs, so only the tool half says anything: Get-Report, Get-Events,
  // Run-Query. "report" is safe from the repository rule above because that one
  // is bounded.
  {
    server: /mixpanel|clarity|posthog|amplitude/,
    tool: /analytic|\bmetrics?\b|\breports?\b|\bevents?\b|cohort|funnel|dashboard|\bquery\b/,
    lines: ['Executando a consulta.', 'Levantando os números.'],
  },
  {
    server: /\bexa\b|serper|serpapi|perplexity|tavily|brave/,
    tool: /search|\bweb\b|\bfetch\b|crawl|research/,
    lines: ['Pesquisando.', 'Consultando as fontes.'],
  },
]

const pickers = BY_TOOL.map((r) => ({ ...r, pick: makePicker(r.lines) }))

/**
 * Todas as frases fixas, sem repetição. É a lista que `npm run voz:gerar`
 * pré-grava com a voz própria (ver tts.ts); uma frase nova aqui só ganha a voz
 * própria depois de rodar o script de novo — até lá sai na voz do sistema.
 */
export const FIXED_PHRASES: readonly string[] = [
  ...new Set([INTRO, ...WORKING, ...ACKNOWLEDGE, ...ATTENTION, ...BY_TOOL.flatMap((r) => r.lines)]),
]

/**
 * `mcp__<server>__<tool>`, split on the first separator so tool names keep
 * their own underscores (`browser_click`, `text_to_speech`). A built-in like
 * WebSearch or Bash has no server half.
 *
 * The second form matters more than it looks: the bridge client prettifies
 * names for the HUD badge before handing them on, so what actually arrives
 * here is `higgsfield · generate image`. Parsing only the raw form meant every
 * rule below silently missed and every tool got the generic line.
 */
function split(toolName: string): { server: string; tool: string } {
  const raw = /^mcp__(.+?)__(.+)$/.exec(toolName)
  if (raw) return { server: raw[1].toLowerCase(), tool: raw[2].toLowerCase() }

  const pretty = toolName.split(' · ')
  if (pretty.length === 2) {
    return { server: pretty[0].toLowerCase(), tool: pretty[1].toLowerCase() }
  }

  return { server: '', tool: toolName.toLowerCase() }
}

/** A phrase suited to the tool that just fired. */
export function forTool(toolName: string): string {
  const { server, tool } = split(toolName)
  for (const r of pickers) {
    const hit =
      (r.server !== undefined && server !== '' && r.server.test(server)) ||
      (r.tool !== undefined && r.tool.test(tool))
    if (hit) return r.pick()
  }
  // Read, Bash, Grep and anything unrecognised: better a neutral line than a
  // confident wrong one.
  return working()
}
