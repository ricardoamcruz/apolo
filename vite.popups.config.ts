import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Os popups do app do iPhone (docs/adr/0019): uma página à parte, sem a cena, a
 * voz e a câmera. `scripts/popups.mjs` junta o resultado num arquivo só para o app.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist-popups',
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: 'popups.html',
      output: { codeSplitting: false },
    },
  },
})
