/**
 * O lado do A.P.O.L.O. na conversa com o H.E.R.M.E.S. (docs/adr/0019 e 0025).
 *
 * O H.E.R.M.E.S. é um serviço à parte: confere o token do celular e repassa cada
 * conversa para cá, em `/hermes`, com um token só dele. O que o celular pode pedir
 * é decidido aqui, e não lá: o relé não precisa ser confiável para isso valer.
 *
 * Sem APOLO_HERMES_TOKEN, os dois lados derivam o mesmo token do token do celular
 * (APOLO_GATEWAY_TOKEN), como em hermes/src/rele.mjs. É o que mantém um
 * pareamento antigo funcionando sem passo novo.
 *
 * Arquivo sensível (bridge/autodev/politica.mjs): só muda por revisão humana.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export const CAMINHO_DO_HERMES = '/hermes'
export const CAMINHO_DA_MIDIA = '/hermes/midia'
/** As rotas que os popups do celular leem. Tudo leitura. */
export const ROTAS_DE_MIDIA = /^\/(img|media|file|page)\?/

/**
 * O celular conversa, pede a credencial da voz e manda medições, que só viram
 * linhas de log (bridge/telemetria.mjs). `extensao` só chega a uma extensão
 * registrada, e hoje não há nenhuma (bridge/extensoes.mjs). Autodev, preferências,
 * a F.Ê.N.I.X. e o resto continuam só no PC.
 */
export const MENSAGENS_DO_CELULAR = new Set(['ask', 'interrupt', 'voz_sessao', 'telemetria', 'extensao'])

export const TOKEN_MINIMO = 32

export function tokenDoHermes(env = process.env) {
  const proprio = env.APOLO_HERMES_TOKEN?.trim()
  if (proprio) return proprio.length >= TOKEN_MINIMO ? proprio : null
  const doCelular = env.APOLO_GATEWAY_TOKEN?.trim()
  return doCelular ? createHmac('sha256', doCelular).update('hermes.apolo').digest('base64url') : null
}

const resumo = (texto) => createHash('sha256').update(String(texto)).digest()

export function hermesAutorizado(cabecalho, token) {
  if (typeof cabecalho !== 'string' || !token) return false
  const [esquema, recebido] = cabecalho.split(' ')
  if (esquema !== 'Bearer' || !recebido) return false
  return timingSafeEqual(resumo(recebido), resumo(token))
}

/** O endereço público da mídia, que o H.E.R.M.E.S. informa para reescrever links. */
export const basePublicaValida = (base) =>
  typeof base === 'string' && base.length < 500 && /^https?:\/\/[\w.-]+(:\d+)?(\/[\w.~-]+)*$/.test(base)
