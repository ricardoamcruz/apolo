/**
 * A F.Ê.N.I.X. avisando o Ricardo por uma central de notificações (no A.P.O.L.O.,
 * o H.E.R.M.E.S., docs/adr/0027). A Fênix não sabe quem é a central: só o
 * endereço e o token do fenix.config.json ("notificacoes"), e o protocolo:
 *
 *   → { type: 'notificar', id, titulo, texto, prioridade, botoes: [{ rotulo, acao }] }
 *   ← { type: 'notificar:resposta', resposta: id, ok, mac, ntfy }  o que a central fez
 *   ← { type: 'notificacao:acao', notificacao, acao }   quando ele toca num botão
 *
 * Aviso é mensagem para gente (docs/adr/0029): nunca rastro de erro, código ou
 * saída de comando. Isso fica no log da Fênix; `textoDoAviso` é a última barreira.
 *
 * Sem central configurada ou fora do ar, os avisos esperam numa fila curta e a
 * Fênix segue normalmente: um aviso nunca atrapalha a guarda. `avisar` devolve
 * uma promessa com o que a central respondeu, para quem quiser saber (a linha de
 * comando, `fenix avisar`); quem não quer saber só ignora.
 */
import { randomBytes } from 'node:crypto'
import { WebSocket } from 'ws'

const FILA_MAX = 20

const PRAZO_DA_RESPOSTA_MS = 10_000
const TEXTO_MAX = 300

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
  if (!juntas) return 'Os detalhes ficaram no log da Fênix.'
  return juntas.length > TEXTO_MAX ? `${juntas.slice(0, TEXTO_MAX - 1)}…` : juntas
}

/**
 * A explicação que uma rotina deixou para gente: a última linha que começa com
 * "✖". Sem ela, nada: quem avisa usa uma frase própria.
 */
export function explicacaoDaRotina(saida) {
  const linhas = String(saida ?? '').split('\n').map((l) => l.trim())
  const marcada = linhas.reverse().find((l) => l.startsWith('✖'))
  return marcada ? marcada.replace(/^✖\s*/, '') || null : null
}

export function criarAvisos({ url, token, ca, aoTocar = () => {}, log = console.log }) {
  if (!url || !token) {
    const semCentral = { ok: false, mensagem: 'não há central de notificações configurada (notificacoes no fenix.config.json)' }
    return { avisar: () => Promise.resolve(semCentral), fechar: () => {}, conectada: () => false }
  }
  const pendentes = new Map()
  let ws = null
  let aberto = false
  let fechado = false
  let espera = 1000
  const fila = []

  function conectar() {
    ws = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` }, ca: ca ?? undefined })
    ws.on('open', () => {
      aberto = true
      espera = 1000
      for (const m of fila.splice(0)) ws.send(m)
    })
    ws.on('message', (bruto) => {
      try {
        const msg = JSON.parse(bruto.toString())
        if (msg.type === 'notificacao:acao') aoTocar(msg.acao, msg.notificacao)
        if (msg.type === 'notificar:resposta' && pendentes.has(msg.resposta)) {
          const { resolve, timer } = pendentes.get(msg.resposta)
          pendentes.delete(msg.resposta)
          clearTimeout(timer)
          const { type: _t, resposta: _r, ...r } = msg
          resolve(r)
        }
      } catch {
        /* ignora o que não entende */
      }
    })
    ws.on('unexpected-response', (_q, res) => {
      log(`[fenix] a central de notificações recusou a conexão (${res.statusCode})`)
      ws.terminate()
    })
    ws.on('error', () => {})
    ws.on('close', () => {
      aberto = false
      if (fechado) return
      setTimeout(conectar, espera).unref()
      espera = Math.min(espera * 2, 30_000)
    })
  }
  conectar()

  return {
    avisar({ titulo, texto, prioridade = 'normal', botoes = [] }) {
      const id = randomBytes(6).toString('hex')
      const m = JSON.stringify({
        type: 'notificar',
        id,
        titulo: textoDoAviso(titulo).slice(0, 120),
        texto: textoDoAviso(texto),
        prioridade,
        botoes,
      })
      if (!aberto) {
        fila.push(m)
        if (fila.length > FILA_MAX) fila.shift()
        return Promise.resolve({ ok: false, naFila: true, mensagem: 'a central de notificações está fora do ar; o aviso ficou na fila' })
      }
      ws.send(m)
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pendentes.delete(id)
          resolve({ ok: false, mensagem: 'a central de notificações não respondeu a tempo' })
        }, PRAZO_DA_RESPOSTA_MS)
        timer.unref?.()
        pendentes.set(id, { resolve, timer })
      })
    },
    conectada: () => aberto,
    fechar() {
      fechado = true
      ws?.close()
    },
  }
}
