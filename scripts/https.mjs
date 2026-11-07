#!/usr/bin/env node
/**
 * Prepara o HTTPS local (docs/adr/0021): gera o certificado, marca como confiável
 * no macOS e faz o Tailscale falar HTTPS com o gateway. Rode uma vez; depois,
 * reinicie o npm start. O macOS pede a sua senha para confiar no certificado.
 */
import { execFileSync } from 'node:child_process'
import process from 'node:process'
import { certificadoConfiavel, garantirCertificado } from '../bridge/tls.mjs'

const PORTA = process.env.APOLO_GATEWAY_PORT ?? '8788'
const CLI_DO_APP = '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
const { caminho, novo } = garantirCertificado()
console.log(`${novo ? 'Certificado gerado' : 'Certificado existente'} em ${caminho}`)

const confiavel = certificadoConfiavel(caminho)
if (confiavel === null) {
  console.log('Fora do macOS: marque esse arquivo como confiável no sistema ou no navegador.')
} else if (confiavel) {
  console.log('O sistema já confia nele.')
} else {
  console.log('Confirme na janela do macOS para confiar nele. Ele só vale para este computador.')
  const chaveiro = `${process.env.HOME}/Library/Keychains/login.keychain-db`
  execFileSync('security', ['add-trusted-cert', '-r', 'trustRoot', '-p', 'ssl', '-k', chaveiro, caminho], {
    stdio: 'inherit',
  })
  if (!certificadoConfiavel(caminho)) {
    console.error('O macOS não passou a confiar no certificado. Tente de novo.')
    process.exit(1)
  }
  console.log('Pronto: o sistema confia nele.')
}

for (const cli of ['tailscale', CLI_DO_APP]) {
  try {
    execFileSync(cli, ['serve', '--bg', `https+insecure://127.0.0.1:${PORTA}`], { stdio: 'inherit' })
    console.log('Tailscale agora fala HTTPS com o gateway.')
    break
  } catch {
    // Sem Tailscale aqui, ou desligado: tenta o outro caminho. O PC funciona sem ele.
  }
}
console.log('\nAgora reinicie: npm start. E abra https://localhost:5173')
