/**
 * O protocolo Â.N.C.O.R.A. pela voz (docs/adr/0041), igual no PC e no celular.
 *
 *   1ª chamada  → o que vai acontecer, e a pergunta
 *   o "sim"     → conferido na transcrição do microfone, nunca no que o modelo diz
 *   2ª chamada  → a âncora; a voz cai junto com o resto e volta na versão de segurança
 *
 * Arquivo sensível e trava da noite (bridge/autodev/politica.mjs): é o sim que
 * desliga tudo.
 */

export type RespostaDaAncora = { ok: boolean; mensagem: string; instalada?: boolean; noAr?: boolean }

/** Quanto tempo a pergunta vale para o sim. */
export const PERGUNTA_MS = 2 * 60_000

export function criarAncoraPelaVoz({
  pedir,
  ouviu,
  agora = () => Date.now(),
}: {
  pedir: (acao: 'ancora-estado' | 'ancora-acionar') => Promise<RespostaDaAncora>
  ouviu: (desde: number) => Promise<boolean>
  agora?: () => number
}) {
  let perguntadaEm: number | null = null

  return {
    /** O texto que volta para a voz. Nunca rejeita. */
    async pedido(acao: string): Promise<string> {
      if (acao === 'estado') return (await pedir('ancora-estado')).mensagem
      if (acao !== 'acionar') return `Ação desconhecida: ${acao}. Use "acionar" ou "estado".`
      const vale = perguntadaEm !== null && agora() - perguntadaEm < PERGUNTA_MS ? perguntadaEm : null
      if (vale !== null) {
        if (!(await ouviu(vale))) {
          return (
            'O sim do Ricardo não foi ouvido. Pergunte uma vez se ele confirma o protocolo âncora; se ele ' +
            'disser que sim, chame ancora de novo com acao "acionar". Nada foi feito.'
          )
        }
        perguntadaEm = null
        const r = await pedir('ancora-acionar')
        if (!r.ok) return `Não acionei a âncora: ${r.mensagem} Diga isso em uma frase.`
        return (
          'Diga exatamente esta frase, e nada mais: "Protocolo âncora acionado. Vou desligar tudo e voltar ' +
          'na versão de segurança; em um ou dois minutos estou de volta."'
        )
      }
      const estado = await pedir('ancora-estado')
      if (!estado.instalada) return estado.mensagem
      perguntadaEm = agora()
      return (
        `Ainda sem acionar. ${estado.mensagem}\n` +
        'Explique em duas frases: o protocolo âncora desliga tudo, guarda o que estiver sem commit numa ' +
        'branch de pânico e sobe a versão de segurança, e a voz cai por um ou dois minutos. Pergunte se ' +
        'ele confirma. Só depois que ele disser que sim, chame ancora de novo com acao "acionar".'
      )
    },
    esquecer() {
      perguntadaEm = null
    },
  }
}
