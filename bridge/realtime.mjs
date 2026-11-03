/**
 * Sessão de voz em tempo real (speech-to-speech) — ver docs/adr/0009.
 *
 * A conversa não passa mais por três modelos em fila (reconhecimento de fala →
 * LLM → síntese de voz). Um único modelo da OpenAI, da linha Realtime, ouve o
 * áudio, pensa e responde em áudio, tudo na mesma conexão WebRTC que o
 * navegador abre direto com a OpenAI. Isso é o que derruba a latência.
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

const env = (name, fallback) => {
  const v = process.env[name]?.trim()
  return v ? v : fallback
}

export const realtimeKey = () => env('OPENAI_API_KEY', null)

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
- olhar_camera: quando a resposta depende de ver a pessoa ou o ambiente agora
  ("o que estou segurando?", "como estou?"). Nunca use sem ser pedido: a luz da
  câmera acende.
- ajustar_interface: mudar a cor da interface, disparar um efeito, limpar a tela
  ou restaurar o padrão, quando a pessoa pedir.
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
        limpar_tela: { type: 'boolean', description: 'Fecha painéis e limpa o histórico.' },
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
export async function createRealtimeSession() {
  const key = realtimeKey()
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
  return { value: data.value, expires_at: data.expires_at, model: REALTIME_MODEL }
}
