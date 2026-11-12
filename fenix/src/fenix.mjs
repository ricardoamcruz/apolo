/**
 * A F.Ê.N.I.X. montada: guardiã, versões, rotinas e o canal, ligados entre si.
 *
 * Separado da linha de comando (../fenix.mjs) para os testes montarem uma Fênix
 * de verdade com serviços de mentira.
 */
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { freemem, loadavg, totalmem } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { criarAvisos } from './avisos.mjs'
import { criarCanal } from './canal.mjs'
import { criarComandos, montar, rodar } from './rotinas.mjs'
import { criarServicos } from './servicos.mjs'
import { criarVersoes } from './versoes.mjs'

const exec = promisify(execFile)

/** O token do canal: do ambiente, ou um guardado na pasta da Fênix, só para o usuário. */
export function garantirToken(pasta, env = process.env) {
  if (env.FENIX_TOKEN?.trim()) return env.FENIX_TOKEN.trim()
  mkdirSync(pasta, { recursive: true, mode: 0o700 })
  const arquivo = join(pasta, 'token')
  if (existsSync(arquivo)) {
    const salvo = readFileSync(arquivo, 'utf8').trim()
    if (salvo.length >= 32) return salvo
  }
  const token = randomBytes(32).toString('base64url')
  writeFileSync(arquivo, `${token}\n`, { mode: 0o600 })
  chmodSync(arquivo, 0o600)
  return token
}

/**
 * A receita do renascimento (docs/adr/0028): o que um serviço precisa para subir
 * esta Fênix de novo se ela morrer. Só dados: o comando, a pasta, onde escrever e
 * o que no ambiente é dela, e não do terminal. Quem a usa não importa nada daqui.
 */
export function receitaDoRenascimento(config, { comando, cwd, tokenDoAmbiente = false }) {
  const limpar = new Set()
  for (const f of Object.values(config.flags)) for (const k of Object.keys(f.ambiente)) limpar.add(k)
  for (const s of config.servicos) for (const k of Object.keys(s.ambiente)) limpar.add(k)
  // Com o token gerado em arquivo, a Fênix nova lê o mesmo arquivo; o do terminal fica.
  if (!tokenDoAmbiente) limpar.add('FENIX_TOKEN')
  return {
    comando,
    cwd,
    saida: join(config.pasta, 'fenix.log'),
    registro: join(config.pasta, 'renascimentos.log'),
    limpar: [...limpar],
  }
}

/**
 * @param config     o resultado de lerConfig
 * @param flags      as opções da linha de comando que existem no config (ex.: --writes)
 * @param renascer   `{ comando, cwd }`: como subir esta Fênix de novo (docs/adr/0028)
 * @param renascida  ela foi trazida de volta pelo A.P.O.L.O., e não iniciada à mão
 */
export function criarFenix(
  config,
  { flags = [], token, log = console.log, saida, tempos = config.tempos ?? {}, renascer = null, renascida = false } = {},
) {
  mkdirSync(config.pasta, { recursive: true })
  const ativas = flags.filter((f) => f in config.flags).map((f) => config.flags[f])
  const tls = config.tls
    ? { cert: readFileSync(config.tls.cert), key: readFileSync(config.tls.key) }
    : undefined
  const hostDoUrl = ['0.0.0.0', '::'].includes(config.escuta.host) ? 'localhost' : config.escuta.host
  const url = (porta) => `${tls ? 'wss' : 'ws'}://${hostDoUrl === '127.0.0.1' ? 'localhost' : hostDoUrl}:${porta}/fenix`

  let canal
  let porta = config.escuta.porta
  const receita = renascer
    ? JSON.stringify(receitaDoRenascimento(config, { ...renascer, tokenDoAmbiente: Boolean((config.ambiente ?? process.env).FENIX_TOKEN?.trim()) }))
    : null
  const ambiente = () => ({
    ...(config.ambiente ?? process.env),
    ...Object.assign({}, ...ativas.map((f) => f.ambiente)),
    FENIX_URL: url(porta),
    FENIX_TOKEN: token,
    // O pacto (docs/adr/0028): quem ela sobe sabe como revivê-la.
    FENIX_PID: String(process.pid),
    ...(receita ? { FENIX_RENASCER: receita } : {}),
  })

  let avisarEstado = null
  /** Quando cada serviço caiu e foi avisado pela última vez: um aviso a cada 10 min basta. */
  const ultimaQuedaAvisada = new Map()
  // Os botões das notificações (docs/adr/0027). Descartar só volta à versão segura.
  const avisos = criarAvisos({
    ...(config.notificacoes ?? {}),
    ca: config.notificacoes?.ca ? readFileSync(config.notificacoes.ca) : undefined,
    log,
    aoTocar: (acao) => {
      log(`[fenix] botão da notificação: ${acao}`)
      if (acao === 'descartar_versao') void versoes.reverter({ id: versoes.estado().id })
    },
  })
  const servicos = criarServicos({
    repo: config.repo,
    servicos: config.servicos,
    ambiente,
    log,
    saida,
    aoMudar: (nome, status, motivo) => {
      if (status === 'caiu' && motivo && Date.now() - (ultimaQuedaAvisada.get(nome) ?? 0) > 10 * 60_000) {
        ultimaQuedaAvisada.set(nome, Date.now())
        avisos.avisar({ titulo: `${config.nome}: ${nome} caiu`, texto: `O serviço ${nome} ${motivo}. Já estou subindo de novo.`, prioridade: 'alta' })
      }
      // Várias mudanças juntas viram um aviso só.
      clearTimeout(avisarEstado)
      avisarEstado = setTimeout(() => canal?.transmitir({ type: 'estado', ...estado() }), 200)
    },
    ...tempos.servicos,
  })

  const versoes = criarVersoes({
    repo: config.repo,
    pasta: config.pasta,
    ligar: () => servicos.versionados().forEach((n) => servicos.ligar(n)),
    desligar: () => Promise.all(servicos.versionados().map((n) => servicos.desligar(n))),
    saude: () => servicos.saudeGeral(),
    // O estado vai junto: quem recebe sabe se a alteração continua no ar.
    notificar: (r) => {
      canal?.avisar({ type: 'versao:resultado', ...r, versao: versoes.estado() })
      avisarResultado(r)
    },
    protecao: config.protecao,
    versaoSegura: config.versaoSegura,
    instalar: config.instalar,
    log,
    ...tempos.versoes,
  })

  servicos.definir({
    aoCair: (nome, motivo) => servicos.ehVersionado(nome) && versoes.servicoCaiu(nome, motivo),
    pausado: (nome) => servicos.ehVersionado(nome) && versoes.emTroca(),
  })

  const comandos = criarComandos({
    repo: config.repo,
    pasta: config.pasta,
    habilitado: ativas.some((f) => f.comandosLivres),
    bloqueio: () =>
      versoes.emTeste()
        ? 'Há uma alteração sem revisão no ar: aprove ou descarte antes de rodar comandos livres.'
        : null,
    prazoMs: config.comandos.prazoMs,
    validadeMs: config.comandos.validadeMs,
    ambiente: config.ambiente ?? process.env,
    log,
  })

  const rodando = new Set()

  /** O resultado de uma troca de versão também vai para o celular e para o Mac. */
  function avisarResultado({ tipo, mensagem, branch }) {
    const titulos = {
      em_teste: 'Alteração no ar para teste',
      aprovado: 'Alteração aprovada',
      revertido: 'Voltei à versão segura',
      falhou: 'A troca de versão falhou',
    }
    if (!titulos[tipo]) return
    avisos.avisar({
      titulo: `${config.nome}: ${titulos[tipo]}`,
      texto: branch ? `${mensagem} (${branch})` : mensagem,
      prioridade: tipo === 'revertido' || tipo === 'falhou' ? 'alta' : 'normal',
      botoes: tipo === 'em_teste' ? [{ rotulo: 'Descartar', acao: 'descartar_versao' }] : [],
    })
  }

  function estado() {
    return {
      nome: config.nome,
      servicos: servicos.estado(),
      versao: versoes.estado(),
      rotinas: [
        { nome: 'reiniciar', descricao: 'Reinicia um serviço, ou todos os versionados', parametros: { servico: 'nome do serviço' } },
        { nome: 'atualizar', descricao: `Traz a ${config.versaoSegura} mais nova e sobe com ela; volta se quebrar`, parametros: {} },
        { nome: 'diagnostico', descricao: 'Serviços, versão, eventos recentes, disco e memória', parametros: {} },
        ...config.rotinas.map((r) => ({
          nome: r.nome,
          descricao: r.descricao,
          parametros: Object.fromEntries(Object.entries(r.parametros).map(([k, p]) => [k, p.descricao])),
        })),
      ],
      rodando: [...rodando],
      comandosLivres: comandos.habilitado(),
      propostas: comandos.pendentes(),
    }
  }

  async function diagnostico() {
    const linhas = []
    for (const s of servicos.estado()) {
      const ha = s.desde ? ` há ${Math.round((Date.now() - s.desde) / 60_000)} min` : ''
      linhas.push(`${s.nome}: ${s.status}${ha}, ${s.reinicios} reinícios${s.motivo ? ` (${s.motivo})` : ''}`)
    }
    const git = async (...a) => (await exec('git', a, { cwd: config.repo })).stdout.trim()
    const ref = await git('rev-parse', '--abbrev-ref', 'HEAD').catch(() => '?')
    const sha = await git('rev-parse', '--short', 'HEAD').catch(() => '?')
    const sujos = (await git('status', '--porcelain').catch(() => '')).split('\n').filter(Boolean).length
    const v = versoes.estado()
    linhas.push(`versão: ${ref} ${sha}${sujos ? `, ${sujos} arquivos alterados` : ''}${v.troca ? `, ${v.troca} ${v.branch}` : ''}`)
    const disco = await exec('df', ['-h', config.repo]).then((r) => r.stdout.trim().split('\n').pop()).catch(() => null)
    if (disco) {
      const [, tamanho, , livre, uso] = disco.split(/\s+/)
      linhas.push(`disco: ${livre} livres de ${tamanho} (${uso} em uso)`)
    }
    linhas.push(
      `memória: ${(freemem() / 2 ** 30).toFixed(1)} GB livres de ${(totalmem() / 2 ** 30).toFixed(0)} GB; ` +
        `carga ${loadavg().map((n) => n.toFixed(1)).join(' ')}`,
    )
    try {
      const eventos = readFileSync(join(config.pasta, 'eventos.log'), 'utf8').trim().split('\n').slice(-8)
      if (eventos[0]) linhas.push('eventos recentes:', ...eventos)
    } catch {
      /* nenhum evento ainda */
    }
    return { ok: true, mensagem: 'Diagnóstico pronto.', saida: linhas.join('\n') }
  }

  async function rotina(nome, parametros = {}) {
    if (rodando.has(nome)) return { ok: false, mensagem: `A rotina ${nome} já está rodando.` }
    rodando.add(nome)
    try {
      if (nome === 'diagnostico') return await diagnostico()
      if (nome === 'atualizar') return await versoes.atualizar()
      if (nome === 'reiniciar') {
        if (versoes.emTroca()) return { ok: false, mensagem: 'Há uma troca em andamento ou uma alteração em teste.' }
        const alvo = parametros?.servico
        if (alvo && !servicos.nomes().includes(alvo)) return { ok: false, mensagem: `Não conheço o serviço ${alvo}.` }
        const nomes = alvo ? [alvo] : servicos.versionados()
        for (const n of nomes) await servicos.reiniciar(n)
        return { ok: true, mensagem: `Reiniciei ${nomes.join(', ')}.` }
      }
      const def = config.rotinas.find((r) => r.nome === nome)
      if (!def) return { ok: false, mensagem: `Não há rotina chamada ${nome}.` }
      let args
      try {
        args = montar(def, parametros)
      } catch (err) {
        return { ok: false, mensagem: err.message }
      }
      log(`[fenix] rotina ${nome}`)
      const r = await rodar(args, { cwd: config.repo, env: ambiente(), prazoMs: def.prazoMs })
      log(`[fenix] rotina ${nome}: ${r.ok ? 'ok' : `falhou (${r.estourou ? 'prazo' : r.codigo})`}`)
      // Rotina longa termina quando ele talvez nem esteja olhando: avisa.
      if (r.tempoMs > 60_000) {
        avisos.avisar({
          titulo: `${config.nome}: rotina ${nome} ${r.ok ? 'terminou' : 'falhou'}`,
          texto: r.ok ? `Levou ${Math.round(r.tempoMs / 60_000)} min.` : (r.saida ?? '').slice(-300) || 'Sem saída.',
          prioridade: r.ok ? 'normal' : 'alta',
        })
      }
      return { ...r, mensagem: r.ok ? `A rotina ${nome} terminou bem.` : `A rotina ${nome} falhou.` }
    } finally {
      rodando.delete(nome)
    }
  }

  /**
   * Um aviso pedido por quem fala com a Fênix (a linha de comando, `fenix avisar`).
   * Vai para a central de notificações (o H.E.R.M.E.S.) com o nome do projeto no
   * título, sem botões: um botão volta a quem o criou, e aqui não há quem.
   */
  async function avisar(msg) {
    const titulo = typeof msg.titulo === 'string' ? msg.titulo.trim().slice(0, 120) : ''
    const texto = typeof msg.texto === 'string' ? msg.texto.trim().slice(0, 1000) : ''
    if (!titulo || !texto) return { ok: false, mensagem: 'O aviso precisa de título e texto.' }
    const prioridade = msg.prioridade === 'alta' ? 'alta' : 'normal'
    log(`[fenix] aviso pedido: ${titulo}`)
    const r = await avisos.avisar({ titulo: `${config.nome}: ${titulo}`, texto, prioridade })
    if (r.ok) {
      const onde = [r.mac && 'no Mac', r.ntfy && 'no iPhone'].filter(Boolean).join(' e ')
      return { ok: true, mensagem: `A central de notificações entregou o aviso${onde ? ` ${onde}` : ''}.`, entrega: r }
    }
    return { ok: false, mensagem: `O aviso não foi entregue: ${r.mensagem ?? 'a central não conseguiu entregar'}.`, entrega: r }
  }

  async function atender(msg) {
    switch (msg.type) {
      case 'avisar':
        return avisar(msg)
      case 'estado':
        return { ok: true, ...estado() }
      case 'versao:aplicar':
        void versoes.aplicar(msg)
        return
      case 'versao:aprovar':
        void versoes.aprovar(msg)
        return
      case 'versao:reverter':
        void versoes.reverter(msg)
        return
      case 'rotina':
        return rotina(String(msg.nome ?? ''), msg.parametros)
      case 'comando:propor':
        return comandos.propor(msg)
      case 'comando:confirmar':
        return comandos.confirmar(String(msg.proposta ?? ''))
      case 'comando:cancelar':
        return comandos.cancelar(String(msg.proposta ?? ''))
      default:
        return { ok: false, mensagem: `Não conheço a mensagem ${msg.type}.` }
    }
  }

  canal = criarCanal({
    token,
    host: config.escuta.host,
    porta: config.escuta.porta,
    tls,
    atender,
    // `inicial`: é o retrato que vale para quem acabou de chegar (ou voltar).
    aoConectar: (enviar) => enviar({ type: 'estado', inicial: true, ...estado() }),
    log,
  })

  return {
    servicos,
    versoes,
    comandos,
    atender,
    estado,
    canal,
    url: () => url(porta),
    /** Volta o que não foi aprovado, abre o canal e sobe os serviços. */
    async iniciar() {
      if (renascida) {
        const linha = '[fenix] renasci: o A.P.O.L.O. me trouxe de volta das cinzas'
        log(linha)
        try {
          appendFileSync(join(config.pasta, 'eventos.log'), `${new Date().toISOString()} ${linha}\n`)
        } catch {
          /* o registro nunca impede a partida */
        }
        avisos.avisar({
          titulo: `${config.nome}: a Fênix renasceu`,
          texto: 'Ela tinha caído, e o A.P.O.L.O. a subiu de novo. Os serviços estão voltando.',
          prioridade: 'alta',
        })
      }
      const interrompida = await versoes.recuperar()
      porta = await canal.ligar()
      await servicos.liberarPortas()
      servicos.ligarTodos()
      if (interrompida) {
        canal.avisar({
          type: 'versao:resultado',
          id: interrompida.id,
          tipo: interrompida.aprovada ? 'aprovado' : 'revertido',
          mensagem: interrompida.aprovada
            ? 'A alteração aprovada está guardada na branch e a versão segura voltou ao ar.'
            : 'Uma alteração em teste foi interrompida; a versão segura voltou ao ar.',
        })
      }
      return porta
    },
    avisos,
    async encerrar() {
      clearTimeout(avisarEstado)
      avisos.fechar()
      await servicos.encerrar()
      await canal.fechar()
    },
  }
}
