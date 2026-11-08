/**
 * O que a aba SISTEMAS mostra (RF-56, docs/adr/0018).
 *
 * O A.P.O.L.O. é um só: tudo o que ele usa para rodar forma o C.O.R.E. (Centro
 * Operacional da Rede), uma linha só. Se uma parte falha, é o C.O.R.E. que está
 * degradado, com o motivo embaixo. As outras linhas são o que for plugável: hoje
 * conectores; no futuro, skills, sub-sistemas, extensões e APIs.
 */

export type Servidor = { nome: string; estado?: string }
export type TipoDeSistema = 'core' | 'conector' | 'skill' | 'extensao' | 'api'
export type Sistema = {
  id: string
  nome: string
  tipo: TipoDeSistema
  degradado: boolean
  /** Em palavras, o que está errado. Vazio quando está tudo bem. */
  problemas: string[]
}

/**
 * O que não faz parte do que o A.P.O.L.O. precisa para rodar, e o nome com que
 * aparece. Cada sistema plugável ganha um nome próprio, como o C.O.R.E. (ADR 0018).
 * H.E.R.M.E.S. é o canal do celular: o mensageiro dos deuses, irmão de Apolo.
 * F.Ê.N.I.X. é a guardiã que o mantém no ar e o faz renascer (ADR 0025).
 */
const PLUGAVEIS: Record<string, string> = { fenix: 'F.Ê.N.I.X.', celular: 'H.E.R.M.E.S.' }

const FALHAS: Record<string, string> = { failed: 'falhou', 'needs-auth': 'precisa de autorização' }

/** @param voz null enquanto a voz ainda não deveria estar no ar */
export function montarSistemas(
  servidores: Servidor[],
  { ponte, voz }: { ponte: boolean; voz: boolean | null },
): Sistema[] {
  const problemas: string[] = []
  if (!ponte) problemas.push('ponte desconectada')
  if (voz === false) problemas.push('voz desconectada')
  const plugaveis: Sistema[] = []
  for (const { nome, estado } of servidores) {
    const falha = FALHAS[estado ?? '']
    if (nome in PLUGAVEIS) {
      plugaveis.push({
        id: nome,
        nome: PLUGAVEIS[nome],
        tipo: 'conector',
        degradado: Boolean(falha),
        problemas: falha ? [falha] : [],
      })
    } else if (falha) {
      problemas.push(`${nome.replace(/^mcp__/, '')}: ${falha}`)
    }
  }
  return [
    { id: 'core', nome: 'C.O.R.E.', tipo: 'core', degradado: problemas.length > 0, problemas },
    ...plugaveis,
  ]
}

/**
 * Como cada nome se fala. Na tela a sigla tem pontos; em voz é uma palavra só,
 * nunca letra por letra.
 */
const FALADOS: Record<string, string> = { 'C.O.R.E.': 'Core', 'F.Ê.N.I.X.': 'Fênix', 'H.E.R.M.E.S.': 'Hermes' }
export const nomeFalado = (nome: string) => FALADOS[nome] ?? nome

/** O que o modelo de voz narra. */
export function resumoSistemas(sistemas: Sistema[]) {
  const ruins = sistemas.filter((s) => s.degradado)
  if (!ruins.length) return 'Todos os sistemas operacionais, Core íntegro.'
  return ruins.map((s) => `${nomeFalado(s.nome)} degradado: ${s.problemas.join('; ')}.`).join(' ')
}
