import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { abrirNoYoutube } from '../lib/musica'

const ORIGEM = 'https://www.youtube-nocookie.com'
const FADE_MS = 4000
const PASSO_MS = 250

/**
 * O tocador do canto: a faixa do bom dia (RF-55, docs/adr/0026).
 *
 * É o player oficial do YouTube, visível no tamanho mínimo que a Google permite
 * (200×200): esconder o player ou baixar o áudio fere os termos. Toca baixinho, por
 * baixo da voz, e o trecho termina num fade. Pausar segura também o relógio do trecho.
 */
export function Tocador() {
  const musica = useStore((s) => s.musica)
  const comando = useStore((s) => s.comandoDaMusica)
  const setMusica = useStore((s) => s.setMusica)
  const frame = useRef<HTMLIFrameElement>(null)
  const decorrido = useRef(0)

  const enviar = (func: string, args: unknown[] = []) =>
    frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), ORIGEM)

  const parar = () => {
    enviar('stopVideo')
    setMusica(null)
  }

  // Uma faixa nova: zera o relógio e reafirma o volume até o player ficar pronto.
  useEffect(() => {
    if (!musica) return
    decorrido.current = 0
    const ajuste = window.setInterval(() => {
      frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: musica.id }), ORIGEM)
      enviar('setVolume', [musica.volume])
    }, 400)
    const fim = window.setTimeout(() => window.clearInterval(ajuste), 4000)
    return () => {
      window.clearInterval(ajuste)
      window.clearTimeout(fim)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [musica?.id])

  // O relógio do trecho só anda tocando; no fim, o fade e o tocador some.
  useEffect(() => {
    if (!musica?.tocando) return
    const limite = musica.trechoSegundos * 1000
    const relogio = window.setInterval(() => {
      decorrido.current += PASSO_MS
      const atual = useStore.getState().musica
      if (atual) useStore.getState().setMusica({ ...atual, posicao: atual.inicio + decorrido.current / 1000 })
      const falta = limite - decorrido.current
      if (falta <= 0) {
        window.clearInterval(relogio)
        parar()
      } else if (falta < FADE_MS) {
        enviar('setVolume', [Math.round(musica.volume * (falta / FADE_MS))])
      }
    }, PASSO_MS)
    return () => window.clearInterval(relogio)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [musica?.id, musica?.tocando])

  // Pedidos da voz: pausar, tocar, parar.
  useEffect(() => {
    const m = useStore.getState().musica
    if (!comando || !m) return
    if (comando.acao === 'parar') return parar()
    enviar(comando.acao === 'pausar' ? 'pauseVideo' : 'playVideo')
    setMusica({ ...m, tocando: comando.acao === 'tocar' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comando?.em])

  if (!musica) return null

  const alternar = () => {
    enviar(musica.tocando ? 'pauseVideo' : 'playVideo')
    setMusica({ ...musica, tocando: !musica.tocando })
  }
  const src =
    `${ORIGEM}/embed/${encodeURIComponent(musica.id)}` +
    `?enablejsapi=1&autoplay=1&start=${musica.inicio}&controls=0&rel=0&playsinline=1` +
    `&origin=${encodeURIComponent(window.location.origin)}`
  const canal = musica.canal?.replace(/ - Topic$/, '')

  return (
    <aside className="tocador" aria-label="Música do bom dia">
      <iframe
        ref={frame}
        className="tocador-video"
        src={src}
        sandbox="allow-scripts allow-same-origin allow-presentation"
        allow="autoplay; encrypted-media"
        referrerPolicy="strict-origin-when-cross-origin"
        title={musica.titulo}
      />
      <div className="tocador-info">
        <div className="tocador-titulo" title={musica.titulo}>
          {musica.titulo}
        </div>
        {canal && <div className="tocador-canal">{canal}</div>}
        <div className="tocador-acoes">
          <button onClick={alternar} aria-label={musica.tocando ? 'Pausar' : 'Tocar'}>
            {musica.tocando ? '❚❚' : '▶'}
          </button>
          <button
            onClick={() => {
              abrirNoYoutube(musica)
              parar()
            }}
          >
            Abrir no YouTube
          </button>
          <button onClick={parar} aria-label="Fechar">
            ✕
          </button>
        </div>
      </div>
    </aside>
  )
}
