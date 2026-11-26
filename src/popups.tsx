import { createRoot } from 'react-dom/client'
import { useStore, type Blade, type Panel } from './store'
import { Panels } from './ui/Panels'
import { Blades, BladeTray } from './ui/Blades'
import { comandarPopup } from './lib/comandosDePopup'
import { INTERVALO_DOS_POPUPS_MS, PREFIXO_DO_BOM_DIA } from './lib/bomDia'
import { criarVozDoCelular } from './lib/voz/celular'
import './index.css'
import './popups.css'

/**
 * Os popups do HUD, sem o HUD: os mesmos componentes e o mesmo estado, numa
 * WebView transparente do app do iPhone (docs/adr/0019). Quem fala com o agente é
 * o app, e ele entrega aqui o que chegar. A voz também mora aqui: o cliente do
 * browser precisa de um navegador, e esta página é um.
 */
declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (dados: string) => void }
    apoloPopups: {
      painel: (painel: Panel) => void
      popup: (popup: Blade) => void
      novoPedido: () => void
    }
    apoloVoz: ReturnType<typeof criarVozDoCelular>
  }
}

window.apoloPopups = {
  painel: (painel) => useStore.getState().pushPanel(painel),
  popup: (popup) => useStore.getState().pushBlade(popup),
  novoPedido: () => {
    const { clearPanels, clearBlades } = useStore.getState()
    clearPanels()
    clearBlades()
  },
}

window.apoloVoz = criarVozDoCelular(
  (mensagem) => window.ReactNativeWebView?.postMessage(JSON.stringify(mensagem)),
  () => {
    const s = useStore.getState()
    const abertos = s.panels.length + s.blades.length
    s.clearScreen('panels')
    return abertos
  },
  comandarPopup,
  {
    // A diagonal do bom dia, um popup de cada vez, como na web (docs/adr/0037).
    abrir: (popups) => {
      const s = useStore.getState()
      for (const b of s.blades) if (b.id.startsWith(PREFIXO_DO_BOM_DIA)) s.closeBlade(b.id)
      popups.forEach((b, i) => setTimeout(() => useStore.getState().pushBlade(b), i * INTERVALO_DOS_POPUPS_MS))
    },
    minimizar: () => {
      const s = useStore.getState()
      if (s.blades.some((b) => b.id.startsWith(PREFIXO_DO_BOM_DIA) && !b.minimized)) s.minimizeBlades()
    },
  },
)

// O toque precisa nascer aqui: só um gesto dentro da página destrava o áudio no iOS.
window.addEventListener('pointerup', ({ target }) => {
  const emPopup = target instanceof Element && target.closest('.bl, .panel, .bl-tray')
  if (!emPopup) window.apoloVoz.tocar()
})

createRoot(document.getElementById('root')!).render(
  <div className="hud">
    <Panels />
    <Blades />
    <BladeTray />
  </div>,
)
