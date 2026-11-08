import { createRoot } from 'react-dom/client'
import { useStore, type Blade, type Panel } from './store'
import { Panels } from './ui/Panels'
import { Blades, BladeTray } from './ui/Blades'
import { comandarPopup } from './lib/comandosDePopup'
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
