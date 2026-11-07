#!/usr/bin/env node
/**
 * Compila os popups do HUD num só arquivo HTML para o app do iPhone (ADR 0019).
 *
 * A página vai dentro do app, e não servida pelo gateway, para que o que roda no
 * aparelho seja o que foi instalado, e não o que o Mac entregar na hora.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const raiz = (caminho) => fileURLToPath(new URL(`../${caminho}`, import.meta.url))

execFileSync('npx', ['vite', 'build', '--config', 'vite.popups.config.ts', '--logLevel', 'warn'], {
  cwd: raiz('.'),
  stdio: 'inherit',
})

const arquivos = readdirSync(raiz('dist-popups/assets'))
const js = arquivos.filter((a) => a.endsWith('.js'))
const css = arquivos.filter((a) => a.endsWith('.css'))
if (js.length !== 1 || css.length !== 1) {
  throw new Error(`esperava um .js e um .css, achei: ${arquivos.join(', ')}`)
}
const ler = (arquivo) => readFileSync(raiz(`dist-popups/assets/${arquivo}`), 'utf8')

const html = readFileSync(raiz('dist-popups/popups.html'), 'utf8')
  .replace(/\s*<script[^>]*src=[^>]*><\/script>/, '')
  .replace(/\s*<link[^>]*stylesheet[^>]*>/, '')
  .replace('</head>', () => `<style>${ler(css[0])}</style></head>`)
  .replace('</body>', () => `<script type="module">${ler(js[0]).replaceAll('</script', '<\\/script')}</script></body>`)

writeFileSync(
  raiz('apps/mobile/src/popups.gerado.ts'),
  `// Gerado por npm run popups. Não edite.\nexport const PAGINA_DE_POPUPS = ${JSON.stringify(html)}\n`,
)
console.log(`Popups: ${Math.round(html.length / 1024)} KB em apps/mobile/src/popups.gerado.ts`)
