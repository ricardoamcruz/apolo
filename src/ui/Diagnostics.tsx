import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { diag as rt } from '../lib/realtime'

/**
 * Painel "por que ele não me ouve / por que eu não o ouço".
 *
 * Tecla D abre e fecha. Mostra o estado da sessão de voz em tempo real lido
 * direto do cliente WebRTC, para transformar "não funciona" num fato concreto.
 */

const ago = (t: number) => {
  if (!t) return '—'
  const s = Math.round((Date.now() - t) / 1000)
  return s < 60 ? `há ${s}s` : `há ${Math.round(s / 60)} min`
}

function Row({ k, v, bad }: { k: string; v: string; bad?: boolean }) {
  return (
    <div className="diag-row">
      <span className="diag-k">{k}</span>
      <span className={bad ? 'diag-v diag-bad' : 'diag-v'}>{v}</span>
    </div>
  )
}

export function Diagnostics() {
  const [open, setOpen] = useState(false)
  const [, tick] = useState(0)
  const phase = useStore((s) => s.phase)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'd' && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    const id = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [open])

  if (!open) return null

  const linked = rt.state === 'conectado'

  return (
    <div className="diag" aria-live="polite">
      <div className="diag-head">DIAGNÓSTICO · D para fechar</div>

      <div className="diag-verdict">
        <span className={linked ? 'diag-ok' : 'diag-bad'}>
          {linked ? '● voz conectada' : '● voz desconectada'}
        </span>
        <span className={rt.micOn ? 'diag-ok' : 'diag-bad'}>
          {rt.micOn ? '● microfone aberto' : '● microfone fechado'}
        </span>
      </div>

      <div className="diag-sec">SESSÃO DE VOZ</div>
      <Row k="estado" v={rt.state} bad={!linked} />
      <Row k="provedor" v={rt.provider || '—'} />
      <Row k="modelo" v={rt.model || '—'} />
      <Row k="conectada" v={ago(rt.connectedAt)} />
      <Row k="fase" v={phase} />
      <Row k="falando" v={rt.speaking ? 'sim' : 'não'} />
      <Row k="respostas" v={String(rt.responses)} />
      <Row k="ferramentas" v={String(rt.tools)} />
      <Row k="último evento" v={rt.lastEvent || '—'} />
      <Row k="ouvi por último" v={rt.lastHeard ? `"${rt.lastHeard}"` : '— nada ainda'} bad={!rt.lastHeard} />
      <Row k="erro" v={rt.lastError || '—'} bad={Boolean(rt.lastError)} />
    </div>
  )
}
