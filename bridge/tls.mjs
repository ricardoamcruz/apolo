/**
 * HTTPS entre a ponte, a interface e o gateway (docs/adr/0021).
 *
 * Em desenvolvimento não há autoridade certificadora: o A.P.O.L.O. gera um
 * certificado próprio, que não pode emitir outros (CA:FALSE) e só vale para este
 * computador. `npm run https` o marca como confiável no sistema, e só então o
 * navegador aceita a conexão com a ponte. Num servidor de verdade,
 * APOLO_TLS_CERT e APOLO_TLS_KEY apontam para um certificado real.
 *
 * Arquivo sensível (bridge/autodev/politica.mjs): só muda por revisão humana.
 */
import { execFileSync } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { request } from 'node:https'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const PASTA_TLS = process.env.APOLO_TLS_PASTA ?? join(homedir(), '.apolo', 'tls')
/** O teto que os navegadores aceitam para um certificado confiado à mão. */
const DIAS_DE_VALIDADE = 825
const MARGEM_DE_RENOVACAO_MS = 30 * 86_400_000

function gerar(cert, key) {
  try {
    execFileSync(
      'openssl',
      [
        'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
        '-keyout', key, '-out', cert, '-days', String(DIAS_DE_VALIDADE),
        '-subj', '/CN=A.P.O.L.O. local',
        '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1',
        '-addext', 'basicConstraints=critical,CA:FALSE',
        '-addext', 'keyUsage=critical,digitalSignature',
        '-addext', 'extendedKeyUsage=serverAuth',
      ],
      { stdio: 'ignore' },
    )
  } catch (err) {
    throw new Error(`não foi possível gerar o certificado local com o openssl: ${err.message}`)
  }
  chmodSync(key, 0o600)
}

const vencendo = (pem) =>
  new Date(new X509Certificate(pem).validTo).getTime() - Date.now() < MARGEM_DE_RENOVACAO_MS

/** Lê o certificado e, se for o local e faltar ou estiver vencendo, gera outro. */
export function garantirCertificado(pasta = PASTA_TLS) {
  const certProprio = process.env.APOLO_TLS_CERT?.trim()
  const chavePropria = process.env.APOLO_TLS_KEY?.trim()
  if (certProprio && chavePropria) {
    return {
      cert: readFileSync(certProprio),
      key: readFileSync(chavePropria),
      caminho: certProprio,
      novo: false,
    }
  }
  mkdirSync(pasta, { recursive: true, mode: 0o700 })
  const caminho = join(pasta, 'apolo.pem')
  const chave = join(pasta, 'apolo-chave.pem')
  let novo = !existsSync(caminho) || !existsSync(chave)
  if (!novo && vencendo(readFileSync(caminho))) {
    rmSync(caminho)
    rmSync(chave)
    novo = true
  }
  if (novo) gerar(caminho, chave)
  return { cert: readFileSync(caminho), key: readFileSync(chave), caminho, novo }
}

/** O macOS já confia neste certificado? Fora do macOS, não dá para saber daqui. */
export function certificadoConfiavel(caminho) {
  if (process.platform !== 'darwin') return null
  try {
    execFileSync('security', ['verify-cert', '-c', caminho, '-p', 'ssl', '-s', 'localhost'], {
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

/**
 * Um GET nos serviços locais, para as checagens de saúde. Confia só no nosso
 * certificado: o `fetch` do Node ignora o que for dado depois de ele iniciar.
 */
export function obterLocal(url, { prazoMs = 5000, ca = garantirCertificado().cert } = {}) {
  return new Promise((resolve, reject) => {
    const pedido = request(url, { ca, timeout: prazoMs }, (resposta) => {
      let corpo = ''
      resposta.setEncoding('utf8')
      resposta.on('data', (parte) => (corpo += parte))
      resposta.on('end', () => {
        const status = resposta.statusCode ?? 0
        resolve({
          ok: status >= 200 && status < 300,
          status,
          json: async () => JSON.parse(corpo),
        })
      })
    })
    pedido.on('timeout', () => pedido.destroy(new Error(`sem resposta de ${url}`)))
    pedido.on('error', reject)
    pedido.end()
  })
}
