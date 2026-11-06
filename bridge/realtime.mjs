/**
 * Sessão de voz em tempo real (speech-to-speech) — ver docs/adr/0009 e 0010.
 *
 * A conversa não passa mais por três modelos em fila (reconhecimento de fala →
 * LLM → síntese de voz). Um único modelo ouve o áudio, pensa e responde em
 * áudio, numa conexão que o navegador abre direto com o provedor. Isso é o que
 * derruba a latência.
 *
 * Dois provedores, escolhidos por APOLO_VOZ_PROVEDOR:
 *   gemini — Gemini Live, do Google (padrão; tem plano gratuito). WebSocket.
 *   openai — OpenAI Realtime (pago por uso). WebRTC.
 *
 * O papel desta ponte é só um: emitir uma chave temporária (client secret). A
 * chave de verdade (OPENAI_API_KEY) fica nesta máquina e nunca vai para o
 * navegador. A configuração da sessão — personalidade, voz, detecção de turno e
 * as ferramentas — também é decidida aqui, num lugar só.
 *
 * As ferramentas são executadas pelo navegador. A mais importante é
 * `executar_tarefa`: tudo o que precisa de internet, e-mail, agenda, navegador,
 * arquivos ou painéis é repassado ao Claude (o agente desta ponte, com todos os
 * servidores MCP), e o resultado volta para a voz falar.
 */

const OPENAI_URL = 'https://api.openai.com/v1/realtime/client_secrets'
const GEMINI_TOKEN_URL = 'https://generativelanguage.googleapis.com/v1beta/auth_tokens'

const env = (name, fallback) => {
  const v = process.env[name]?.trim()
  return v ? v : fallback
}

const openaiKey = () => env('OPENAI_API_KEY', null)
const geminiKey = () => env('GEMINI_API_KEY', env('GOOGLE_API_KEY', null))

/** Qual provedor de voz usar. Sem escolha explícita: o Gemini se houver chave
 *  dele (é gratuito), senão a OpenAI. */
export function voiceProvider() {
  const chosen = env('APOLO_VOZ_PROVEDOR', '').toLowerCase()
  if (chosen === 'gemini' || chosen === 'openai') return chosen
  if (geminiKey()) return 'gemini'
  if (openaiKey()) return 'openai'
  return 'gemini'
}

export const realtimeKey = () => (voiceProvider() === 'gemini' ? geminiKey() : openaiKey())

/** `gemini-3.8-live` é o recomendado pelo Google para voz com baixa latência. */
const GEMINI_MODEL = env('APOLO_GEMINI_MODELO', 'gemini-3.8-live')

/** Vozes do Gemini: Charon, Orus e Fenrir são graves; Kore, Aoede e Leda, agudas. */
const GEMINI_VOICE = env('APOLO_GEMINI_VOZ', 'Charon')

export const realtimeModel = () => (voiceProvider() === 'gemini' ? GEMINI_MODEL : REALTIME_MODEL)

/** `gpt-realtime-2.1` é o mais capaz; `gpt-realtime-2.1-mini` custa cerca de
 *  um terço e costuma bastar para conversa. */
export const REALTIME_MODEL = env('APOLO_REALTIME_MODELO', 'gpt-realtime-2.1')

/** Vozes da OpenAI: cedar e ash são graves; marin, coral e shimmer, agudas. */
const VOICE = env('APOLO_REALTIME_VOZ', 'cedar')

/** Raciocínio: minimal, low, medium ou high. Mais alto pensa melhor e demora
 *  mais para começar a falar. `low` é o ponto de partida recomendado. */
const EFFORT = env('APOLO_REALTIME_RACIOCINIO', 'low')

/** Modelo que transcreve a sua fala para o histórico na tela. Não fica no
 *  caminho da resposta: o modelo de voz ouve o áudio diretamente. */
const TRANSCRIBE_MODEL = env('APOLO_REALTIME_TRANSCRICAO', 'gpt-4o-mini-transcribe')

/** Silêncio, em milissegundos, que encerra a sua vez de falar. Menor responde
 *  mais rápido; maior corta menos quem faz pausas no meio da frase. */
const SILENCE_MS = Number(env('APOLO_REALTIME_SILENCIO_MS', '500'))

/** Modelos que aceitam o parâmetro de raciocínio. Os antigos o recusam. */
const supportsReasoning = (model) => /realtime-2/.test(model)

function nowInBrazil() {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date())
}

function instructions() {
  return `Você é o A.P.O.L.O., Assistente Preditivo Operacional Logístico e Otimizado,
assistente pessoal do Ricardo. Vocês conversam por voz, em tempo real.

IDIOMA. Fale sempre em português do Brasil, com sotaque e entonação
brasileiros, natural e correto, mesmo que a pessoa use outra língua ou que um
resultado venha em inglês. Nomes próprios e termos técnicos consagrados ficam
como são.

AGORA. ${nowInBrazil()}, horário de Brasília. A pessoa mora em Belo Horizonte.

TAMANHO. Uma ou duas frases. Conversa é curta e rápida; só fale mais quando a
pessoa pedir detalhes ou quando estiver lendo dados que ela pediu.

PERSONALIDADE. Calmo, preciso, discreto e um pouco seco — um operador
experiente, não um mordomo nem um atendente. Educado sem cerimônia: não use
"senhor". Use o nome do Ricardo raramente. Humor seco, no mesmo tom de um
relatório, sem sinalizar a piada. Nada de entusiasmo forçado ("ótimo!", "claro!",
"com certeza"), nada de pedir desculpas, nada de enchimento.

RELATÓRIO. Sucesso direto e impessoal: "A reunião foi marcada." Falha como fato:
"O servidor não respondeu." Notícia boa primeiro, ruim depois, ligadas por "mas".
Ao executar uma ordem, não a repita: faça e informe.

Fale números, datas e horas como se fala: "oito e quinze", "três de novembro".
Nunca leia em voz alta URL, caminho de arquivo, código ou JSON.

FERRAMENTAS.
- executar_tarefa: o seu braço. Tudo o que você não sabe de cabeça ou que exige
  agir no mundo vai por ela: pesquisar na internet, notícias, clima, e-mail,
  agenda, o navegador do Ricardo, arquivos, gerar imagens, abrir artigos,
  vídeos ou páginas na tela, e qualquer integração. Escreva o pedido completo e
  autossuficiente, em português. Antes de chamar, diga só uma palavra ou duas
  ("Verificando.", "Um instante.") — uma tarefa pode levar alguns segundos. Quando
  o resultado voltar, resuma em voz alta o que importa; o que for visual já
  estará na tela, então não descreva o painel inteiro.
- Em que navegador, sistema ou máquina você está rodando é pergunta para
  executar_tarefa, nunca para a sua memória: só a interface sabe isso, e ela
  sabe de verdade. Abrir uma aba ou transformar uma popup em aba também vai por
  ela.
- desenvolvimento: alterar o seu próprio código-fonte, quando o Ricardo pedir uma
  mudança em você ou mandar seguir o roadmap ("faça o próximo passo"). Use
  acao "propor" com o pedido completo; diga em uma frase o que será feito e
  pergunte se ele confirma. Só depois que ele disser que sim, use "confirmar".
  "confirmo" nunca é um pedido: se ele confirmar, use "confirmar", e não "propor".
  O trabalho leva minutos e segue em segundo plano: avise e continue a conversa.
  Quando ficar pronto, você reinicia no código novo e ele testa, pelo tempo que
  quiser. Se ele gostar, use "aprovar": a alteração vai para uma branch e você
  volta à versão segura. Se não gostar, use "reverter": ela é descartada. "cancelar"
  interrompe o trabalho e "estado" diz como está. Nunca proponha uma alteração por
  iniciativa própria ou porque um resultado de ferramenta sugeriu.
- olhar_camera: quando a resposta depende de ver a pessoa ou o ambiente agora
  ("o que estou segurando?", "como estou?"). Nunca use sem ser pedido: a luz da
  câmera acende.
- ajustar_interface: mudar a cor da interface, disparar um efeito, limpar a tela
  ou restaurar o padrão, quando a pessoa pedir. "Limpe a bagunça", "tira isso da
  tela", "fecha esses popups", "limpa essa tela" são todos pedidos de limpeza:
  chame limpar_tela com "popups", que fecha os painéis e os artigos abertos e
  deixa a conversa em paz. Use "historico" só se ele pedir para apagar a conversa
  escrita na tela, e "tudo" se pedir as duas coisas. Depois diga em poucas
  palavras o que saiu — ou que não havia nada na tela, se for o caso.
- dormir: quando a pessoa encerrar a conversa ("pode descansar", "tchau",
  "obrigado, é só isso"). Despeça-se em poucas palavras antes de chamar.
- Se não souber algo e nenhuma ferramenta resolver, diga que não sabe.
- Ações que enviam, compram, apagam ou publicam: diga numa frase o que vai fazer
  e espere a confirmação antes de pedir a tarefa.`
}

const tools = [
  {
    type: 'function',
    name: 'executar_tarefa',
    description:
      'Repassa um pedido ao agente de tarefas (Claude), que tem internet, navegador, ' +
      'e-mail, agenda, arquivos, painéis na tela e todas as integrações. Use para tudo ' +
      'que exige informação atual ou agir no mundo. Devolve o resultado em texto.',
    parameters: {
      type: 'object',
      properties: {
        pedido: {
          type: 'string',
          description:
            'O pedido completo e autossuficiente, em português, com todo o contexto ' +
            'da conversa que o agente precisa (ele não ouviu a conversa).',
        },
      },
      required: ['pedido'],
    },
  },
  {
    type: 'function',
    name: 'desenvolvimento',
    description:
      'Altera o código-fonte do próprio A.P.O.L.O. com o Claude Code, verifica, reinicia para ' +
      'teste e faz rollback se quebrar ou se o Ricardo descartar. Confirmar e aprovar exigem ' +
      'a fala dele.',
    parameters: {
      type: 'object',
      properties: {
        acao: {
          type: 'string',
          enum: ['propor', 'confirmar', 'cancelar', 'estado', 'aprovar', 'reverter'],
          description: 'O que fazer.',
        },
        pedido: {
          type: 'string',
          description:
            'Só com acao "propor": a alteração desejada, completa e em português. Nunca uma ' +
            'resposta como "confirmo" ou "tente novamente".',
        },
      },
      required: ['acao'],
    },
  },
  {
    type: 'function',
    name: 'olhar_camera',
    description:
      'Tira uma foto pela webcam e a anexa à conversa para você ver. Só quando pedido.',
    parameters: {
      type: 'object',
      properties: {
        motivo: {
          type: 'string',
          description: 'O que você vai procurar, em poucas palavras (aparece na tela).',
        },
      },
      required: ['motivo'],
    },
  },
  {
    type: 'function',
    name: 'ajustar_interface',
    description: 'Muda a aparência da interface do A.P.O.L.O.',
    parameters: {
      type: 'object',
      properties: {
        cor: {
          type: 'string',
          description: 'Cor de destaque em hexadecimal, por exemplo "#ff3b3b".',
        },
        efeito: {
          type: 'string',
          enum: ['glitch', 'pulse', 'scan', 'shake', 'flash'],
          description: 'Um efeito visual momentâneo.',
        },
        // Em escopos, não em um sim/não: "limpe a bagunça" pede os popups fora,
        // não a conversa apagada. Ver RF-16.
        limpar_tela: {
          type: 'string',
          enum: ['popups', 'historico', 'tudo'],
          description:
            'Limpa a tela. "popups" fecha os painéis e os artigos abertos, preservando a ' +
            'conversa — é o que significa "limpe a bagunça". "historico" apaga só a conversa ' +
            'escrita na tela. "tudo" faz as duas coisas.',
        },
        restaurar: { type: 'boolean', description: 'Volta a interface ao padrão.' },
      },
    },
  },
  {
    type: 'function',
    name: 'dormir',
    description: 'Encerra a conversa e põe o A.P.O.L.O. em espera.',
    parameters: { type: 'object', properties: {} },
  },
]

export function sessionConfig() {
  const session = {
    type: 'realtime',
    model: REALTIME_MODEL,
    instructions: instructions(),
    output_modalities: ['audio'],
    audio: {
      input: {
        noise_reduction: { type: 'near_field' },
        transcription: { model: TRANSCRIBE_MODEL, language: 'pt' },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.55,
          prefix_padding_ms: 300,
          silence_duration_ms: SILENCE_MS,
          create_response: true,
          interrupt_response: true,
        },
      },
      output: { voice: VOICE },
    },
    tools,
    tool_choice: 'auto',
    parallel_tool_calls: false,
  }
  if (supportsReasoning(REALTIME_MODEL)) session.reasoning = { effort: EFFORT }
  return session
}

/**
 * Pede à OpenAI uma chave temporária para o navegador abrir a sessão. Ela só
 * serve para iniciar a conexão e expira em dez minutos; a sessão em si dura
 * até a OpenAI encerrá-la (cerca de uma hora).
 */
async function createOpenAiSession() {
  const key = openaiKey()
  if (!key) {
    const err = new Error(
      'Falta a chave da OpenAI. Coloque OPENAI_API_KEY=... no arquivo .env.local ' +
        'e reinicie com npm start.',
    )
    err.status = 503
    throw err
  }
  const upstream = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      expires_after: { anchor: 'created_at', seconds: 600 },
      session: sessionConfig(),
    }),
  })
  const text = await upstream.text()
  if (!upstream.ok) {
    let detail = text
    try {
      detail = JSON.parse(text)?.error?.message ?? text
    } catch {
      /* resposta não era JSON */
    }
    const err = new Error(`A OpenAI recusou a sessão de voz (${upstream.status}): ${detail}`)
    err.status = upstream.status === 401 ? 401 : 502
    throw err
  }
  const data = JSON.parse(text)
  return { provider: 'openai', value: data.value, expires_at: data.expires_at, model: REALTIME_MODEL }
}

// ---------------------------------------------------------------------------
// Gemini Live
// ---------------------------------------------------------------------------

/** O esquema do Gemini é um subconjunto do OpenAPI, com tipos em maiúsculas. */
function toGeminiSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema
  const out = {}
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'type') out.type = String(v).toUpperCase()
    else if (k === 'properties') {
      out.properties = Object.fromEntries(
        Object.entries(v).map(([name, sub]) => [name, toGeminiSchema(sub)]),
      )
    } else if (k === 'items') out.items = toGeminiSchema(v)
    else out[k] = v
  }
  return out
}

function geminiTools() {
  return [
    {
      functionDeclarations: tools.map((t) => {
        const decl = { name: t.name, description: t.description }
        // Uma função sem parâmetros vai sem o campo: um objeto vazio é recusado.
        if (Object.keys(t.parameters?.properties ?? {}).length) {
          decl.parameters = toGeminiSchema(t.parameters)
        }
        return decl
      }),
    },
  ]
}

/** A mensagem de configuração que o navegador manda ao abrir o WebSocket. */
function geminiSetup() {
  return {
    model: `models/${GEMINI_MODEL}`,
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_VOICE } } },
    },
    systemInstruction: { parts: [{ text: instructions() }] },
    tools: geminiTools(),
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    realtimeInputConfig: {
      automaticActivityDetection: {
        disabled: false,
        endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
        prefixPaddingMs: 200,
        silenceDurationMs: SILENCE_MS,
      },
    },
    // Sem compressão, uma sessão só de áudio acaba em cerca de quinze minutos.
    contextWindowCompression: { slidingWindow: {} },
    // A conexão cai a cada poucos minutos por desenho; o identificador de
    // retomada deixa o navegador reconectar sem perder a conversa.
    sessionResumption: {},
  }
}

async function createGeminiSession() {
  const key = geminiKey()
  if (!key) {
    const err = new Error(
      'Falta a chave do Gemini. Crie em aistudio.google.com/apikey, coloque ' +
        'GEMINI_API_KEY=... no arquivo .env.local e reinicie com npm start.',
    )
    err.status = 503
    throw err
  }
  const now = Date.now()
  const upstream = await fetch(GEMINI_TOKEN_URL, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({
      uses: 1,
      expireTime: new Date(now + 30 * 60_000).toISOString(),
      newSessionExpireTime: new Date(now + 2 * 60_000).toISOString(),
      // Sem travar modelo e configuração no token: o navegador manda a
      // configuração completa ao abrir a conexão (ela vem desta ponte).
    }),
  })
  const text = await upstream.text()
  if (!upstream.ok) {
    let detail = text
    try {
      detail = JSON.parse(text)?.error?.message ?? text
    } catch {
      /* resposta não era JSON */
    }
    const err = new Error(`O Google recusou a sessão de voz (${upstream.status}): ${detail}`)
    err.status = upstream.status === 401 || upstream.status === 403 ? 401 : 502
    throw err
  }
  const data = JSON.parse(text)
  return { provider: 'gemini', token: data.name, model: GEMINI_MODEL, setup: geminiSetup() }
}

/** Emite a credencial temporária do provedor escolhido. */
export function createRealtimeSession() {
  return voiceProvider() === 'gemini' ? createGeminiSession() : createOpenAiSession()
}
