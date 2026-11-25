/**
 * Quando uma fala começa e termina, decidido aqui (docs/adr/0036). O detector do
 * Gemini deixou de perceber a fala: com a mesma gravação, 0 de 12 respostas com ele e
 * 30 de 30 marcando o começo e o fim do lado de cá.
 */

/** Abaixo disto não é fala, por mais silenciosa que a sala seja. */
const PISO = 0.018
/** Quantas vezes acima do ruído da sala a fala precisa estar para começar. */
const ACIMA_DO_RUIDO = 3
/** Já falando, vale menos: o fim das palavras cai de volume. */
const PARA_CONTINUAR = 0.5
/** Voz para abrir a fala, dentro de `JANELA_MS`: um estalo não chega a isto. */
const VOZ_PARA_ABRIR_MS = 160
const JANELA_MS = 320
/** O que se manda de antes da abertura, para a primeira sílaba não se perder. */
export const ANTES_MS = 480
/** Uma fala sem pausa por tanto tempo é a TV: fecha, e o modelo decide o que fazer. */
export const FALA_MAXIMA_MS = 30_000

export type Passo = 'fora' | 'comeca' | 'dentro' | 'termina'

export function criarDetectorDeFala(silencioMs: number, blocoMs: number) {
  let ruido = 0.01
  let dentro = false
  let silencio = 0
  let duracao = 0
  let recentes: boolean[] = []
  const janela = Math.max(1, Math.round(JANELA_MS / blocoMs))

  const reiniciar = () => {
    dentro = false
    silencio = 0
    duracao = 0
    recentes = []
  }
  const abrir = (): Passo => {
    dentro = true
    silencio = 0
    duracao = 0
    recentes = []
    return 'comeca'
  }
  return {
    bloco(rms: number): Passo {
      // O ruído desce na hora e sobe devagar: a fala não vira ruído, um ventilador sim.
      ruido = rms < ruido ? rms : ruido + (rms - ruido) * Math.min(1, blocoMs / (dentro ? 20_000 : 4000))
      const limiar = Math.max(PISO, ruido * ACIMA_DO_RUIDO)
      if (!dentro) {
        recentes.push(rms > limiar)
        if (recentes.length > janela) recentes.shift()
        return recentes.filter(Boolean).length * blocoMs >= VOZ_PARA_ABRIR_MS ? abrir() : 'fora'
      }
      duracao += blocoMs
      silencio = rms > limiar * PARA_CONTINUAR ? 0 : silencio + blocoMs
      if (silencio < silencioMs && duracao < FALA_MAXIMA_MS) return 'dentro'
      reiniciar()
      return 'termina'
    },
    /** Abre sem esperar: quem chamou já sabe que é fala (ele falou por cima). */
    abrir,
    dentro: () => dentro,
    reiniciar,
  }
}
