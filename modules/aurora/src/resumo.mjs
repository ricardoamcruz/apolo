/**
 * O bom dia inteiro: a faixa de rock e o resumo do dia, cada parte independente.
 * Uma parte que falha vira um motivo, nunca derruba as outras.
 */
import { agendaDeHoje } from './agenda.mjs'
import { tarefasDoGithub } from './github.mjs'
import { noticiasDoDia } from './noticias.mjs'

export const PENDENCIAS = ['e-mails e Microsoft To Do: falta um app registrado na Microsoft (exige diretório no Azure)']

export async function bomDia({ config, youtube, agendaIcs, fetcher = fetch, agora = new Date(), rodarGh }) {
  const m = config.musica ?? {}
  const [musica, agenda, noticias, tarefas] = await Promise.all([
    youtube?.autorizado()
      ? youtube
          .sortear({ playlists: m.playlists ?? [], filtro: m.filtroDePlaylist ?? 'rock' })
          .then((f) => (f ? { ...f, trechoSegundos: m.trechoSegundos ?? 35, volume: m.volume ?? 18 } : null))
          .catch((err) => ({ erro: err.message }))
      : Promise.resolve({ erro: 'o YouTube ainda não foi autorizado (npm run aurora:autorizar)' }),
    agendaDeHoje(agendaIcs, { fetcher, agora }).catch((err) => ({ disponivel: false, motivo: err.message })),
    noticiasDoDia(config.noticias?.temas ?? [], { porTema: config.noticias?.porTema ?? 3, fetcher }),
    tarefasDoGithub(config.tarefas?.github, rodarGh ? { rodar: rodarGh } : {}),
  ])
  return { musica: musica?.erro ? null : musica, avisoDaMusica: musica?.erro ?? null, agenda, noticias, tarefas, pendencias: PENDENCIAS }
}

/** O texto que a voz recebe para narrar. Curto, em tópicos, sem links. */
export function textoParaVoz(r, agora = new Date()) {
  const partes = []
  const data = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: 'numeric', month: 'long' }).format(agora)
  partes.push(`Hoje é ${data}.`)
  if (r.agenda?.disponivel) {
    partes.push(
      r.agenda.eventos.length
        ? `Agenda: ${r.agenda.eventos.map((e) => `${e.hora ?? 'dia inteiro'}, ${e.titulo}${e.local ? ` (${e.local})` : ''}`).join('; ')}.`
        : 'Agenda: nada marcado para hoje.',
    )
  } else partes.push(`Agenda indisponível: ${r.agenda?.motivo ?? 'sem detalhe'}.`)
  for (const n of r.noticias ?? []) {
    if (n.itens.length) partes.push(`${n.tema}: ${n.itens.map((i) => i.titulo).join(' | ')}.`)
  }
  if (r.tarefas?.disponivel) {
    const { prs, issues } = r.tarefas
    partes.push(
      `GitHub: ${prs.length} PR${prs.length === 1 ? '' : 's'} aberto${prs.length === 1 ? '' : 's'}` +
        `${prs.length ? ` (${prs.map((p) => `#${p.number} ${p.title}`).join('; ')})` : ''}` +
        ` e ${issues.length} issue${issues.length === 1 ? '' : 's'}.`,
    )
  }
  if (r.musica) partes.push(`Tocando: ${r.musica.titulo}${r.musica.canal ? `, de ${r.musica.canal.replace(/ - Topic$/, '')}` : ''}.`)
  return partes.join('\n')
}
