import { CORES_DE_ESTADO } from '../../../src/lib/estados'

/** Os mesmos valores de `:root` (src/index.css) e de `phaseColor` (src/store.ts). */
export const COR_DE_FUNDO = '#01060c'
export const COR_DA_INTERFACE = '#00e5ff'
export const COR_DO_TEXTO = '#d8f6fa'
export const COR_APAGADA = '#6f9aa3'
export const FONTE_MONO = 'Menlo'

export type Fase =
  | 'offline'
  | 'espera'
  | 'ocioso'
  | 'ouvindo'
  | 'processando'
  | 'executando'
  | 'codificando'
  | 'falando'

export const CORES: Record<Fase, string> = {
  offline: CORES_DE_ESTADO.desconectado,
  espera: CORES_DE_ESTADO.repouso,
  ocioso: CORES_DE_ESTADO.repouso,
  ouvindo: CORES_DE_ESTADO.ouvindo,
  processando: CORES_DE_ESTADO.processando,
  executando: CORES_DE_ESTADO.executando,
  codificando: CORES_DE_ESTADO.codificando,
  falando: CORES_DE_ESTADO.respondendo,
}
