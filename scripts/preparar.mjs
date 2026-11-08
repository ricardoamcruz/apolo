/**
 * O que o A.P.O.L.O. precisa antes de subir. A F.Ê.N.I.X. roda isto na partida
 * (fenix.config.json, "preparar"), antes dos serviços.
 *
 * 1. O certificado local (docs/adr/0021): a ponte, a interface, o H.E.R.M.E.S. e o
 *    canal da Fênix usam o mesmo, e ele precisa existir antes de qualquer um abrir
 *    a porta.
 * 2. O WebAssembly do MediaPipe dentro de public/, servido da nossa origem.
 */

// Primeiro de todos: APOLO_TLS_* do .env.local valem aqui igual à ponte.
import '../bridge/env.mjs'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { certificadoConfiavel, garantirCertificado } from '../bridge/tls.mjs'

/**
 * O rastreamento das mãos precisa de um runtime WASM, que a receita comum busca
 * num CDN. Aqui isso falha duas vezes: a CSP da página não cita CDN nenhum em
 * `script-src`, e um import de CDN é código de terceiro resolvido a cada carga.
 * Copiado de node_modules, ele sai da nossa origem e são exatamente os bytes da
 * versão do lockfile. Fica fora do Git (34 MB de build) e é copiado de novo
 * quando faltar.
 */
function copiarWasm() {
  const de = 'node_modules/@mediapipe/tasks-vision/wasm'
  const para = 'public/mediapipe'
  if (!existsSync(de)) return // os gestos são opcionais
  if (existsSync(`${para}/vision_wasm_internal.wasm`)) return
  try {
    mkdirSync(para, { recursive: true })
    cpSync(de, para, { recursive: true })
    console.log('  runtime de rastreamento das mãos copiado para public/mediapipe.')
  } catch (err) {
    console.warn(`  não foi possível copiar o runtime das mãos: ${err.message}`)
  }
}

const { caminho } = garantirCertificado()
copiarWasm()

// Sem confiança, a página até abre com um aviso, mas a conexão com a ponte falha calada.
if (certificadoConfiavel(caminho) === false) {
  console.warn('\n  O sistema ainda não confia no certificado: rode npm run https uma vez.\n')
}
