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
export type FimDaTroca = {
  id: string
  ok: boolean
  mensagem: string
  /** Onde a cópia ficou: o destino, se deu certo; a origem, se voltou. */
  branch?: string
  /** De onde a troca partiu e para onde ia. */
  de?: string
  para?: string
  em?: number
  automatica?: boolean
}

/** A versão segura, para onde a Fênix volta sozinha. */
export const VERSAO_PRINCIPAL = 'main'

/**
 * A branch como se fala: a main é a "versão principal", e uma de fase vira o
 * número e o nome ("fase-3.5/aviso-e-escolha" → "3.5, aviso e escolha").
 */
export function nomeDaVersao(branch: string | undefined | null) {
  const b = String(branch ?? '').trim()
  if (!b || b === VERSAO_PRINCIPAL) return 'principal'
  const fase = b.match(/^fase-(\d+(?:\.\d+)*)\/(.+)$/)
  return fase ? `${fase[1]}, ${fase[2].replace(/-/g, ' ')}` : b
}

/** Como a voz se refere a ela numa frase: "a versão principal", "a versão 3.5, aviso e escolha". */
const aVersao = (branch: string | undefined | null) => `a versão ${nomeDaVersao(branch)}`

/** O que fazer se ele aceitar que os logs sejam analisados. */
const ANALISAR_LOGS =
  'Se ele disser que sim, use executar_tarefa pedindo para ler as últimas linhas de ~/.apolo/fenix/eventos.log ' +
  '(e de ~/.apolo/logs/voz-<data de hoje>.log, se precisar) e explicar em duas frases o que deu errado, sem ler código nem caminhos.'

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
  pedir: (acao: 'previa' | 'trocar' | 'registrar-troca', extra: Record<string, unknown>) => Promise<RespostaDaTroca>
  ouviu: (desde: number) => Promise<boolean>
  agora?: () => number
}) {
  let pendente: Pendente | null = null

  const trocar = async (sha: string, branch: string) => {
    pendente = null
    const r = await pedir('trocar', { branch, sha })
    if (!r.ok) return `Não troquei, e nada mudou: ${r.mensagem} Diga isso em uma frase.`
    if (r.mesma) return `${r.mensagem} Diga em uma frase: "Já estou na versão ${nomeDaVersao(branch)}."`
    const frase =
      branch === VERSAO_PRINCIPAL
        ? 'Voltando para a versão principal. Já volto.'
        : `Reiniciando o sistema na versão ${nomeDaVersao(branch)}. Já volto.`
    return (
      `${r.mensagem} Diga exatamente esta frase, e nada mais: "${frase}" ` +
      'Quando o sistema voltar, você vai receber como foi: não diga que deu certo antes disso.'
    )
  }

  /** O que parou aqui, sem chegar à Fênix, também vai ao eventos.log. Nunca atrasa a resposta. */
  const registrar = (codigo: 'sim-nao-ouvido' | 'previa-vencida', branch: string) => {
    void pedir('registrar-troca', { codigo, branch }).catch(() => {})
  }

  return {
    /** O texto que volta para a voz. Nunca rejeita. */
    async pedido(branch: string): Promise<string> {
      const nome = String(branch ?? '').trim()
      if (!nome) return 'Diga para qual branch trocar (a main, ou o número da fase, como 3.4). Nada foi trocado.'
      // O sim já ouvido vale para a mesma prévia, enquanto ela não envelhece.
      const vale = pendente && agora() - pendente.vistaEm < PREVIA_MS ? pendente : null
      if (pendente && !vale) registrar('previa-vencida', pendente.branch)
      const previa = await pedir('previa', { branch: nome })
      if (!previa.ok) return previa.mensagem
      if (previa.mesma || !previa.branch || !previa.sha) return previa.mensagem
      if (!previa.confirmar) return trocar(previa.sha, previa.branch)
      if (vale && vale.branch === previa.branch && vale.sha === previa.sha) {
        if (await ouviu(vale.vistaEm)) return trocar(vale.sha, vale.branch)
        registrar('sim-nao-ouvido', vale.branch)
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

/**
 * O que a voz diz quando a troca termina, passo a passo como o Ricardo pediu: a
 * frase exata para cada desfecho, e o motivo da Fênix só para quem perguntar.
 */
export function textoDoFimDaTroca(fim: FimDaTroca) {
  const para = fim.para ?? (fim.ok ? fim.branch : undefined)
  const de = fim.de ?? (fim.ok ? undefined : fim.branch)
  const dizer = (frase: string, depois = '') =>
    `A troca de branch terminou. Diga exatamente esta frase: "${frase}"${depois ? ` ${depois}` : ''} O detalhe da Fênix, só se ele perguntar: ${fim.mensagem}`

  // A volta sozinha que falhou cai nos casos de erro, logo abaixo.
  if (fim.automatica && fim.ok) {
    return dizer(
      `Alerta: ${aVersao(de)} caiu várias vezes seguidas, e eu voltei sozinho para a versão principal para não ficar sem voz. Ela continua guardada. Quer que eu analise os logs para entender o que deu errado?`,
      ANALISAR_LOGS,
    )
  }
  if (fim.ok) {
    if (para === VERSAO_PRINCIPAL) return dizer('Estou de volta à versão principal, como você pediu.')
    if (de && de === para) return dizer(`Atualização concluída: ${aVersao(para)} já está no commit mais novo.`)
    return dizer(`Reinicialização concluída: estou rodando ${aVersao(para)}.`)
  }
  // Não chegou a mexer em nada: a versão de antes nem saiu do ar.
  if (/Nada foi trocado\./.test(fim.mensagem)) {
    return dizer(`Não consegui trocar para ${aVersao(para)}; nada mudou, e eu continuo na versão ${nomeDaVersao(de)}.`)
  }
  if (/nem voltar/.test(fim.mensagem)) {
    return dizer(
      `Erro grave: não consegui subir ${aVersao(para)} nem voltar para ${aVersao(de)}. Preciso que você confira o sistema no Mac. Quer que eu analise os logs para entender o que deu errado?`,
      ANALISAR_LOGS,
    )
  }
  const voltei = de === VERSAO_PRINCIPAL ? 'voltei automaticamente para a versão principal' : `voltei automaticamente para ${aVersao(de)}, a de antes`
  return dizer(
    `Erro de reinicialização: ${aVersao(para)} não ficou de pé, e eu ${voltei}. Quer que eu analise os logs para entender o que deu errado?`,
    ANALISAR_LOGS,
  )
}
