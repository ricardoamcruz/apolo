import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { abrirNoYoutube } from '../lib/musica'

const ORIGEM = 'https://www.youtube-nocookie.com'
const FADE_MS = 4000
const PASSO_MS = 250
/** Sem tocar com som até aqui, o Chrome segurou o autoplay. */
const AUTOPLAY_MS = 8000
const TOCANDO = 1

/**
 * O tocador do canto: a faixa do bom dia (RF-55, docs/adr/0026).
 *
 * É o player oficial do YouTube, visível no tamanho mínimo que a Google permite
 * (200×200): esconder o player ou baixar o áudio fere os termos. Toca baixinho, por
 * baixo da voz, e o trecho termina num fade. Pausar segura também o relógio do trecho.
 *
 * O Chrome só deixa um iframe tocar com som depois de um clique na página, e acordar
 * por voz não conta. Então o estado vem do próprio player: se ele não começou a tocar,
 * ou começou mudo, o relógio para e o botão pede o clique que libera o som.
 */
export function Tocador() {
  const musica = useStore((s) => s.musica)
  const comando = useStore((s) => s.comandoDaMusica)
  const setMusica = useStore((s) => s.setMusica)
  const frame = useRef<HTMLIFrameElement>(null)
  const decorrido = useRef(0)
  const [semSom, setSemSom] = useState(false)
  const semSomAgora = useRef(false)
  semSomAgora.current = semSom

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
    setSemSom(false)
    const ajuste = window.setInterval(() => {
      frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: musica.id, channel: 'widget' }), ORIGEM)
      enviar('setVolume', [musica.volume])
    }, 400)
    const fim = window.setTimeout(() => window.clearInterval(ajuste), 8000)

    // O que o player conta de si: tocando, e se está mudo. A primeira mensagem
    // (initialDelivery) traz tudo; as seguintes, só o que mudou. Sem ler a primeira,
    // um vídeo que já tinha começado parecia parado, e o tocador se pausava sozinho
    // quando a voz começava.
    let ouviuOPlayer = false
    let tocouComSom = false
    let estado = -1
    let mudo = false
    let tempo = -1
    const ouvir = (e: MessageEvent) => {
      if (e.origin !== ORIGEM || e.source !== frame.current?.contentWindow) return
      let dados: { event?: string; info?: unknown }
      try {
        dados = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
      } catch {
        return
      }
      if (!dados?.event) return
      ouviuOPlayer = true
      if (dados.event === 'onStateChange' && typeof dados.info === 'number') estado = dados.info
      if ((dados.event === 'infoDelivery' || dados.event === 'initialDelivery') && dados.info && typeof dados.info === 'object') {
        const info = dados.info as { playerState?: number; muted?: boolean; currentTime?: number }
        if (typeof info.playerState === 'number') estado = info.playerState
        if (typeof info.muted === 'boolean') mudo = info.muted
        // O tempo andando é a prova mais simples de que está tocando.
        if (typeof info.currentTime === 'number') {
          if (tempo >= 0 && info.currentTime > tempo) estado = TOCANDO
          tempo = info.currentTime
        }
      }
      if (estado === TOCANDO && !mudo && !tocouComSom) {
        tocouComSom = true
        setSemSom(false)
        // Se o aviso saiu antes da hora, volta ao normal.
        const atual = useStore.getState().musica
        if (atual?.id === musica.id && !atual.tocando && semSomAgora.current) {
          useStore.getState().setMusica({ ...atual, tocando: true })
        }
      }
    }
    window.addEventListener('message', ouvir)
    const vigia = window.setTimeout(() => {
      // Só pede o clique com certeza: player calado não é player bloqueado.
      if (tocouComSom || !ouviuOPlayer) return
      if (estado === TOCANDO && !mudo) return
      setSemSom(true)
      // Parado, o relógio do trecho também para: o trecho espera o clique.
      const atual = useStore.getState().musica
      if (atual?.id === musica.id) useStore.getState().setMusica({ ...atual, tocando: false })
    }, AUTOPLAY_MS)
    return () => {
      window.clearInterval(ajuste)
      window.clearTimeout(fim)
      window.clearTimeout(vigia)
      window.removeEventListener('message', ouvir)
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
    if (semSom) {
      // Este clique é o que o Chrome esperava para liberar o som.
      enviar('unMute')
      enviar('setVolume', [musica.volume])
      enviar('playVideo')
      setSemSom(false)
      setMusica({ ...musica, tocando: true })
      return
    }
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
        {semSom && <div className="tocador-aviso">O Chrome segurou o som até um clique.</div>}
        <div className="tocador-acoes">
          <button
            onClick={alternar}
            className={semSom ? 'tocador-liberar' : undefined}
            aria-label={semSom ? 'Tocar com som' : musica.tocando ? 'Pausar' : 'Tocar'}
          >
            {semSom ? '▶ tocar' : musica.tocando ? '❚❚' : '▶'}
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
