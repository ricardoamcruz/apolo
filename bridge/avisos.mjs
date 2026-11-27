/**
 * O A.P.O.L.O. avisando o Ricardo pela central do H.E.R.M.E.S. (docs/adr/0027 e
 * 0039). Antes, só a F.Ê.N.I.X. pedia notificações; agora ele também pede, para o
 * que acontece quando ninguém está olhando a tela — o trabalho do
 * autodesenvolvimento, que leva minutos e termina sozinho.
 *
 * A ponte não sabe quem é a central: só o endereço, o token e o protocolo mais
 * curto que ela oferece, um `POST /notificar` de ida (sem botões, sem conexão a
 * manter). Nada disso é essencial: um aviso que não sai vira uma linha no log e o
 * assistente segue igual.
 *
 * Aviso é mensagem para gente (docs/adr/0027): nunca rastro de erro, código ou
 * saída de comando, que ficam no log. `textoDoAviso` é a última barreira.
 */
import { request as requestHttp } from 'node:http'
import { request } from 'node:https'

const TITULO_MAX = 80
const TEXTO_MAX = 300
const PRAZO_MS = 10_000

/** Linhas que são rastro de erro, código ou saída de máquina, e não mensagem. */
const DE_MAQUINA = [
  /^\s+at\s/, // rastro de chamadas
  /node:internal|file:\/\/|\.m?js:\d+/,
  /^Node\.js v\d/,
  /^\s*[\^~]+\s*$/, // o sublinhado do Node sob a linha do erro
  /^\s*[{}[\]](,)?\s*$/,
  /^\s+\w+: .*,$/, // campos de um objeto impresso
  /^\s*(const|let|var|throw|import|export|function)\b/,
  /^\s*(Error|\w+Error)(\s*\[\w+\])?: /,
  /^(ERROR|error|fatal|warning):/i,
  /\bCommand failed:/,
]

/**
 * O texto que pode ir para o Mac e o iPhone: só as linhas de gente, no máximo
 * duas, em até 300 caracteres. Sobrando nada, uma frase que manda ao log.
 */
export function textoDoAviso(texto) {
  const linhas = String(texto ?? '')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() && !DE_MAQUINA.some((re) => re.test(l)))
    .map((l) => l.trim())
  const juntas = linhas.slice(0, 2).join(' ')
  if (!juntas) return 'Os detalhes ficaram no log.'
  return juntas.length > TEXTO_MAX ? `${juntas.slice(0, TEXTO_MAX - 1)}…` : juntas
}

/**
 * O aviso que uma mudança do autodesenvolvimento merece, ou null quando ela não
 * merece nenhum. Só o que acontece sem ele por perto: a alteração que ficou de pé
 * esperando teste, a que parou no caminho e a que foi para uma branch de revisão.
 * Aprovar, cancelar e reverter partem dele, que está ali: não se avisa de volta.
 */
export function avisoDoAutodev(antes, agora) {
  if (agora?.fase === 'testando' && antes?.fase !== 'testando') {
    return {
      titulo: 'A.P.O.L.O.: alteração em teste',
      texto: `${agora.resumo ? `${agora.resumo} ` : ''}Está no ar para você testar e dizer se aprova.`,
      prioridade: 'alta',
    }
  }
  const r = agora?.resultado
  if (!r?.tipo) return null
  const mesmo = antes?.resultado?.id === r.id && antes?.resultado?.tipo === r.tipo
  if (mesmo) return null
  if (r.tipo === 'revisao') {
    return { titulo: 'A.P.O.L.O.: trabalho para revisão', texto: r.mensagem, prioridade: 'alta' }
  }
  if (r.tipo === 'falhou') {
    return { titulo: 'A.P.O.L.O.: o trabalho não terminou', texto: r.mensagem, prioridade: 'normal' }
  }
  return null
}

/**
 * O cliente da central. Sem endereço ou sem token, `avisar` responde que não há
 * central e nada mais acontece: notificação é um extra, nunca um requisito.
 */
export function criarAvisos({ url, token, ca, log = console.log }) {
  if (!url || !token) {
    const sem = { ok: false, mensagem: 'não há central de notificações configurada (APOLO_NOTIFICAR_TOKEN)' }
    return { avisar: () => Promise.resolve(sem), configurada: () => false }
  }
  const alvo = new URL(url)
  return {
    configurada: () => true,
    /** { ok, mensagem? }. Nunca rejeita. */
    avisar({ titulo, texto, prioridade = 'normal' }) {
      const corpo = JSON.stringify({
        titulo: textoDoAviso(titulo).slice(0, TITULO_MAX),
        texto: textoDoAviso(texto),
        prioridade,
      })
      return new Promise((resolve) => {
        const pedir = alvo.protocol === 'https:' ? request : requestHttp
        const pedido = pedir(
          alvo,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'content-length': Buffer.byteLength(corpo),
              authorization: `Bearer ${token}`,
            },
            ca,
            timeout: PRAZO_MS,
          },
          (r) => {
            r.resume()
            r.on('end', () => {
              if (r.statusCode !== 200) log(`[apolo] a central de notificações respondeu ${r.statusCode}`)
              resolve({ ok: r.statusCode === 200 })
            })
          },
        )
        pedido.on('timeout', () => pedido.destroy(new Error('a central de notificações não respondeu a tempo')))
        pedido.on('error', (err) => {
          log(`[apolo] aviso não entregue: ${err.message}`)
          resolve({ ok: false, mensagem: err.message })
        })
        pedido.end(corpo)
      })
    },
  }
}
