import { useEffect, useState } from 'react'
import { accentFor, atividadeAtual, useStore } from '../store'
import { contrastante, corEmHex } from '../lib/cor'
import { sistemasAgora } from '../lib/estadoDosSistemas'

/**
 * A aba SISTEMAS. Só existe quando pedida: pela tecla D ou por voz.
 * Relê o estado a cada segundo enquanto aberta, porque a voz não avisa o store.
 */
export function Sistemas() {
  const aberta = useStore((s) => s.sistemas !== 'fechado')
  const visivel = useStore((s) => s.ui.chrome.systems)
  const phase = useStore((s) => s.phase)
  const ui = useStore((s) => s.ui)
  useStore((s) => s.connected)
  const [, tique] = useState(0)

  useEffect(() => {
    if (!aberta) return
    const id = setInterval(() => tique((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [aberta])

  const atividade = useStore(atividadeAtual)
  if (!aberta || !visivel) return null

  const alerta = contrastante(corEmHex(accentFor(phase, ui, atividade)))
  return (
    <aside className="rail rail-left" style={{ ['--alerta' as string]: alerta }}>
      <div className="rail-title">SISTEMAS</div>
      {sistemasAgora().map((s) => (
        <div key={s.id} className={s.degradado ? 'rail-sistema degradado' : 'rail-sistema'}>
          <div className="rail-item">
            <span className="tick" />
            {s.nome}
          </div>
          {s.problemas.map((p) => (
            <div key={p} className="rail-problema">
              {p}
            </div>
          ))}
        </div>
      ))}
    </aside>
  )
}
