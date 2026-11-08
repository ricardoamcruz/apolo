/**
 * Compila o app do iPhone em Release e instala no aparelho (docs/06-ambiente-mobile.md).
 * É a rotina `app_iphone` da F.Ê.N.I.X.; também roda à mão: `node scripts/iphone.mjs`.
 *
 * O aparelho vem de APOLO_IPHONE_ID no .env.local ou, sem ele, é o primeiro iPhone
 * que o `devicectl` enxerga. Se mudou o app.json, rode antes o prebuild e o
 * pod install, que são raros e demoram: esta rotina não faz isso sozinha.
 */
import '../bridge/env.mjs'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const IOS = 'apps/mobile/ios'
const passo = (texto) => console.log(`\n» ${texto}`)
const rodar = (comando, args, opcoes = {}) => execFileSync(comando, args, { stdio: 'inherit', ...opcoes })

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
if (!aparelho) {
  console.error('Nenhum iPhone encontrado. Conecte o aparelho ou defina APOLO_IPHONE_ID no .env.local.')
  process.exit(1)
}

passo('compilando os popups da web')
rodar(process.execPath, ['scripts/popups.mjs'])

passo('compilando o app em Release (leva alguns minutos)')
rodar(
  'xcodebuild',
  [
    '-workspace', 'APOLO.xcworkspace', '-scheme', 'APOLO', '-configuration', 'Release',
    '-destination', 'generic/platform=iOS', '-allowProvisioningUpdates', '-quiet', 'build',
  ],
  { cwd: IOS },
)

const app = acharApp()
if (!app) {
  console.error('O build terminou, mas não achei o APOLO.app no DerivedData.')
  process.exit(1)
}

passo('instalando no iPhone')
rodar('xcrun', ['devicectl', 'device', 'install', 'app', '--device', aparelho, app])
console.log('\nApp instalado. Abra o A.P.O.L.O. no iPhone.')
