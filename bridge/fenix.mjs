/**
 * O A.P.O.L.O. como cliente da F.Ê.N.I.X. (docs/adr/0025).
 *
 * A Fênix é um serviço à parte, que pode estar nesta máquina ou noutra: o
 * endereço e o token chegam por FENIX_URL e FENIX_TOKEN, que ela mesma passa a
 * quem sobe. Sem eles, a ponte roda sozinha (`npm run bridge`), sem troca de
 * versão nem rotinas.
 *
 * Pedido leva `id`; a resposta volta com `resposta: id`. O resto (o resultado de
 * uma troca, o estado dos serviços) chega em `aoReceber`.
 *
 * Arquivo sensível (bridge/autodev/politica.mjs): só muda por revisão humana.
 */
import { randomUUID } from 'node:crypto'
import { WebSocket } from 'ws'

const ESPERA_MAX_MS = 10_000

/**
 * @param aoReceber  mensagens que não são resposta de um pedido
 * @param aoMudar    true ao conectar, false ao cair
 */
export function criarClienteFenix({ url, token, ca, aoReceber = () => {}, aoMudar = () => {}, log = console.log }) {
  if (!url || !token) return null
  let ws = null
  let aberto = false
  let fechado = false
  let espera = 500
  const fila = []
  const pendentes = new Map()

  function conectar() {
    ws = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` }, ca })
    ws.on('open', () => {
      aberto = true
      espera = 500
      for (const texto of fila.splice(0)) ws.send(texto)
      aoMudar(true)
    })
    ws.on('message', (bruto) => {
      let msg
      try {
        msg = JSON.parse(bruto.toString())
      } catch {
        return
      }
      const pendente = msg.resposta !== undefined && pendentes.get(msg.resposta)
      if (pendente) {
        pendentes.delete(msg.resposta)
        clearTimeout(pendente.timer)
        // Quem pediu recebe só o conteúdo: o tipo e o id são do canal com a Fênix.
        const { type: _tipo, resposta: _id, ...conteudo } = msg
        return pendente.resolve(conteudo)
      }
      aoReceber(msg)
    })
    ws.on('unexpected-response', (_req, res) => {
      log(`[apolo] a F.Ê.N.I.X. recusou a conexão (${res.statusCode})`)
      // Com este ouvinte, o ws não aborta sozinho; abortar leva ao 'close' e à nova tentativa.
      ws.terminate()
    })
    ws.on('error', () => {})
    ws.on('close', () => {
      const estava = aberto
      aberto = false
      if (estava) aoMudar(false)
      if (fechado) return
      setTimeout(conectar, espera).unref()
      espera = Math.min(espera * 2, ESPERA_MAX_MS)
    })
  }
  conectar()

  const enviar = (msg) => {
    const texto = JSON.stringify(msg)
    if (aberto) ws.send(texto)
    else if (fila.length < 50) fila.push(texto)
  }

  return {
    conectado: () => aberto,
    enviar,
    /** Um pedido com resposta. Nunca rejeita: sem resposta no prazo, volta `ok: false`. */
    pedir(msg, prazoMs = 15_000) {
      const id = randomUUID()
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pendentes.delete(id)
          resolve({ ok: false, mensagem: 'A Fênix não respondeu a tempo.' })
        }, prazoMs)
        timer.unref?.()
        pendentes.set(id, { resolve, timer })
        enviar({ ...msg, id })
      })
    },
    fechar() {
      fechado = true
      ws?.close()
    },
  }
}
