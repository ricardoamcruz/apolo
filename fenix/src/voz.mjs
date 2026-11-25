/**
 * A recuperação da voz (docs/adr/0035). O processo de pé não basta: quando a voz que
 * o serviço relata no /health fica ruim, a Fênix age, um degrau por vez:
 *
 *   1. pede ao projeto que recarregue a página;
 *   2. se não bastou, roda o comando que reabre a janela;
 *   3. se nem assim, avisa.
 *
 * Um degrau de cada por episódio: com o provedor fora do ar, reabrir a janela em
 * círculos só atrapalharia. Depois de `rearmarMs` ruim, o episódio recomeça.
 * Voz surda não é caso de recarregar (a página já trocou de sessão e de modelo): só avisa.
 */
export const PRAZOS = { ruimMs: 60_000, degrauMs: 90_000, rearmarMs: 30 * 60_000 }

const RUINS = new Set(['falhando', 'sem interface', 'escuta muda'])
const SO_AVISO = new Set(['surda', 'por texto'])

export function criarRecuperacaoDaVoz({ recarregar, reabrir, avisar, log = console.log, agora = Date.now, prazos = {} }) {
  const p = { ...PRAZOS, ...prazos }
  let inicio = 0
  let degrau = 0
  let ultimo = 0
  let boaDesde = 0
  let avisouSurdez = 0

  return {
    /** Chamado a cada checagem de saúde, com o retrato da voz. */
    ver(voz) {
      const t = agora()
      if (SO_AVISO.has(voz.estado)) {
        inicio = 0
        if (avisouSurdez && t - avisouSurdez < p.rearmarMs) return
        avisouSurdez = t
        avisar(
          voz.estado === 'por texto'
            ? 'O provedor de voz não está ouvindo o microfone. Passei a conversa para a transcrição do navegador, e ele segue respondendo.'
            : 'O provedor de voz não está ouvindo o microfone, e não há outro caminho nesta janela. Sigo tentando.',
        )
        return
      }
      if (!RUINS.has(voz.estado)) {
        // Uma melhora de segundos não encerra o episódio, senão ele recomeçaria em círculos.
        boaDesde ||= t
        if (t - boaDesde >= p.ruimMs) {
          if (degrau) log('[fenix] a voz se firmou de novo')
          inicio = degrau = 0
        }
        return
      }
      boaDesde = 0
      inicio ||= t
      if (degrau >= 3) {
        if (t - ultimo >= p.rearmarMs) {
          degrau = 0
          inicio = t
        }
        return
      }
      if (t - (degrau ? ultimo : inicio) < (degrau ? p.degrauMs : p.ruimMs)) return
      degrau++
      ultimo = t
      // Sem página ligada não há o que recarregar.
      if (degrau === 1 && voz.estado === 'sem interface') degrau = 2
      if (degrau === 1) {
        log(`[fenix] voz ${voz.estado}: peço para recarregar a página`)
        return recarregar()
      }
      if (degrau === 2) {
        log(`[fenix] voz ${voz.estado}: reabro a janela da interface`)
        if (reabrir) return reabrir()
        degrau = 3
      }
      log(`[fenix] voz ${voz.estado}: não consegui recuperar; aviso`)
      avisar('Ele está sem voz. Já tentei recarregar a página e reabrir a janela. Sigo de olho.')
    },
  }
}
