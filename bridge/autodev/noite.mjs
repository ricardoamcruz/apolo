/**
 * O modo noturno (docs/adr/0040): o autodesenvolvimento trabalha sozinho, item por
 * item, enquanto o Ricardo dorme.
 *
 *   planejada → rodando → encerrando → terminada
 *
 * Um "confirmo" falado no começo, conferido na transcrição, autoriza a noite
 * inteira. Cada item passa pelo ciclo de sempre (worktree, checagens, a Fênix põe
 * no ar e observa), com três diferenças: a observação dura 3 minutos, quem aprova
 * é esta noite (se ficou de pé), e o arquivo sensível vai ao ar e é marcado no
 * relatório. O que está em TRAVAS_DA_NOITE nunca muda: o item para como "precisa de
 * você". De manhã, a branch vai ao GitHub com um pull request em rascunho.
 *
 * A ponte reinicia a cada item que vai ao ar: o estado fica em disco e a noite
 * continua de onde parou.
 *
 * Trava da noite (bridge/autodev/politica.mjs): a noite não muda os próprios limites.
 */
import { spawn as spawnPadrao } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'

export const LIMITES = { itens: 6, tentativas: 3, maximoDeItens: 10 }
/** A observação de cada item no ar, no lugar dos 30 s do dia. */
export const OBSERVAR_MS = 3 * 60_000
/** Quanto tempo o plano lido vale para o "confirmo". */
export const PLANO_MS = 3 * 60_000
/** Entre um item e o próximo: a Fênix pode renascer depois de uma aprovação. */
export const PAUSA_MS = 15_000
/** O relatório da noite vale para o bom dia por este tempo. */
export const RELATORIO_VALE_MS = 20 * 60 * 60_000

const ESPERANDO = 'esperando'
const ATIVOS = new Set(['planejada', 'rodando', 'encerrando'])

/**
 * A hora de parar: "06:30", "6h30", "6h" ou "6". A próxima vez que ela acontece
 * depois de agora; sem nada, 6h30.
 */
export function horaDeParar(texto, agora = new Date()) {
  const m = /^\s*(\d{1,2})\s*(?:[:h]\s*(\d{2})?)?\s*(?:h|horas?)?\s*$/i.exec(String(texto ?? '').trim() || '06:30')
  const hora = m ? Number(m[1]) : 6
  const minuto = m?.[2] ? Number(m[2]) : m ? 0 : 30
  if (hora > 23 || minuto > 59) return null
  const alvo = new Date(agora)
  alvo.setHours(hora, minuto, 0, 0)
  if (alvo.getTime() <= agora.getTime() + 30 * 60_000) alvo.setDate(alvo.getDate() + 1)
  return alvo.getTime()
}

export const itensDoTexto = (texto) =>
  String(texto ?? '')
    .split(/[;\n]+/)
    .map((t) => t.trim().replace(/^item\s+/i, ''))
    .filter(Boolean)

const hhmm = (t) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
const ddmm = (t) => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
const minutos = (ms) => Math.max(1, Math.round(ms / 60_000))
const curto = (sha) => String(sha ?? '').slice(0, 7)

/** O relatório da noite, em markdown: o corpo do pull request. */
export function relatorioDaNoite(n) {
  const feitos = n.itens.filter((i) => i.status === 'feito')
  const fora = n.itens.filter((i) => i.status !== 'feito')
  const linhas = [
    `## Modo noturno de ${ddmm(n.iniciadaEm)}`,
    '',
    `Começou às ${hhmm(n.iniciadaEm)} e terminou às ${hhmm(n.terminadaEm ?? Date.now())} (${n.motivoDoFim ?? 'em andamento'}).` +
      (n.branch ? ` Branch: \`${n.branch}\`.` : ''),
    '',
    '### Entrou',
    ...(feitos.length
      ? feitos.map(
          (i) =>
            `- **${i.n}. ${i.titulo}** — commit \`${curto(i.commit)}\`, ${i.tentativas} ${i.tentativas === 1 ? 'tentativa' : 'tentativas'}, ${minutos((i.fim ?? 0) - (i.inicio ?? 0))} min.` +
            (i.sensiveis?.length ? ` ⚠ **Arquivos sensíveis:** ${i.sensiveis.map((f) => `\`${f}\``).join(', ')}.` : ''),
        )
      : ['- Nada.']),
    '',
    '### Ficou de fora',
    ...(fora.length
      ? fora.map((i) => {
          const porque =
            i.status === 'precisa' ? 'precisa de você' : i.status === ESPERANDO ? 'não chegou a vez' : `descartado depois de ${i.tentativas} ${i.tentativas === 1 ? 'tentativa' : 'tentativas'}`
          return `- **${i.n}. ${i.titulo}** — ${porque}${i.motivo ? `: ${String(i.motivo).split('\n')[0].slice(0, 300)}` : ''}`
        })
      : ['- Nada.']),
    '',
    '### Conferência final',
    n.conferencia ? (n.conferencia.ok ? 'Lint, tipos, build e testes: ✔' : `✖ ${String(n.conferencia.motivo).split('\n')[0]}`) : 'Não rodou.',
    '',
    'O merge é revisão do Ricardo. Para tirar a branch do ar: "volta para a main".',
    '',
    '🤖 Gerado pelo modo noturno do A.P.O.L.O.',
  ]
  return linhas.join('\n')
}

/** Em três frases, para o bom dia e para o aviso. */
export function resumoFalado(n) {
  const feitos = n.itens.filter((i) => i.status === 'feito').length
  const fora = n.itens.length - feitos
  const sensiveis = n.itens.some((i) => i.status === 'feito' && i.sensiveis?.length)
  const partes = [
    `Esta noite eu fiz ${feitos} de ${n.itens.length} ${n.itens.length === 1 ? 'item' : 'itens'}${fora ? `, e ${fora} ficaram de fora` : ''}.`,
  ]
  if (n.pr) partes.push(`O pull request em rascunho está aberto para você revisar${sensiveis ? ', com arquivos sensíveis marcados' : ''}.`)
  else if (feitos) partes.push(`A branch está pronta${sensiveis ? ', com arquivos sensíveis marcados' : ''}, mas o pull request não saiu.`)
  if (n.conferencia && !n.conferencia.ok) partes.push('A conferência final falhou: veja o relatório antes de qualquer merge.')
  return partes.join(' ')
}

/**
 * @param arquivo      onde a noite fica em disco
 * @param autodev      o autodesenvolvimento (bridge/autodev/index.mjs)
 * @param backlog      os itens abertos do roadmap
 * @param fenix        pede algo à Fênix e espera a resposta
 * @param branchNoAr   a branch no ar agora ("" num commit solto)
 * @param ancoraNoAr   a âncora está no ar? Então a noite não começa
 * @param podeEnviar   --writes: o envio e o pull request da manhã
 * @param abrirPr      `{ title, body, branch, rascunho }` → `{ ok, texto }`
 * @param conferir     a conferência completa de uma branch → `{ ok, motivo? }`
 * @param avisar       a central de notificações (só frases)
 * @param aoMudar      recebe o resumo a cada mudança
 */
export function criarNoite({
  arquivo,
  autodev,
  backlog = async () => [],
  pedidoDaTarefa = (item) => item.texto,
  fenix = async () => ({ ok: false, mensagem: 'sem Fênix' }),
  fenixConectada = () => false,
  branchNoAr = async () => '',
  shaNoAr = async () => '',
  ancoraNoAr = async () => false,
  podeEnviar = false,
  abrirPr = null,
  conferir = async () => ({ ok: true }),
  avisar = () => {},
  aoMudar = () => {},
  agora = () => Date.now(),
  spawn = spawnPadrao,
  pausaMs = PAUSA_MS,
  log = console.log,
}) {
  let noite = null
  try {
    noite = JSON.parse(readFileSync(arquivo, 'utf8'))
  } catch {
    /* nenhuma noite */
  }
  let proximoTimer = null
  let ocupado = false
  let eventos = 0

  const gravar = () => {
    try {
      writeFileSync(arquivo, JSON.stringify(noite, null, 2))
    } catch (err) {
      log(`[noite] não consegui gravar: ${err.message}`)
    }
    aoMudar(resumo())
  }
  /** O que aconteceu agora, para a voz contar quando ele estiver acordado. */
  const evento = (texto) => {
    log(`[noite] ${texto}`)
    noite.evento = { id: `${noite.id}-${++eventos}-${agora()}`, texto, em: agora() }
  }

  const rodando = () => noite?.fase === 'rodando'
  const atual = () => noite?.itens?.find((i) => i.status === 'trabalhando') ?? null

  function resumo() {
    if (!noite) return null
    return {
      ativa: ATIVOS.has(noite.fase),
      fase: noite.fase,
      silencio: Boolean(noite.silencio) && ATIVOS.has(noite.fase),
      ate: noite.ate ?? noite.plano?.ate ?? null,
      itens: (noite.itens ?? []).map(({ n, titulo, status, tentativas }) => ({ n, titulo, status, tentativas })),
      evento: noite.evento ?? null,
    }
  }

  const cafe = {
    ligar(ateMs) {
      try {
        const filho = spawn('caffeinate', ['-i', '-t', String(Math.ceil((ateMs - agora()) / 1000) + 3600)], { detached: true, stdio: 'ignore' })
        filho.unref?.()
        return filho.pid ?? null
      } catch {
        return null
      }
    },
    desligar(pid) {
      if (!pid) return
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        /* já saiu */
      }
    },
  }

  /** O que impede a noite de começar; vazio se nada. */
  async function impedimento() {
    const a = autodev.estado()
    if (!a.ligado) return 'O modo noturno precisa do autodesenvolvimento: inicie com npm start -- --autodev --writes.'
    if (!podeEnviar) return 'O modo noturno precisa de --writes, para enviar a branch e abrir o pull request de manhã.'
    if (!fenixConectada()) return 'O modo noturno precisa da Fênix no ar (npm start).'
    if (await ancoraNoAr()) return 'A âncora está no ar: depois de um pânico, a noite não começa. Volte para a main primeiro.'
    if (a.fase !== 'ocioso') return 'Há um trabalho do autodesenvolvimento em andamento: espere ele terminar.'
    if (rodando() || noite?.fase === 'encerrando') return 'Já há uma noite em andamento.'
    return ''
  }

  async function planejar({ itens, acompanhar, ate, maximo } = {}) {
    const motivo = await impedimento()
    if (motivo) return { ok: false, mensagem: motivo }
    const pedidos = itensDoTexto(itens)
    if (!pedidos.length) return { ok: false, mensagem: 'Diga os itens da noite: números do backlog ("1.3") ou pedidos completos, separados.' }
    const teto = Math.min(Math.max(Number.parseInt(maximo, 10) || LIMITES.itens, 1), LIMITES.maximoDeItens)
    const abertos = await backlog()
    const plano = []
    for (const texto of pedidos) {
      if (/^\d+\.\d+$/.test(texto)) {
        const item = abertos.find((i) => i.id === texto)
        if (!item) return { ok: false, mensagem: `Não há item ${texto} aberto no backlog. Nada foi planejado.` }
        plano.push({ titulo: `${item.id}: ${item.texto}`.slice(0, 120), pedido: pedidoDaTarefa(item) })
      } else if (texto.length < 12) {
        return { ok: false, mensagem: `"${texto}" não descreve uma alteração. Diga o pedido completo. Nada foi planejado.` }
      } else {
        plano.push({ titulo: texto.slice(0, 120), pedido: texto })
      }
    }
    const fim = horaDeParar(ate, new Date(agora()))
    if (!fim) return { ok: false, mensagem: `Não entendi a hora de parar "${ate}". Diga como 06:30.` }
    const sobram = plano.length - teto
    noite = {
      id: new Date(agora()).toISOString().replace(/\D/g, '').slice(0, 12),
      fase: 'planejada',
      plano: { itens: plano.slice(0, teto), ate: fim, acompanhar: acompanhar === 'ficar' ? 'ficar' : 'dormir', criadoEm: agora() },
    }
    gravar()
    const lista = noite.plano.itens.map((p, i) => `${i + 1}) ${p.titulo}`).join('; ')
    return {
      ok: true,
      mensagem:
        `Plano da noite, ainda sem começar: ${noite.plano.itens.length} ${noite.plano.itens.length === 1 ? 'item' : 'itens'} — ${lista}.` +
        (sobram > 0 ? ` ${sobram} ficaram de fora pelo limite de ${teto}.` : '') +
        ` Paro às ${hhmm(fim)}, com até ${LIMITES.tentativas} tentativas por item e 3 minutos de observação de cada um no ar. ` +
        'Arquivos sensíveis vão ao ar e ficam marcados; as travas de segurança nunca mudam. ' +
        `${noite.plano.acompanhar === 'ficar' ? 'Vou contar cada passo em voz.' : 'A voz fica muda até de manhã.'} ` +
        'De manhã, a branch vai ao GitHub com um pull request em rascunho. ' +
        'Leia isso em duas ou três frases e pergunte se ele confirma; só depois do "confirmo", chame modo_noturno com acao "comecar".',
    }
  }

  async function comecar() {
    if (noite?.fase !== 'planejada') return { ok: false, mensagem: 'Não há plano esperando: chame modo_noturno com acao "planejar" primeiro.' }
    if (agora() - noite.plano.criadoEm > PLANO_MS) {
      noite = null
      rmSync(arquivo, { force: true })
      return { ok: false, mensagem: 'O plano passou de 3 minutos sem o sim: planeje de novo.' }
    }
    const motivo = await impedimento()
    if (motivo) return { ok: false, mensagem: motivo }
    const r = await fenix({ type: 'versao:noite', acao: 'comecar', ate: noite.plano.ate })
    if (!r?.ok) return { ok: false, mensagem: `A Fênix não autorizou a noite: ${r?.mensagem ?? 'sem resposta'}` }
    const base = await branchNoAr()
    noite = {
      ...noite,
      fase: 'rodando',
      ate: noite.plano.ate,
      silencio: noite.plano.acompanhar === 'dormir',
      base,
      branch: base && base !== 'main' ? base : null,
      iniciadaEm: agora(),
      itens: noite.plano.itens.map((p, i) => ({ n: i + 1, titulo: p.titulo, pedido: p.pedido, status: ESPERANDO, tentativas: 0 })),
    }
    noite.cafe = cafe.ligar(noite.ate)
    evento(`A noite começou: ${noite.itens.length} ${noite.itens.length === 1 ? 'item' : 'itens'}, até as ${hhmm(noite.ate)}.`)
    gravar()
    agendar(0)
    return {
      ok: true,
      mensagem: `A noite começou. ${noite.silencio ? 'Diga boa noite em uma frase: de agora em diante você fica em silêncio até de manhã.' : 'Diga em uma frase que vai contar cada passo.'}`,
    }
  }

  function agendar(ms = pausaMs) {
    clearTimeout(proximoTimer)
    proximoTimer = setTimeout(() => void proximo(), ms)
    proximoTimer.unref?.()
  }

  /** Por que a noite acaba agora; vazio se ela segue. */
  async function fimDaNoite() {
    if (noite.pararPedido) return 'pedido do Ricardo'
    if (agora() >= noite.ate) return 'hora de parar'
    if (await ancoraNoAr()) return 'a âncora foi acionada'
    if (noite.branch) {
      const noAr = await branchNoAr()
      if (noAr && noAr !== noite.branch && !noAr.startsWith('autodev/')) return `a versão no ar deixou de ser a da noite (está na ${noAr})`
    }
    if (!noite.itens.some((i) => i.status === ESPERANDO)) return 'fim dos itens'
    return ''
  }

  async function proximo() {
    if (!rodando() || ocupado || atual()) return
    if (autodev.estado().fase !== 'ocioso') return agendar()
    ocupado = true
    try {
      const fim = await fimDaNoite()
      if (fim) return void (await encerrar(fim))
      const item = noite.itens.find((i) => i.status === ESPERANDO)
      item.status = 'trabalhando'
      item.tentativas += 1
      item.inicio ??= agora()
      const pedido = item.motivoAnterior
        ? `${item.pedido}\n\nA tentativa anterior não deu certo: ${String(item.motivoAnterior).slice(0, 1500)}\nComece de novo, corrigindo isso.`
        : item.pedido
      gravar()
      const proposta = await autodev.acao('propor', { pedido })
      const confirmada = proposta.ok ? await autodev.acao('confirmar') : proposta
      if (!confirmada.ok) {
        // O que impede um item impede todos: a cópia suja, um commit solto.
        const geral = /não commitadas|commit solto|não é a main nem uma branch de fase|atrás do GitHub|desligado/.test(confirmada.mensagem)
        item.status = geral ? ESPERANDO : 'descartado'
        item.motivo = confirmada.mensagem
        if (geral) item.tentativas -= 1
        gravar()
        if (geral) return void (await encerrar(`não deu para começar: ${confirmada.mensagem}`))
        return agendar()
      }
      item.autodevId = autodev.estado().id
      evento(`Comecei o item ${item.n}${item.tentativas > 1 ? `, tentativa ${item.tentativas}` : ''}: ${item.titulo}.`)
      gravar()
    } catch (err) {
      log(`[noite] falha ao começar um item: ${err.message}`)
      agendar()
    } finally {
      ocupado = false
    }
  }

  /** Cada mudança do autodesenvolvimento: aprova o que ficou de pé e conta o resto. */
  async function aoAutodev(a) {
    if (!rodando()) return
    const item = atual()
    if (!item?.autodevId) return
    if (a.fase === 'testando' && a.id === item.autodevId && !item.aprovando) {
      // Ficou de pé os 3 minutos: a noite aprova, no lugar do "aprovo" falado.
      item.aprovando = true
      item.sensiveis = a.sensiveis ?? []
      gravar()
      const r = await autodev.acao('aprovar')
      if (!r.ok) log(`[noite] a aprovação foi recusada: ${r.mensagem}`)
      return
    }
    const r = a.resultado
    if (a.fase !== 'ocioso' || !r || r.id !== item.autodevId) return
    item.aprovando = undefined
    item.fim = agora()
    if (r.tipo === 'aprovado') {
      item.status = 'feito'
      item.commit = await shaNoAr()
      if (r.branch) noite.branch = r.branch
      evento(`O item ${item.n} entrou: ${item.titulo}.`)
    } else {
      item.motivo = r.mensagem
      if (/^Precisa de você/.test(r.mensagem ?? '')) item.status = 'precisa'
      else if (item.tentativas < LIMITES.tentativas && !noite.pararPedido) {
        item.status = ESPERANDO
        item.motivoAnterior = r.mensagem
      } else item.status = 'descartado'
      evento(
        item.status === ESPERANDO
          ? `O item ${item.n} não deu certo na tentativa ${item.tentativas}; vou tentar de novo.`
          : item.status === 'precisa'
            ? `O item ${item.n} precisa de você: ele mexe no que a noite não muda.`
            : `Desisti do item ${item.n} depois de ${item.tentativas} tentativas.`,
      )
    }
    gravar()
    agendar()
  }

  async function encerrar(motivo) {
    if (!noite || noite.fase === 'terminada') return
    clearTimeout(proximoTimer)
    noite.fase = 'encerrando'
    noite.motivoDoFim = motivo
    evento(`A noite está terminando (${motivo}): conferindo e enviando.`)
    gravar()
    cafe.desligar(noite.cafe)
    await fenix({ type: 'versao:noite', acao: 'terminar' }).catch(() => {})
    const feitos = noite.itens.filter((i) => i.status === 'feito')
    if (feitos.length && noite.branch) {
      noite.conferencia = await conferir(noite.branch).catch((err) => ({ ok: false, motivo: err.message }))
      noite.terminadaEm = agora()
      if (podeEnviar && abrirPr) {
        const pr = await abrirPr({
          title: `Modo noturno de ${ddmm(noite.iniciadaEm)}: ${feitos.length} ${feitos.length === 1 ? 'item' : 'itens'}`,
          body: relatorioDaNoite(noite),
          branch: noite.branch,
          rascunho: true,
        }).catch((err) => ({ ok: false, texto: err.message }))
        noite.pr = pr.ok ? (String(pr.texto).match(/https:\/\/\S+/)?.[0]?.replace(/[.:]$/, '') ?? 'aberto') : null
        if (!pr.ok) noite.motivoDoPr = pr.texto
      }
    }
    noite.terminadaEm = agora()
    noite.fase = 'terminada'
    noite.relatorio = relatorioDaNoite(noite)
    const falado = resumoFalado(noite)
    evento(falado)
    gravar()
    void avisar({ titulo: 'A.P.O.L.O.: o modo noturno terminou', texto: falado, prioridade: 'normal' })
  }

  return {
    resumo,
    rodando,
    /** Para o autodev: o item em curso é da noite? Então vale o jeito da noite. */
    deNoite: () => rodando() && Boolean(atual()),
    silencio: () => Boolean(noite?.silencio) && ATIVOS.has(noite?.fase),
    aoAutodev,
    /** O relatório para o bom dia, enquanto ele é notícia. */
    relatorioDoBomDia() {
      if (noite?.fase !== 'terminada' || agora() - (noite.terminadaEm ?? 0) > RELATORIO_VALE_MS) return null
      return resumoFalado(noite)
    },
    /** Depois de a ponte reiniciar: a noite continua de onde parou. */
    retomar() {
      if (noite?.fase === 'encerrando') return void encerrar(noite.motivoDoFim ?? 'retomada')
      if (!rodando()) return
      const a = autodev.estado()
      if (atual()) return void aoAutodev(a)
      agendar(pausaMs)
    },
    /** Uma ação da voz. */
    async acao(etapa, args = {}) {
      if (etapa === 'planejar') return planejar(args)
      if (etapa === 'comecar') return comecar()
      if (etapa === 'estado') {
        if (!noite) return { ok: true, mensagem: 'Nenhuma noite planejada.' }
        if (noite.fase === 'terminada') return { ok: true, mensagem: resumoFalado(noite) }
        if (noite.fase === 'planejada') return { ok: true, mensagem: 'Há um plano esperando o "confirmo".' }
        const feitos = noite.itens.filter((i) => i.status === 'feito').length
        const agoraItem = atual()
        return {
          ok: true,
          mensagem: `A noite está ${noite.fase === 'encerrando' ? 'terminando' : 'rodando'}: ${feitos} de ${noite.itens.length} itens feitos${agoraItem ? `; agora o item ${agoraItem.n}, tentativa ${agoraItem.tentativas}` : ''}. Paro às ${hhmm(noite.ate)}.`,
        }
      }
      if (etapa === 'parar') {
        if (noite?.fase === 'planejada') {
          noite = null
          rmSync(arquivo, { force: true })
          aoMudar(null)
          return { ok: true, mensagem: 'O plano da noite foi descartado.' }
        }
        if (!rodando()) return { ok: false, mensagem: 'Não há noite rodando.' }
        noite.pararPedido = true
        gravar()
        if (atual() && ['trabalhando', 'verificando'].includes(autodev.estado().fase)) await autodev.acao('cancelar')
        else if (!atual()) agendar(0)
        return { ok: true, mensagem: 'Vou parar a noite: o que já ficou bom vai para o pull request em rascunho.' }
      }
      if (etapa === 'falar' || etapa === 'silencio') {
        if (!noite || !ATIVOS.has(noite.fase)) return { ok: false, mensagem: 'Não há noite rodando.' }
        noite.silencio = etapa === 'silencio'
        gravar()
        return { ok: true, mensagem: noite.silencio ? 'Fico em silêncio até de manhã.' : 'Vou contar cada passo.' }
      }
      return { ok: false, mensagem: `Ação desconhecida do modo noturno: ${etapa}.` }
    },
  }
}
