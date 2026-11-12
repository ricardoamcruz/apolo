/**
 * A agenda do dia, lida do link .ics que o Outlook.com publica.
 *
 * Sem registro de app: o link já é a credencial (quem o tem lê a agenda), então
 * ele mora no .env.local e nunca vai para log. O formato é iCalendar; daqui só
 * sai o que acontece hoje, no fuso do Ricardo.
 *
 * Horários com TZID são tratados como horário local do Ricardo: o Outlook usa
 * nomes de fuso do Windows, e a agenda dele é toda no mesmo fuso. Recorrência
 * cobre o que o Outlook mais gera: diária e semanal (com BYDAY), com INTERVAL,
 * UNTIL, COUNT aproximado e EXDATE.
 */

export const FUSO = 'America/Sao_Paulo'
const DIAS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/** AAAAMMDD de um instante, no fuso dado. */
export function diaNoFuso(instante, fuso = FUSO) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(instante)
      .map((x) => [x.type, x.value]),
  )
  return `${p.year}${p.month}${p.day}`
}

const horaNoFuso = (instante, fuso = FUSO) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit', hour12: false }).format(instante)

/** Junta as linhas dobradas e separa propriedade, parâmetros e valor. */
function linhas(texto) {
  return texto
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
    .map((l) => {
      const i = l.indexOf(':')
      if (i < 0) return null
      const [nome, ...params] = l.slice(0, i).split(';')
      return { nome: nome.toUpperCase(), params: params.join(';'), valor: l.slice(i + 1) }
    })
    .filter(Boolean)
}

const desescapar = (v) => v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim()

/** Um DTSTART vira { dia: 'AAAAMMDD', hora: 'HH:MM' | null }. */
function quando({ params, valor }, fuso) {
  if (/VALUE=DATE(?!-)/.test(params) || /^\d{8}$/.test(valor)) return { dia: valor.slice(0, 8), hora: null }
  const m = /^(\d{8})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(valor)
  if (!m) return null
  if (m[5]) {
    const d = new Date(`${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6)}T${m[2]}:${m[3]}:${m[4]}Z`)
    return { dia: diaNoFuso(d, fuso), hora: horaNoFuso(d, fuso) }
  }
  return { dia: m[1], hora: `${m[2]}:${m[3]}` }
}

const paraData = (dia) => new Date(Date.UTC(+dia.slice(0, 4), +dia.slice(4, 6) - 1, +dia.slice(6, 8)))
const diasEntre = (a, b) => Math.round((paraData(b) - paraData(a)) / 86_400_000)

/** A regra de recorrência acontece neste dia? */
function repeteEm(regra, inicio, dia) {
  const r = Object.fromEntries(regra.split(';').map((p) => p.split('=')))
  const intervalo = Number(r.INTERVAL ?? 1)
  const passados = diasEntre(inicio, dia)
  if (passados < 0) return false
  if (r.UNTIL && dia > r.UNTIL.slice(0, 8)) return false
  if (r.FREQ === 'DAILY') {
    if (passados % intervalo) return false
    return !r.COUNT || passados / intervalo < Number(r.COUNT)
  }
  if (r.FREQ === 'WEEKLY') {
    const semanaDia = DIAS[paraData(dia).getUTCDay()]
    const byday = r.BYDAY ? r.BYDAY.split(',').map((d) => d.slice(-2)) : [DIAS[paraData(inicio).getUTCDay()]]
    if (!byday.includes(semanaDia)) return false
    const semanas = Math.floor((passados + paraData(inicio).getUTCDay()) / 7)
    if (semanas % intervalo) return false
    return !r.COUNT || semanas / intervalo < Math.ceil(Number(r.COUNT) / byday.length)
  }
  return false
}

/** Os eventos de um dia (AAAAMMDD), em ordem de horário; os de dia inteiro antes. */
export function eventosDoDia(ics, dia, fuso = FUSO) {
  const eventos = []
  let atual = null
  for (const l of linhas(ics)) {
    if (l.nome === 'BEGIN' && l.valor === 'VEVENT') atual = { excecoes: [] }
    else if (l.nome === 'END' && l.valor === 'VEVENT') {
      if (atual?.inicio && atual.status !== 'CANCELLED') {
        const hoje = atual.inicio.dia === dia || (atual.regra && repeteEm(atual.regra, atual.inicio.dia, dia))
        if (hoje && !atual.excecoes.includes(dia)) {
          eventos.push({ titulo: atual.titulo?.trim() || 'compromisso sem título', hora: atual.inicio.hora, local: atual.local || null })
        }
      }
      atual = null
    } else if (atual) {
      if (l.nome === 'SUMMARY') atual.titulo = desescapar(l.valor)
      else if (l.nome === 'LOCATION') atual.local = desescapar(l.valor)
      else if (l.nome === 'DTSTART') atual.inicio = quando(l, fuso)
      else if (l.nome === 'RRULE') atual.regra = l.valor
      else if (l.nome === 'STATUS') atual.status = l.valor.toUpperCase()
      else if (l.nome === 'EXDATE') atual.excecoes.push(...l.valor.split(',').map((v) => quando({ params: l.params, valor: v }, fuso)?.dia))
    }
  }
  return eventos.sort((a, b) => (a.hora ?? '').localeCompare(b.hora ?? ''))
}

/** Baixa o .ics e devolve os eventos de hoje. */
export async function agendaDeHoje(url, { fetcher = fetch, agora = new Date(), fuso = FUSO } = {}) {
  if (!url) return { disponivel: false, motivo: 'falta APOLO_AGENDA_ICS no .env.local' }
  const r = await fetcher(url, { signal: AbortSignal.timeout(10_000) })
  if (!r.ok) return { disponivel: false, motivo: `o Outlook respondeu ${r.status}` }
  return { disponivel: true, eventos: eventosDoDia(await r.text(), diaNoFuso(agora, fuso), fuso) }
}
