import { useStore } from '../store'
import { isConnected } from './bridge'
import { diag as voz } from './realtime'
import { montarSistemas } from './sistemas'

/** Os sistemas agora, lidos de quem sabe: a ponte, a sessão de voz e o agente. */
export function sistemasAgora() {
  const { connected, phase } = useStore.getState()
  const ligado = phase !== 'offline' && phase !== 'boot'
  return montarSistemas(connected, {
    ponte: isConnected(),
    voz: ligado ? voz.state === 'conectado' : null,
  })
}
