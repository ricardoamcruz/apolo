/**
 * O relé do H.E.R.M.E.S.: cada conversa do celular vira uma conexão própria com o
 * assistente, em `/hermes`, autenticada por outro token (docs/adr/0025).
 *
 * O H.E.R.M.E.S. não entende a conversa: repassa os quadros como chegam, nos dois
 * sentidos. Quem decide o que o celular pode pedir é o assistente, do outro lado.
 * Por isso o celular pode estar numa rede, o H.E.R.M.E.S. noutra máquina e o
 * assistente numa terceira.
 */
import { createHmac } from 'node:crypto'
import { request as requestHttp } from 'node:http'
import { request as requestHttps } from 'node:https'
import { WebSocket } from 'ws'
import { PING } from './gateway.mjs'

export const CAMINHO_NO_ASSISTENTE = '/hermes'
const FILA_MAX = 50
/** O que não atravessa um proxy: é da conexão, não da resposta. */
const SALTO_A_SALTO = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection'])

/**
 * Sem HERMES_APOLO_TOKEN, os dois lados derivam o mesmo do token do celular. É o
 * que deixa um pareamento antigo funcionando sem passo novo.
 */
export const tokenDerivado = (tokenDoCelular) =>
  createHmac('sha256', tokenDoCelular).update('hermes.apolo').digest('base64url')

/**
 * @param apolo   endereço do assistente, como wss://localhost:8787
 * @param token   o token que o assistente espera em /hermes
 * @param ca      a autoridade que assina o certificado do assistente
 */
export function criarRele({ apolo, token, ca, log = console.log }) {
  const base = new URL(apolo)
  const canal = new URL(CAMINHO_NO_ASSISTENTE, base)
  const http = new URL(base)
  http.protocol = base.protocol === 'wss:' ? 'https:' : 'http:'
  const autorizacao = { Authorization: `Bearer ${token}` }

  function atender(celular) {
    const fila = []
    const assistente = new WebSocket(canal, { headers: autorizacao, ca: ca ?? undefined })
    // O ping do app só volta se o assistente estiver de pé (gateway.mjs).
    celular.pronto = () => assistente.readyState === WebSocket.OPEN

    assistente.on('open', () => {
      for (const [dado, binario] of fila.splice(0)) assistente.send(dado, { binary: binario })
    })
    assistente.on('message', (dado, binario) => {
      if (celular.readyState === WebSocket.OPEN) celular.send(dado, { binary: binario })
    })
    assistente.on('unexpected-response', (_req, res) => {
      log(`[hermes] o assistente recusou o relé (${res.statusCode})`)
      // Com este ouvinte, o ws não aborta sozinho: sem isto, o celular ficaria preso.
      assistente.terminate()
    })
    assistente.on('error', (err) => log(`[hermes] assistente: ${err.message}`))
    assistente.on('close', () => {
      // 1013: tente mais tarde. O app reconecta sozinho.
      if (celular.readyState === WebSocket.OPEN) celular.close(1013, 'assistente fora do ar')
    })

    celular.on('message', (dado, binario) => {
      if (!binario && dado.toString() === PING) return
      if (assistente.readyState === WebSocket.OPEN) assistente.send(dado, { binary: binario })
      else if (assistente.readyState === WebSocket.CONNECTING && fila.length < FILA_MAX) fila.push([dado, binario])
    })
    celular.on('close', () => {
      if (assistente.readyState === WebSocket.CONNECTING) assistente.terminate()
      else assistente.close()
    })
  }

  /** Repassa um GET de mídia, dizendo ao assistente o endereço público dela. */
  function servirMidia(req, res, publica) {
    const destino = new URL(`${CAMINHO_NO_ASSISTENTE}/midia${req.url}`, http)
    const pedir = destino.protocol === 'https:' ? requestHttps : requestHttp
    const cabecalhos = { ...autorizacao, 'x-hermes-base': publica }
    for (const nome of ['accept', 'range', 'if-none-match', 'if-modified-since']) {
      if (req.headers[nome]) cabecalhos[nome] = req.headers[nome]
    }
    const pedido = pedir(destino, { method: 'GET', headers: cabecalhos, ca: ca ?? undefined, timeout: 30_000 }, (resposta) => {
      const volta = Object.fromEntries(
        Object.entries(resposta.headers).filter(([nome]) => !SALTO_A_SALTO.has(nome)),
      )
      res.writeHead(resposta.statusCode ?? 502, volta)
      resposta.pipe(res)
    })
    pedido.on('timeout', () => pedido.destroy(new Error('sem resposta do assistente')))
    pedido.on('error', (err) => {
      log(`[hermes] mídia: ${err.message}`)
      if (!res.headersSent) res.writeHead(502)
      res.end()
    })
    req.on('close', () => pedido.destroy())
    pedido.end()
  }

  return { atender, servirMidia }
}
