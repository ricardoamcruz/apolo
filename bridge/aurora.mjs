/**
 * O A.P.O.L.O. pedindo o bom dia à A.U.R.O.R.A. (modules/aurora, docs/adr/0026).
 *
 * A A.U.R.O.R.A. é um serviço à parte, nesta máquina ou noutra: o endereço vem de
 * APOLO_AURORA_URL e o token de APOLO_AURORA_TOKEN. Daqui saem o bom dia (GET) e os
 * temas de notícia, que o Ricardo muda por voz (GET e POST em /noticias,
 * docs/adr/0039): a ponte só repassa o pedido; quem guarda a escolha é ela.
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

/** Os temas como a voz os conta: nomes, quantas notícias por tema e nada de buscas. */
export function textoDosTemas({ temas, porTema, padrao }) {
  const nomes = (temas ?? []).map((t) => t.nome).filter(Boolean)
  if (!nomes.length) return 'Não há nenhum tema de notícia no bom dia agora.'
  const n = porTema ?? 3
  return (
    `Temas do bom dia: ${nomes.join(', ')}; ${n} notícia${n === 1 ? '' : 's'} por tema` +
    `${padrao === false ? ' (escolha dele)' : ''}.`
  )
}

export function criarClienteAurora({ url = 'https://localhost:8791', token, ca }) {
  if (!token) return null
  const base = new URL(url)

  /** { ok, ... } sempre: um erro de rede vira mensagem. Nunca rejeita. */
  const pedir = (caminho, { metodo = 'GET', corpo, prazoMs = 25_000 } = {}) =>
    new Promise((resolve) => {
      const alvo = new URL(caminho, base)
      const requisitar = alvo.protocol === 'https:' ? request : requestHttp
      const texto = corpo === undefined ? null : JSON.stringify(corpo)
      const pedido = requisitar(
        alvo,
        {
          method: metodo,
          headers: {
            authorization: `Bearer ${token}`,
            ...(texto !== null && { 'content-type': 'application/json', 'content-length': Buffer.byteLength(texto) }),
          },
          ca,
          timeout: prazoMs,
        },
        (r) => {
          let resposta = ''
          r.setEncoding('utf8')
          r.on('data', (p) => (resposta += p))
          r.on('end', () => {
            try {
              const dados = JSON.parse(resposta)
              resolve(r.statusCode === 200 ? dados : { ok: false, mensagem: dados.mensagem ?? `a Aurora respondeu ${r.statusCode}` })
            } catch {
              resolve({ ok: false, mensagem: `a Aurora respondeu ${r.statusCode}` })
            }
          })
        },
      )
      pedido.on('timeout', () => pedido.destroy(new Error('a Aurora não respondeu a tempo')))
      pedido.on('error', (err) =>
        resolve({ ok: false, mensagem: err.code === 'ECONNREFUSED' ? 'a Aurora não está no ar' : err.message }),
      )
      pedido.end(texto ?? undefined)
    })

  return {
    /** { ok, musica?, texto?, mensagem? }. Nunca rejeita. */
    bomDia: () => pedir('/bom-dia'),
    /** Os temas de notícia de hoje: { ok, temas, porTema, padrao }. */
    temas: () => pedir('/noticias', { prazoMs: 10_000 }),
    /** Tirar, incluir, mudar quantas por tema ou voltar ao padrão: { ok, mensagem, temas }. */
    editarTemas: (patch) => pedir('/noticias', { metodo: 'POST', corpo: patch, prazoMs: 10_000 }),
  }
}
