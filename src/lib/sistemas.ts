/**
 * O que a aba SISTEMAS mostra (RF-56, docs/adr/0018).
 *
 * O A.P.O.L.O. é um só: tudo o que ele usa para rodar forma o C.O.R.E. (Centro
 * Operacional da Rede), uma linha só. Se uma parte falha, é o C.O.R.E. que está
 * degradado, com o motivo embaixo. As outras linhas são o que for plugável: hoje
 * conectores; no futuro, skills, sub-sistemas, extensões e APIs.
 */

export type Servidor = { nome: string; estado?: string; motivo?: string }
export type TipoDeSistema = 'core' | 'conector' | 'skill' | 'extensao' | 'api'
export type Sistema = {
  id: string
  nome: string
  tipo: TipoDeSistema
  degradado: boolean
  /** Em palavras, o que está errado. Vazio quando está tudo bem. */
  problemas: string[]
  /** O endereço do ícone, quando ele vem de fora (uma extensão plugável). */
  icone?: string
}

/**
 * O que não faz parte do que o A.P.O.L.O. precisa para rodar, e o nome com que
 * aparece. Cada sistema plugável ganha um nome próprio, como o C.O.R.E. (ADR 0018).
 * H.E.R.M.E.S. é o canal do celular: o mensageiro dos deuses, irmão de Apolo.
 * F.Ê.N.I.X. é a guardiã que o mantém no ar e o faz renascer (ADR 0025).
 * A.U.R.O.R.A. é o bom dia: a deusa do amanhecer (ADR 0026).
 */
const PLUGAVEIS: Record<string, string> = { fenix: 'F.Ê.N.I.X.', celular: 'H.E.R.M.E.S.', aurora: 'A.U.R.O.R.A.' }

const FALHAS: Record<string, string> = { failed: 'falhou', 'needs-auth': 'precisa de autorização', degraded: 'degradado' }

export type ExtensaoNoAr = { id: string; nome: string; ok: boolean; motivo?: string; icone?: string }

/**
 * @param voz null enquanto a voz ainda não deveria estar no ar
 * @param extensoes as extensões plugáveis de extensoes/ (docs/adr/0033), cada uma uma linha
 */
export function montarSistemas(
  servidores: Servidor[],
  { ponte, voz, extensoes = [] }: { ponte: boolean; voz: boolean | null; extensoes?: ExtensaoNoAr[] },
): Sistema[] {
  const problemas: string[] = []
  if (!ponte) problemas.push('ponte desconectada')
  if (voz === false) problemas.push('voz desconectada')
  const plugaveis: Sistema[] = []
  for (const { nome, estado, motivo } of servidores) {
    // O motivo medido diz mais que o rótulo: "a autorização do YouTube expirou", não "degradado".
    const falha = FALHAS[estado ?? ''] && (motivo || FALHAS[estado ?? ''])
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
  for (const e of extensoes) {
    plugaveis.push({
      id: `extensao-${e.id}`,
      nome: e.nome,
      tipo: 'extensao',
      degradado: !e.ok,
      problemas: e.ok ? [] : [e.motivo || 'não carregou'],
      ...(e.icone && { icone: e.icone }),
    })
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
const FALADOS: Record<string, string> = {
  'C.O.R.E.': 'Core',
  'F.Ê.N.I.X.': 'Fênix',
  'H.E.R.M.E.S.': 'Hermes',
  'A.U.R.O.R.A.': 'Aurora',
}
/** Uma sigla com pontos que não esteja na lista (de uma extensão) vira a palavra: A.T.L.A.S. -> Atlas. */
export const nomeFalado = (nome: string) =>
  FALADOS[nome] ??
  (/^(?:\p{Lu}\.){2,}$/u.test(nome)
    ? nome.replace(/\./g, '').charAt(0) + nome.replace(/\./g, '').slice(1).toLowerCase()
    : nome)

/** O que o modelo de voz narra. */
export function resumoSistemas(sistemas: Sistema[]) {
  const ruins = sistemas.filter((s) => s.degradado)
  if (!ruins.length) return 'Todos os sistemas operacionais, Core íntegro.'
  return ruins.map((s) => `${nomeFalado(s.nome)} degradado: ${s.problemas.join('; ')}.`).join(' ')
}
