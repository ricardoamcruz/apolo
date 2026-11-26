/**
 * Trocar a branch no ar pela voz (docs/adr/0038), igual no PC e no celular.
 *
 *   1ª chamada  → a prévia da Fênix (o que muda, o que é sensível) e a pergunta
 *   o "sim"     → conferido na transcrição do microfone, nunca no que o modelo diz
 *   2ª chamada  → a troca, no commit da prévia
 *
 * Voltar à versão segura (a main) não pede o sim: é a saída de emergência, e quem
 * não consegue voltar não é resiliente. Ir para uma branch de fase pede, porque
 * põe no ar código que talvez ninguém tenha revisado.
 */

export type RespostaDaTroca = {
  ok: boolean
  mensagem: string
  branch?: string
  sha?: string
  confirmar?: boolean
  mesma?: boolean
}

/** O fim de uma troca, como a Fênix guarda em `ultimaTroca`. */
export type FimDaTroca = { id: string; ok: boolean; mensagem: string; branch?: string; em?: number; automatica?: boolean }

/** Quanto tempo a prévia vale para o sim: depois disso, ela é lida de novo. */
export const PREVIA_MS = 3 * 60_000

type Pendente = { branch: string; sha: string; vistaEm: number }

/**
 * @param pedir  fala com a Fênix pela ponte (ou pelo core, no celular)
 * @param ouviu  o Ricardo disse sim depois de `desde`? (a transcrição, ver autodev.ts)
 */
export function criarTrocaDeVersao({
  pedir,
  ouviu,
  agora = () => Date.now(),
}: {
  pedir: (acao: 'previa' | 'trocar', extra: Record<string, unknown>) => Promise<RespostaDaTroca>
  ouviu: (desde: number) => Promise<boolean>
  agora?: () => number
}) {
  let pendente: Pendente | null = null

  const trocar = async (sha: string, branch: string) => {
    pendente = null
    const r = await pedir('trocar', { branch, sha })
    if (!r.ok) return `${r.mensagem}`
    if (r.mesma) return r.mensagem
    return (
      `${r.mensagem} Avise em uma frase curta que vai sumir um instante e já volta. ` +
      'Quando voltar, a Fênix conta como foi: não diga que deu certo antes disso.'
    )
  }

  return {
    /** O texto que volta para a voz. Nunca rejeita. */
    async pedido(branch: string): Promise<string> {
      const nome = String(branch ?? '').trim()
      if (!nome) return 'Diga para qual branch trocar (a main, ou o número da fase, como 3.4). Nada foi trocado.'
      // O sim já ouvido vale para a mesma prévia, enquanto ela não envelhece.
      const vale = pendente && agora() - pendente.vistaEm < PREVIA_MS ? pendente : null
      const previa = await pedir('previa', { branch: nome })
      if (!previa.ok) return previa.mensagem
      if (previa.mesma || !previa.branch || !previa.sha) return previa.mensagem
      if (!previa.confirmar) return trocar(previa.sha, previa.branch)
      if (vale && vale.branch === previa.branch && vale.sha === previa.sha) {
        if (await ouviu(vale.vistaEm)) return trocar(vale.sha, vale.branch)
        return (
          `O sim do Ricardo não foi ouvido. Pergunte uma vez se ele confirma a troca para a ${vale.branch}; ` +
          'se ele disser que sim, chame trocar de novo com a mesma branch. Nada foi trocado.'
        )
      }
      pendente = { branch: previa.branch, sha: previa.sha, vistaEm: agora() }
      return (
        `Prévia, ainda sem trocar: ${previa.mensagem}\n` +
        'Diga isso em uma ou duas frases, sem ler nomes de arquivo um a um, e pergunte se ele confirma. ' +
        'Só depois que ele disser que sim, chame trocar de novo com a mesma branch.'
      )
    },
    /** Para os testes e para quando ele muda de assunto. */
    esquecer() {
      pendente = null
    },
  }
}

/**
 * O fim de uma troca vira notícia uma vez só, mesmo que a página recarregue no
 * meio (o que acontece quando a branch nova muda a interface). Velho demais não é
 * notícia: é o estado de sempre.
 */
export function trocaParaAnunciar(
  fim: FimDaTroca | null | undefined,
  jaAnunciada: string | null,
  agora = Date.now(),
  validadeMs = 10 * 60_000,
) {
  if (!fim?.id || fim.id === jaAnunciada) return null
  if (fim.em && agora - fim.em > validadeMs) return null
  return fim
}

/** O que a voz diz quando a troca termina. */
export function textoDoFimDaTroca(fim: FimDaTroca) {
  if (fim.automatica) {
    return `A Fênix voltou sozinha para a versão segura. Avise o Ricardo em uma ou duas frases, sem ler nomes de arquivo: ${fim.mensagem}`
  }
  return fim.ok
    ? `A troca de branch terminou e você já está na versão nova. Diga em uma frase, sem soletrar o nome da branch inteiro: ${fim.mensagem}`
    : `A troca de branch não deu certo e você voltou à versão de antes. Diga em uma ou duas frases: ${fim.mensagem}`
}
