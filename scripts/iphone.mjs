/**
 * Compila o app do iPhone em Release e instala no aparelho (docs/06-ambiente-mobile.md).
 * É a rotina `app_iphone` da F.Ê.N.I.X.; também roda à mão: `node scripts/iphone.mjs`.
 *
 * O aparelho vem de APOLO_IPHONE_ID no .env.local ou, sem ele, é o primeiro iPhone
 * que o `devicectl` enxerga. Se mudou o app.json, rode antes o prebuild e o
 * pod install, que são raros e demoram: esta rotina não faz isso sozinha.
 *
 * Instalar exige o iPhone ao alcance do Xcode: pelo cabo, ou na mesma rede Wi-Fi do
 * Mac com "Connect via network" ligado. O Tailscale não serve para isso.
 *
 * Toda falha termina numa linha que começa com "✖", em palavras: é ela que a Fênix
 * manda no aviso. A saída do xcodebuild e do devicectl fica no log da rotina.
 */
import '../bridge/env.mjs'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const IOS = 'apps/mobile/ios'
const passo = (texto) => console.log(`\n» ${texto}`)
const LONGE = 'Ligue o iPhone pelo cabo ou fique na mesma rede Wi-Fi do Mac, com ele desbloqueado, e rode de novo.'

/** Encerra com a explicação para gente; o detalhe técnico já saiu acima, para o log. */
function falhar(mensagem) {
  console.error(`\n✖ ${mensagem}`)
  process.exit(1)
}

/** Roda um passo; se falhar, a mensagem é a de `seFalhar`, e não o rastro do Node. */
function rodar(comando, args, { seFalhar, ...opcoes } = {}) {
  try {
    execFileSync(comando, args, { stdio: 'inherit', ...opcoes })
  } catch (err) {
    console.error(`(${comando} terminou com ${err.status ?? err.signal ?? err.code})`)
    falhar(seFalhar)
  }
}

function acharAparelho() {
  const fixo = process.env.APOLO_IPHONE_ID?.trim()
  if (fixo) return fixo
  const pasta = mkdtempSync(join(tmpdir(), 'apolo-devicectl-'))
  try {
    const arquivo = join(pasta, 'aparelhos.json')
    execFileSync('xcrun', ['devicectl', 'list', 'devices', '--json-output', arquivo], { stdio: 'ignore' })
    const aparelhos = JSON.parse(readFileSync(arquivo, 'utf8')).result?.devices ?? []
    const iphones = aparelhos.filter((a) => a.hardwareProperties?.platform === 'iOS')
    const ligado = iphones.find((a) => a.connectionProperties?.tunnelState === 'connected') ?? iphones[0]
    return ligado?.identifier ?? null
  } catch {
    return null
  } finally {
    rmSync(pasta, { recursive: true, force: true })
  }
}

function acharApp() {
  const base = join(homedir(), 'Library/Developer/Xcode/DerivedData')
  const candidatos = readdirSync(base)
    .filter((p) => p.startsWith('APOLO-'))
    .map((p) => join(base, p, 'Build/Products/Release-iphoneos/APOLO.app'))
    .filter((p) => {
      try {
        return statSync(p).isDirectory()
      } catch {
        return false
      }
    })
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  return candidatos[0] ?? null
}

const aparelho = acharAparelho()
if (!aparelho) falhar(`Nenhum iPhone encontrado. ${LONGE}`)

passo('compilando os popups da web')
rodar(process.execPath, ['scripts/popups.mjs'], { seFalhar: 'A compilação dos popups da web falhou. Nada foi instalado.' })

passo('compilando o app em Release (leva alguns minutos)')
rodar(
  'xcodebuild',
  [
    '-workspace', 'APOLO.xcworkspace', '-scheme', 'APOLO', '-configuration', 'Release',
    '-destination', 'generic/platform=iOS', '-allowProvisioningUpdates', '-quiet', 'build',
  ],
  { cwd: IOS, seFalhar: 'A compilação do app falhou. Nada foi instalado.' },
)

const app = acharApp()
if (!app) falhar('O app compilou, mas não achei o APOLO.app para instalar.')

passo('instalando no iPhone')
rodar('xcrun', ['devicectl', 'device', 'install', 'app', '--device', aparelho, app], {
  seFalhar: `O app compilou, mas o iPhone não estava ao alcance para instalar. ${LONGE}`,
})
console.log('\nApp instalado. Abra o A.P.O.L.O. no iPhone.')
