import { useStore } from '../store'
import { ordenarPopups, vizinhoDoPopup } from './ordemDosPopups'

export type AcaoDePopup =
  | 'abrir'
  | 'minimizar'
  | 'proximo'
  | 'anterior'
  | 'tela_cheia'
  | 'sair_tela_cheia'
  | 'fechar'

const abertosAgora = () => {
  const s = useStore.getState()
  const abertos = s.blades.filter((b) => !b.minimized)
  return { s, abertos, frente: ordenarPopups(abertos, s.focusedBlade)[0] }
}

function alternar(passo: number) {
  const { s, abertos, frente } = abertosAgora()
  const proximo = vizinhoDoPopup(abertos, frente?.id, passo)
  if (!proximo) return null
  s.focusBlade(proximo.id)
  // Em tela cheia só um popup aparece: focar sem trocar não mudaria nada na tela.
  if (s.expandedBlade) s.expandBlade(proximo.id)
  return proximo
}

/** As teclas e a voz passam por aqui. Devolve o que a voz diz ao Ricardo. */
export function comandarPopup(acao: AcaoDePopup, titulo?: string): string {
  const { s, frente } = abertosAgora()
  if (acao === 'abrir') {
    const n = s.restoreBlades(titulo)
    if (!n) return 'Não há popup minimizado com esse nome.'
    return n === 1 ? 'Um popup aberto.' : `${n} popups abertos.`
  }
  if (acao === 'minimizar') {
    s.minimizeBlades()
    return 'Popups minimizados.'
  }
  if (acao === 'sair_tela_cheia') {
    if (!s.expandedBlade) return 'Nenhum popup estava em tela cheia.'
    s.expandBlade(null)
    return 'Saiu da tela cheia.'
  }
  if (!frente) return 'Não há popup aberto.'
  if (acao === 'tela_cheia') {
    s.expandBlade(frente.id)
    return `Em tela cheia: ${frente.title}.`
  }
  if (acao === 'fechar') {
    s.closeBlade(frente.id)
    return `Fechado: ${frente.title}.`
  }
  const proximo = alternar(acao === 'proximo' ? 1 : -1)
  return proximo ? `Na frente: ${proximo.title}.` : 'Só há um popup aberto.'
}
