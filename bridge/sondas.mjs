/**
 * A ponte medindo a saúde dos serviços à parte por conta própria (docs/adr/0029).
 *
 * O H.E.R.M.E.S. e a A.U.R.O.R.A. respondem `GET /saude`: é esse o contrato, e
 * não o estado que a F.Ê.N.I.X. conta sobre eles. Assim, com a Fênix fora do ar,
 * a aba SISTEMAS continua sabendo quem está de pé, e o bom dia continua chegando.
 * O que a Fênix conta (subindo, caiu) só completa o quadro quando ela está aqui.
 *
 * Daqui só sai um GET, sem token, para endereços do .env.local.
 */
import { request } from 'node:https'
import { request as requestHttp } from 'node:http'

/** `{ ok, motivo? }`. Nunca rejeita. */
export function sondar(url, { ca, prazoMs = 3000 } = {}) {
  return new Promise((resolve) => {
    let alvo
    try {
      alvo = new URL(url)
    } catch {
      return resolve({ ok: false, motivo: `endereço inválido: ${url}` })
    }
    const pedir = alvo.protocol === 'https:' ? request : requestHttp
    const pedido = pedir(alvo, { ca, timeout: prazoMs }, (r) => {
      let corpo = ''
      r.setEncoding('utf8')
      r.on('data', (p) => (corpo += p))
      r.on('end', () => {
        let dados = null
        try {
          dados = JSON.parse(corpo)
        } catch {
          /* sem JSON, vale o status */
        }
        const ok = r.statusCode === 200 && dados?.ok !== false
        resolve(ok ? { ok: true, dados } : { ok: false, motivo: `respondeu ${r.statusCode}` })
      })
    })
    pedido.on('timeout', () => pedido.destroy(new Error('não respondeu a tempo')))
    pedido.on('error', (err) => resolve({ ok: false, motivo: err.code === 'ECONNREFUSED' ? 'não está no ar' : err.message }))
    pedido.end()
  })
}

/**
 * @param alvos    `[{ nome, url }]`: só os serviços configurados neste .env.local
 * @param aoMudar  chamado quando algum estado muda
 * @returns null sem alvos; senão `{ estado(nome), motivo(nome), checar(), parar() }`,
 *          com estado 'connected', 'failed' ou null (ainda não medido)
 */
export function criarSondas({ alvos, ca, intervaloMs = 15_000, prazoMs = 3000, aoMudar = () => {}, sondarUrl = sondar }) {
  const lista = alvos.filter((a) => a?.nome && a?.url)
  if (!lista.length) return null
  const estados = new Map(lista.map((a) => [a.nome, { status: null, motivo: null }]))
  let parado = false

  async function checar() {
    let mudou = false
    await Promise.all(
      lista.map(async ({ nome, url }) => {
        const r = await sondarUrl(url, { ca, prazoMs })
        const e = estados.get(nome)
        const status = r.ok ? 'connected' : 'failed'
        if (e.status !== status) mudou = true
        e.status = status
        e.motivo = r.ok ? null : r.motivo
      }),
    )
    if (mudou && !parado) aoMudar()
  }

  void checar()
  const timer = setInterval(() => void checar(), intervaloMs)
  timer.unref?.()

  return {
    estado: (nome) => estados.get(nome)?.status ?? null,
    motivo: (nome) => estados.get(nome)?.motivo ?? null,
    checar,
    parar() {
      parado = true
      clearInterval(timer)
    },
  }
}
