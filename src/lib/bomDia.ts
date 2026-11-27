import type { Blade } from '../store'

/**
 * Os popups do bom dia (RF-55): notícias, compromissos e desenvolvimento, em
 * diagonal, um depois do outro. Montados aqui, a partir dos dados da A.U.R.O.R.A.
 * e da ponte, e não pelo modelo: o conteúdo é o mesmo todo dia, e a voz fica só
 * com a narração.
 */

export type NoticiaDoDia = { titulo: string; fonte?: string | null }
/** Onde o bom dia está acontecendo: no PC há tocador; no celular, não (docs/adr/0037). */
export type OndeEhOBomDia = 'pc' | 'celular'
export type DadosDoBomDia = {
  agenda?: { disponivel: boolean; eventos?: { titulo: string; hora: string | null; local: string | null }[] }
  noticias?: { tema: string; itens: NoticiaDoDia[] }[]
  tarefas?: {
    disponivel: boolean
    prs?: { number: number; title: string; headRefName?: string; isDraft?: boolean }[]
    issues?: { number: number; title: string }[]
  }
  desenvolvimento?: {
    branch: string | null
    autodev: { fase: string; pedido: string | null; resultado: string | null } | null
    etapas: { etapa: string; total: number; itens: string[] }[]
    /** O que o sistema avisa além do dia: o relatório da noite, a âncora velha. */
    avisos?: string[]
  }
}

/** O resumo como a voz recebe, da ponte (PC) ou do core pelo H.E.R.M.E.S. (celular). */
export type ResumoDoBomDia = DadosDoBomDia & {
  ok: boolean
  texto?: string
  musica?: { titulo: string } | null
  /** Por que a música não veio, quando não veio. No celular é sempre nulo. */
  avisoDaMusica?: string | null
  mensagem?: string
}

/** Prefixo dos ids: é por ele que o "obrigado" sabe o que fechar. */
export const PREFIXO_DO_BOM_DIA = 'bomdia-'
/** O intervalo entre um popup e o próximo da diagonal. */
export const INTERVALO_DOS_POPUPS_MS = 900
/** Quanto tempo a conversa fica aberta, em silêncio, com os popups do bom dia na tela. */
export const LEITURA_DO_BOM_DIA_MS = 3 * 60_000

const escapar = (t: unknown) =>
  String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const linha = (idx: string, label: string, sub?: string | null, tag?: string | null) =>
  `<div class="hud-row"><span class="hud-idx">${escapar(idx)}</span><div class="hud-main">` +
  `<div class="hud-label">${escapar(label)}</div>${sub ? `<div class="hud-sub">${escapar(sub)}</div>` : ''}</div>` +
  `${tag ? `<span class="hud-tag">${escapar(tag)}</span>` : ''}</div>`

const titulo = (texto: string) => `<div class="hud-note hud-hot">${escapar(texto)}</div>`

const FASES_DO_AUTODEV: Record<string, string> = {
  proposto: 'aguardando confirmação',
  trabalhando: 'alterando o código',
  verificando: 'verificando',
  aplicando: 'reiniciando',
  testando: 'em teste, aguardando sua avaliação',
}

function noticias(d: DadosDoBomDia): string | null {
  const temas = (d.noticias ?? []).filter((t) => t.itens.length)
  if (!temas.length) return null
  return temas
    .map((t) => titulo(t.tema) + `<div class="hud-rows">${t.itens.map((n, i) => linha(String(i + 1), n.titulo, n.fonte)).join('')}</div>`)
    .join('')
}

function agenda(d: DadosDoBomDia): string | null {
  const eventos = d.agenda?.disponivel ? (d.agenda.eventos ?? []) : []
  if (!eventos.length) return null
  return `<div class="hud-rows">${eventos.map((e) => linha(e.hora ?? 'dia', e.titulo, e.local)).join('')}</div>`
}

function desenvolvimento(d: DadosDoBomDia): string | null {
  const partes: string[] = []
  const dev = d.desenvolvimento
  const a = dev?.autodev
  if (dev?.avisos?.length) {
    partes.push(titulo('Avisos') + `<div class="hud-rows">${dev.avisos.map((t) => linha('!', t)).join('')}</div>`)
  }
  if (a && a.fase !== 'ocioso') {
    partes.push(titulo('Em andamento') + `<div class="hud-rows">${linha('▸', a.pedido ?? 'alteração', FASES_DO_AUTODEV[a.fase] ?? a.fase)}</div>`)
  }
  const prs = d.tarefas?.disponivel ? (d.tarefas.prs ?? []) : []
  if (prs.length) {
    partes.push(
      titulo('Pull requests abertos') +
        `<div class="hud-rows">${prs.map((p) => linha(`#${p.number}`, p.title, p.headRefName, p.isDraft ? 'rascunho' : 'aberto')).join('')}</div>`,
    )
  }
  const issues = d.tarefas?.disponivel ? (d.tarefas.issues ?? []) : []
  if (issues.length) {
    partes.push(titulo('Issues') + `<div class="hud-rows">${issues.map((i) => linha(`#${i.number}`, i.title)).join('')}</div>`)
  }
  for (const e of dev?.etapas ?? []) {
    const resto = e.total - e.itens.length
    partes.push(
      titulo(e.etapa) +
        `<div class="hud-rows">${e.itens.map((item) => linha('·', item)).join('')}` +
        `${resto > 0 ? `<div class="hud-sub">e mais ${resto}</div>` : ''}</div>`,
    )
  }
  if (!partes.length) return null
  // A branch só interessa quando há outra coisa a mostrar.
  if (dev?.branch) partes.unshift(`<div class="hud-sub">no ar: ${escapar(dev.branch)}</div>`)
  return partes.join('')
}

/** Os popups que têm conteúdo, na ordem em que entram na diagonal. */
export function popupsDoBomDia(d: DadosDoBomDia): Blade[] {
  const partes: [string, string, string | null][] = [
    ['noticias', 'NOTÍCIAS DO DIA', noticias(d)],
    ['agenda', 'COMPROMISSOS', agenda(d)],
    ['desenvolvimento', 'DESENVOLVIMENTO', desenvolvimento(d)],
  ]
  return partes
    .filter((p): p is [string, string, string] => Boolean(p[2]))
    .map(([id, title, html], cascata) => ({
      id: `${PREFIXO_DO_BOM_DIA}${id}`,
      title,
      kind: 'markup',
      html,
      size: 'compact',
      hold: 'sticky',
      cascata,
    }))
}

/** O que a voz precisa saber dos popups, para falar deles sem lê-los. */
export function descreverPopups(popups: Blade[]): string {
  if (!popups.length) return ''
  return `Na tela, em popups: ${popups.map((p) => p.title.toLowerCase()).join(', ')}.`
}

/**
 * O que a voz sabe da música. Sem ela, o motivo vai junto: calado, ele não saberia
 * explicar depois por que o bom dia veio sem rock. No celular não há tocador
 * (docs/adr/0037): o silêncio ali é o esperado, e não uma falha a relatar.
 */
function sobreAMusica(r: ResumoDoBomDia, onde: OndeEhOBomDia): string {
  if (onde === 'celular') {
    return (
      'Você está no celular, e o rock do bom dia só toca no computador: não anuncie música ' +
      'nem diga que faltou alguma coisa. Se ele perguntar da música, diga que ela fica no computador. '
    )
  }
  if (r.musica) return 'A música já está tocando baixinho por baixo: não a anuncie, a não ser que ele pergunte. '
  if (r.avisoDaMusica) {
    return (
      `A música não tocou hoje: ${r.avisoDaMusica}. No fim do resumo, diga isso em uma frase simples, ` +
      'com o que resolve, sem ler comandos letra por letra. Se ele perguntar, explique esse motivo. '
    )
  }
  return ''
}

/** O que o sistema avisa (a noite de trabalho, a âncora velha), dito depois dos compromissos. */
function avisosDoSistema(r: ResumoDoBomDia): string {
  const avisos = r.desenvolvimento?.avisos ?? []
  if (!avisos.length) return ''
  return `Avisos do sistema, para dizer depois dos compromissos, uma frase cada: ${avisos.join(' ')}\n`
}

/**
 * A narração do bom dia, com o resumo da A.U.R.O.R.A. e o que fazer depois dele.
 * É a mesma no PC e no celular, tirando a música e os botões que só o PC tem.
 */
export function instrucaoDoBomDia(r: ResumoDoBomDia, popups: Blade[], onde: OndeEhOBomDia): string {
  return (
    `${r.texto ?? ''}\n${descreverPopups(popups)}\n${avisosDoSistema(r)}\nDê bom dia ao Ricardo e resuma isso em até 30 segundos, ` +
    'como um assistente que conhece a rotina dele: compromissos primeiro, um destaque por tema ' +
    'de notícia, o GitHub numa frase. Os detalhes já estão nos popups: não leia listas. ' +
    sobreAMusica(r, onde) +
    'Se ele agradecer, despeça-se em poucas palavras: a tela fecha os popups e entra em espera ' +
    'sozinha. Se ele mudar de assunto, chame ajustar_interface com popups "minimizar" antes ' +
    'de responder; se ele perguntar de uma notícia ou de um compromisso, os popups ficam. ' +
    'Termine o resumo com uma pergunta curta, como se quer detalhar alguma notícia, e ' +
    'espere: a conversa continua.' +
    (onde === 'pc'
      ? ' A voz dele por cima da música é para você: não use ignorar_fala por causa da música.'
      : '')
  )
}

/** O recado quando o resumo não veio, igual nos dois lados. */
export const semOBomDia = (motivo?: string) =>
  `O resumo do dia não veio (${motivo ?? 'sem detalhe'}). Dê bom dia normalmente, sem resumo.`
