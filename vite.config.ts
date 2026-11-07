import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { garantirCertificado } from './bridge/tls.mjs'

/** Só quem serve precisa do certificado: o build não abre conexão nenhuma. */
function credenciais() {
  const { cert, key } = garantirCertificado()
  return { cert, key }
}

// https://vite.dev/config/
export default defineConfig(({ command }) => {
  const https = command === 'serve' ? credenciais() : undefined
  return {
    plugins: [react()],
    preview: { https },
    server: {
      https,
      // Respeita PORT para rodar uma segunda instância ao lado. A ponte só aceita
      // conexões de localhost:5173-5199; fique nessa faixa ou ajuste
      // JARVIS_ALLOWED_ORIGINS.
      port: Number(process.env.PORT) || 5173,
    },
  }
})
