/**
 * A guardiã: sobe os serviços, mostra a saída de cada um e os mantém vivos.
 *
 * Um serviço que cai volta sozinho, com espera crescente (1 s, 2 s, 5 s... até
 * 1 min) para não girar em falso, e a espera zera depois de dois minutos de pé.
 * Um serviço que trava também volta: com `saude`, três checagens seguidas sem
 * resposta derrubam o processo, e ele sobe de novo como numa queda.
 *
 * Saída com código 0 de um serviço opcional quer dizer "não tenho nada a fazer
 * aqui" (o H.E.R.M.E.S. sem celular pareado, por exemplo) e não é queda.
 *
 * Durante uma troca de versão, quem decide sobre os serviços versionados é
 * src/versoes.mjs: `aoCair` e `pausado` são as duas perguntas que a guardiã faz.
 */
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { request as requestHttp } from 'node:http'
import { request as requestHttps } from 'node:https'

/** Sem segurar o processo: quem o mantém vivo são os serviços e o canal. */
const dormir = (ms) => new Promise((r) => setTimeout(r, ms).unref())

export const ESPERAS_MS = [1000, 2000, 5000, 10_000, 30_000, 60_000]
const FALHAS_SEGUIDAS = 3

/** Um GET com prazo. Confia só na autoridade dada, quando há uma. */
export function obter(url, { ca, prazoMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const alvo = new URL(url)
    const pedir = alvo.protocol === 'https:' ? requestHttps : requestHttp
    const pedido = pedir(alvo, { ca: ca ?? undefined, timeout: prazoMs }, (resposta) => {
      let corpo = ''
      resposta.setEncoding('utf8')
      resposta.on('data', (parte) => (corpo += parte))
      resposta.on('end', () => {
        const status = resposta.statusCode ?? 0
        resolve({ ok: status >= 200 && status < 300, status, corpo })
      })
    })
    pedido.on('timeout', () => pedido.destroy(new Error(`sem resposta de ${url}`)))
    pedido.on('error', reject)
    pedido.end()
  })
}

const rotulo = (nome, cor) => (pedaco) =>
  pedaco
    .toString()
    .split('\n')
    .filter((l) => l.length)
    .map((l) => `\x1b[${cor}m${nome}\x1b[0m ${l}`)
    .join('\n') + '\n'

/**
 * @param servicos    a lista do fenix.config.json
 * @param ambiente    o ambiente de todos os filhos, ou uma função que o devolve
 * @param aoMudar     chamado a cada mudança de estado de um serviço
 */
export function criarServicos({
  repo,
  servicos,
  ambiente = process.env,
  log = console.log,
  aoMudar = () => {},
  esperasMs = ESPERAS_MS,
  estavelMs = 120_000,
  intervaloMs = 5000,
  subidaMs = 60_000,
  saida = process.stdout,
}) {
  const estados = new Map(
    servicos.map((def) => [
      def.nome,
      { def, filho: null, status: 'desligado', reinicios: 0, quedas: 0, ligadoEm: 0, falhas: 0, timer: null, motivo: null },
    ]),
  )
  let encerrando = false
  /** A troca de versão responde se cuida desta queda. */
  let aoCair = () => false
  /** A troca de versão responde se a saúde deste serviço está com ela. */
  let pausado = () => false
  const caRaiz = new Map()

  const pegar = (nome) => {
    const e = estados.get(nome)
    if (!e) throw new Error(`serviço desconhecido: ${nome}`)
    return e
  }

  const mudar = (e, status, motivo = null) => {
    e.status = status
    e.motivo = motivo
    aoMudar(e.def.nome, status, motivo)
  }

  const ca = (arquivo) => {
    if (!arquivo) return null
    if (!caRaiz.has(arquivo)) {
      try {
        caRaiz.set(arquivo, readFileSync(arquivo))
      } catch {
        return null
      }
    }
    return caRaiz.get(arquivo)
  }

  function ligar(nome) {
    const e = pegar(nome)
    if (e.filho || encerrando) return
    clearTimeout(e.timer)
    e.timer = null
    const [comando, ...args] = e.def.comando
    const env = { ...(typeof ambiente === 'function' ? ambiente() : ambiente), ...e.def.ambiente }
    const filho = spawn(comando === 'node' ? process.execPath : comando, args, {
      cwd: repo,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    e.filho = filho
    e.ligadoEm = Date.now()
    e.falhas = 0
    const escrever = rotulo(e.def.nome, e.def.cor)
    filho.stdout.on('data', (d) => saida.write(escrever(d)))
    filho.stderr.on('data', (d) => saida.write(escrever(d)))
    let terminou = false
    const fim = (codigo) => {
      if (terminou) return
      terminou = true
      saiu(e, filho, codigo)
    }
    filho.on('error', (err) => {
      log(`[fenix] ${e.def.nome} não iniciou: ${err.message}`)
      fim(-1)
    })
    filho.on('exit', (codigo, sinal) => fim(codigo ?? sinal))
    mudar(e, e.def.saude ? 'subindo' : 'ligado')
  }

  function saiu(e, filho, codigo) {
    if (e.filho !== filho) return
    e.filho = null
    if (filho.planejado || encerrando) return mudar(e, 'desligado')
    if (codigo === 0 && e.def.opcional) {
      log(`[fenix] ${e.def.nome} encerrou sozinho: nada a fazer por aqui.`)
      return mudar(e, 'desligado')
    }
    const motivo = filho.travou ? 'parou de responder' : `encerrou (${codigo})`
    if (aoCair(e.def.nome, motivo)) return mudar(e, 'caiu', motivo)
    reiniciarDepois(e, motivo)
  }

  function reiniciarDepois(e, motivo) {
    if (Date.now() - e.ligadoEm > estavelMs) e.quedas = 0
    const espera = esperasMs[Math.min(e.quedas, esperasMs.length - 1)]
    e.quedas++
    e.reinicios++
    log(`[fenix] ${e.def.nome} ${motivo}; volta em ${Math.round(espera / 1000)} s`)
    mudar(e, 'caiu', motivo)
    e.timer = setTimeout(() => {
      e.timer = null
      ligar(e.def.nome)
    }, espera)
  }

  /** Derruba e resolve quando o processo sair. Cancela uma volta agendada. */
  function desligar(nome, prazoMs = 5000) {
    const e = pegar(nome)
    clearTimeout(e.timer)
    e.timer = null
    const filho = e.filho
    if (!filho) {
      if (e.status === 'caiu') mudar(e, 'desligado')
      return Promise.resolve()
    }
    filho.planejado = true
    return new Promise((resolve) => {
      const forcar = setTimeout(() => filho.kill('SIGKILL'), prazoMs)
      filho.once('exit', () => {
        clearTimeout(forcar)
        resolve()
      })
      filho.kill('SIGTERM')
    })
  }

  /** Pergunta a cada endereço de saúde. O JSON do primeiro vem em `dados`. */
  async function saude(nome) {
    const e = pegar(nome)
    if (!e.filho) return { ok: false, motivo: 'não está rodando' }
    const s = e.def.saude
    if (!s) return { ok: true }
    let dados
    for (const url of s.urls) {
      const r = await obter(url, { ca: ca(s.ca), prazoMs: s.prazoMs }).catch((err) => ({ ok: false, motivo: err.message }))
      if (!r.ok) return { ok: false, motivo: r.motivo ?? `${url} respondeu ${r.status}` }
      if (dados === undefined) {
        try {
          dados = JSON.parse(r.corpo)
        } catch {
          dados = null
        }
      }
    }
    return { ok: true, dados }
  }

  /** A saúde do conjunto: os obrigatórios de pé, e quantos clientes estão ligados. */
  async function saudeGeral() {
    let clientes = 0
    for (const e of estados.values()) {
      if (e.def.opcional || !e.def.saude) continue
      const r = await saude(e.def.nome)
      if (!r.ok) return { ok: false, motivo: `${e.def.nome}: ${r.motivo}` }
      const campo = e.def.saude.clientes
      if (campo && typeof r.dados?.[campo] === 'number') clientes += r.dados[campo]
    }
    return { ok: true, interfaces: clientes }
  }

  async function vigiar() {
    while (!encerrando) {
      await dormir(intervaloMs)
      for (const e of estados.values()) {
        if (!e.filho || !e.def.saude || pausado(e.def.nome)) continue
        const r = await saude(e.def.nome)
        if (!e.filho || pausado(e.def.nome)) continue
        if (r.ok) {
          e.falhas = 0
          if (e.status !== 'ligado') mudar(e, 'ligado')
          continue
        }
        // Subindo ainda não é travado: o Vite leva um tempo na primeira vez.
        if (e.status === 'subindo' && Date.now() - e.ligadoEm < subidaMs) continue
        if (++e.falhas < FALHAS_SEGUIDAS) continue
        log(`[fenix] ${e.def.nome} parou de responder (${r.motivo}); derrubando para subir de novo`)
        e.filho.travou = true
        e.filho.kill('SIGKILL')
      }
    }
  }

  /**
   * Encerra um processo antigo deste mesmo serviço que tenha ficado com a porta.
   * Só mata o que é nosso: o mesmo comando, rodando nesta pasta.
   */
  function liberarPortas() {
    let mortos = 0
    for (const { def } of estados.values()) {
      const assinatura = def.comando.slice(1).find((a) => /[/.]/.test(a)) ?? def.comando[0]
      for (const porta of def.portas) mortos += encerrarNaPorta(porta, assinatura, repo, log)
    }
    if (mortos) spawnSync('sleep', ['1'])
  }

  return {
    ligar,
    desligar,
    saude,
    saudeGeral,
    liberarPortas,
    nomes: () => [...estados.keys()],
    versionados: () => [...estados.values()].filter((e) => e.def.versionado).map((e) => e.def.nome),
    ehVersionado: (nome) => estados.get(nome)?.def.versionado === true,
    ligarTodos() {
      for (const nome of estados.keys()) ligar(nome)
      void vigiar()
    },
    async reiniciar(nome) {
      await desligar(nome)
      ligar(nome)
    },
    definir({ aoCair: cair, pausado: pausa }) {
      if (cair) aoCair = cair
      if (pausa) pausado = pausa
    },
    estado: () =>
      [...estados.values()].map((e) => ({
        nome: e.def.nome,
        status: e.status,
        motivo: e.motivo,
        reinicios: e.reinicios,
        pid: e.filho?.pid ?? null,
        desde: e.filho ? e.ligadoEm : null,
        opcional: e.def.opcional,
      })),
    async encerrar() {
      encerrando = true
      await Promise.all([...estados.keys()].map((n) => desligar(n)))
    },
  }
}

const real = (caminho) => {
  try {
    return realpathSync(caminho)
  } catch {
    return caminho
  }
}

/** Mata quem escuta na porta, se for o mesmo programa e na mesma pasta. */
export function encerrarNaPorta(porta, assinatura, pasta, log = console.log) {
  const achados = spawnSync('lsof', ['-ti', `tcp:${porta}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
  let mortos = 0
  for (const pid of (achados.stdout ?? '').split(/\s+/).filter(Boolean)) {
    if (Number(pid) === process.pid) continue
    const comando = spawnSync('ps', ['-o', 'command=', '-p', pid], { encoding: 'utf8' }).stdout ?? ''
    const cwd = spawnSync('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'], { encoding: 'utf8' }).stdout ?? ''
    const cwdReal = cwd.split('\n').find((l) => l.startsWith('n'))?.slice(1)
    if (!comando.includes(assinatura) || cwdReal !== real(pasta)) continue
    try {
      process.kill(Number(pid), 'SIGTERM')
      mortos++
      log(`[fenix] encerrei uma cópia antiga na porta ${porta} (processo ${pid}).`)
    } catch {
      /* já tinha saído */
    }
  }
  return mortos
}
