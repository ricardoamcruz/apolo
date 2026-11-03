import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Respeita PORT para rodar uma segunda instância ao lado. A ponte só aceita
    // conexões de localhost:5173-5199; fique nessa faixa ou ajuste
    // JARVIS_ALLOWED_ORIGINS.
    port: Number(process.env.PORT) || 5173,
  },
})
