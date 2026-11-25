/**
 * O A.P.O.L.O. pedindo o bom dia à A.U.R.O.R.A. (modules/aurora, docs/adr/0026).
 *
 * A A.U.R.O.R.A. é um serviço à parte, nesta máquina ou noutra: o endereço vem de
 * APOLO_AURORA_URL e o token de APOLO_AURORA_TOKEN. Daqui só sai um GET.
 *
 * O mesmo resumo serve ao PC e ao celular; o do celular passa por `semAMusica`
 * (docs/adr/0037), porque lá não há tocador.
 */
import { request } from 'node:https'
import { request as requestHttp } from 'node:http'

/**
 * O bom dia como o celular recebe (docs/adr/0037): sem a faixa de rock, porque o
 * tocador do YouTube é só do PC. A linha "Tocando: ..." sai do texto narrado, e o
 * motivo de a música não ter vindo também: no celular o silêncio é o esperado, e
 * relatá-lo seria anunciar uma falha que não existe ali.
 */
export function semAMusica(resumo) {
  const texto = typeof resumo.texto === 'string' ? resumo.texto.split('\n').filter((l) => !/^Tocando:/.test(l)).join('\n') : resumo.texto
  return { ...resumo, texto, musica: null, avisoDaMusica: null }
}

export function criarClienteAurora({ url = 'https://localhost:8791', token, ca }) {
  if (!token) return null
  const base = new URL(url)
  return {
    /** { ok, musica?, texto?, mensagem? }. Nunca rejeita. */
    bomDia: () =>
      new Promise((resolve) => {
        const alvo = new URL('/bom-dia', base)
        const pedir = alvo.protocol === 'https:' ? request : requestHttp
        const pedido = pedir(alvo, { headers: { authorization: `Bearer ${token}` }, ca, timeout: 25_000 }, (r) => {
          let corpo = ''
          r.setEncoding('utf8')
          r.on('data', (p) => (corpo += p))
          r.on('end', () => {
            try {
              const dados = JSON.parse(corpo)
              resolve(r.statusCode === 200 ? dados : { ok: false, mensagem: dados.mensagem ?? `a Aurora respondeu ${r.statusCode}` })
            } catch {
              resolve({ ok: false, mensagem: `a Aurora respondeu ${r.statusCode}` })
            }
          })
        })
        pedido.on('timeout', () => pedido.destroy(new Error('a Aurora não respondeu a tempo')))
        pedido.on('error', (err) =>
          resolve({ ok: false, mensagem: err.code === 'ECONNREFUSED' ? 'a Aurora não está no ar' : err.message }),
        )
        pedido.end()
      }),
  }
}
