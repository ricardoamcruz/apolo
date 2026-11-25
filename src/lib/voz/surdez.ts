/**
 * A voz surda (docs/adr/0035): a sessão está aberta, o microfone sobe, e o provedor
 * não devolve nada. Para o socket está tudo bem, então só dá para perceber pelo que
 * falta: fala entrando e nenhum sinal voltando.
 */

/** Fala num trecho contínuo para valer como frase: um estalo ou uma tosse não chegam a isto. */
export const FRASE_MINIMA_MS = 700
/** Silêncio que encerra uma frase. Maior que o do detector do provedor, que espera 1,2 s. */
export const FIM_DA_FRASE_MS = 1800
/** Desde o fim da primeira frase sem resposta: a decisão e a resposta levam uns segundos. */
export const SEM_RETORNO_MS = 10_000
/** Uma frase pode ter sido ruído; ele repetir é que diz que não foi ouvido. */
export const FRASES_SEM_RETORNO = 2
/** Sem mais nada em 45 s, as frases não são da mesma tentativa. */
const VALIDADE_MS = 45_000
/** Abaixo disto não é alguém falando com ele, por mais silenciosa que a sala seja. */
const PISO_DA_FALA = 0.035
/** Quantas vezes acima do ruído da sala, para um ventilador não contar como fala. */
const ACIMA_DO_RUIDO = 3

/**
 * Conta as frases inteiras que subiram e ficaram sem nenhum sinal. Só o fim da frase
 * conta: o Gemini 3.8 não manda nada enquanto ela dura (alarme falso de 24/11/2026).
 */
export function criarOuvidoSurdo(agora: () => number = Date.now) {
  let ruido = 0.01
  let falaMs = 0
  let ultimaFala = 0
  let frases = 0
  let fimDaPrimeira = 0
  const zerar = () => {
    falaMs = 0
    frases = 0
    fimDaPrimeira = 0
  }
  return {
    /** Um trecho do microfone que subiu. Devolve true quando a sessão está surda. */
    trecho(rms: number, ms: number): boolean {
      // O ruído desce na hora e sobe devagar: uma fala não vira ruído, um ventilador sim.
      ruido = rms < ruido ? rms : ruido + (rms - ruido) * Math.min(1, ms / 8000)
      const t = agora()
      if (rms > Math.max(PISO_DA_FALA, ruido * ACIMA_DO_RUIDO)) {
        falaMs += ms
        ultimaFala = t
        return false
      }
      if (t - ultimaFala < FIM_DA_FRASE_MS) return false
      if (falaMs >= FRASE_MINIMA_MS) {
        frases++
        fimDaPrimeira ||= ultimaFala
      }
      falaMs = 0
      if (!frases) return false
      if (t - fimDaPrimeira > VALIDADE_MS) {
        zerar()
        return false
      }
      if (frases < FRASES_SEM_RETORNO || t - fimDaPrimeira < SEM_RETORNO_MS) return false
      zerar()
      return true
    },
    /** Qualquer sinal do provedor, ou um momento em que ele não deveria ouvir. */
    zerar,
  }
}

/**
 * Cota esgotada? Com limites de palavra: "rate" solto casava com BidiGenerateContent,
 * e toda recusa da retomada parecia falta de cota (24/11/2026).
 */
export const semCota = (motivo: string) => /\bquota\b|resource.?exhausted|\brate.?limit/i.test(motivo)

/** O que fazer a cada surdez seguida, até o provedor voltar a ouvir. */
export type Remedio =
  | { acao: 'retomar' }
  | { acao: 'trocar'; reserva: number }
  | { acao: 'esgotou' }

/**
 * A primeira surdez abre outra conexão na mesma conversa. Da segunda em diante, um
 * modelo de reserva por vez. Sem mais nenhum, acabaram os remédios do áudio.
 */
export function remedioDaSurdez(seguidas: number, modelos: number): Remedio {
  if (seguidas <= 1) return { acao: 'retomar' }
  const reserva = seguidas - 1
  return reserva < modelos ? { acao: 'trocar', reserva } : { acao: 'esgotou' }
}

/** Falando por texto, de quanto em quanto tempo o áudio ganha outra chance. */
export const NOVA_CHANCE_DO_AUDIO_MS = 10 * 60_000

/** A espera antes de tentar a voz de novo: cresce até 30 s e nunca desiste. */
export const ESPERA_MAXIMA_MS = 30_000
/** Com o limite do plano atingido, insistir não ajuda: uma vez a cada 5 minutos. */
export const ESPERA_DA_COTA_MS = 5 * 60_000
export function esperaDeReligar(tentativa: number, motivo = ''): number {
  if (/limite gratuito/i.test(motivo) || semCota(motivo)) return ESPERA_DA_COTA_MS
  return Math.min(1000 * 2 ** Math.min(tentativa, 10), ESPERA_MAXIMA_MS)
}

/** Duas falhas seguidas ao abrir com um modelo, e a próxima tenta o seguinte. */
export const reservaDaTentativa = (tentativa: number) => Math.floor(tentativa / 2)
