/**
 * O A.P.O.L.O. revive a F.Ê.N.I.X. (docs/adr/0028).
 *
 * A Fênix guarda o A.P.O.L.O.: derruba, volta à main e sobe de novo quando uma
 * versão quebra. Este arquivo é a outra metade do pacto: se quem morre é ela, a
 * ponte percebe e a traz de volta das cinzas.
 *
 * A ponte não sabe como a Fênix funciona e não importa nada dela (ADR 0025). A
 * própria Fênix, ao subir a ponte, entrega a receita do renascimento:
 *
 *   FENIX_PID       o processo dela, para distinguir "morreu" de "caiu a conexão";
 *   FENIX_RENASCER  JSON com o comando que a sobe de novo (os mesmos argumentos e
 *                   opções, como --writes), a pasta, o arquivo de saída, o registro
 *                   dos renascimentos e as variáveis que são dela e não do terminal.
 *
 * Sem essas duas variáveis (Fênix em outra máquina, `npm run bridge`), nada aqui
 * liga. Com elas, a regra é:
 *
 *   1. Conexão caiu: espera. Fênix viva (o processo existe) só está reiniciando
 *      o canal, e o cliente reconecta sozinho.
 *   2. O processo dela sumiu em duas checagens seguidas: ela morreu. A ponte a
 *      sobe de novo, solta (detached), com a saída num arquivo, porque o terminal
 *      foi junto com ela.
 *   3. A ponte sai logo depois. A Fênix nova sobe tudo de novo, inclusive uma
 *      ponte fresca, e volta à main se havia uma alteração sem aprovação no ar.
 *   4. Três renascimentos em dez minutos é um laço, não um acidente: a ponte
 *      desiste, continua de pé sozinha e avisa.
 *
 * Arquivo sensível (bridge/autodev/politica.mjs): ele sobe processos.
 */
import { spawn as spawnPadrao } from 'node:child_process'
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Mais que isso em `JANELA_MS` e a ponte desiste. */
export const LIMITE = 3
export const JANELA_MS = 10 * 60_000
/** Checagens seguidas com o processo sumido antes de reviver. */
const MORTES_SEGUIDAS = 2

/** O processo existe? `kill(pid, 0)` não mata: só pergunta ao sistema. */
export function processoVivo(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // Existe, mas é de outro usuário: para este fim, está vivo.
    return err.code === 'EPERM'
  }
}

/** A receita que a Fênix deixou, ou null se ela não deixou uma válida. */
export function lerReceita(env = process.env) {
  const pid = Number(env.FENIX_PID)
  if (!Number.isInteger(pid) || pid <= 0 || !env.FENIX_RENASCER?.trim()) return null
  try {
    const r = JSON.parse(env.FENIX_RENASCER)
    const ok =
      Array.isArray(r.comando) && r.comando.length && r.comando.every((p) => typeof p === 'string') &&
      typeof r.cwd === 'string' && typeof r.registro === 'string' && typeof r.saida === 'string'
    if (!ok) return null
    return { pid, ...r, limpar: Array.isArray(r.limpar) ? r.limpar.filter((v) => typeof v === 'string') : [] }
  } catch {
    return null
  }
}

/** O ambiente da Fênix nova: o do terminal, sem o que a Fênix antiga pôs. */
export function ambienteDoRenascimento(receita, env = process.env) {
  const limpo = { ...env }
  for (const nome of ['FENIX_URL', 'FENIX_PID', 'FENIX_RENASCER', ...receita.limpar]) delete limpo[nome]
  limpo.FENIX_RENASCIDA = '1'
  return limpo
}

/** Quantas vezes ela renasceu na janela, pelo registro em disco. */
export function renascimentosRecentes(registro, agora = Date.now(), janelaMs = JANELA_MS) {
  let texto = ''
  try {
    texto = readFileSync(registro, 'utf8')
  } catch {
    return 0
  }
  return texto
    .split('\n')
    .map((l) => Date.parse(l.split(' ')[0]))
    .filter((t) => Number.isFinite(t) && agora - t < janelaMs).length
}

/**
 * Sem terminal, escrever no stdout dá EPIPE, e um 'error' sem ouvinte derruba o
 * processo: a ponte morreria no primeiro console.log depois da Fênix, sem tempo
 * de revivê-la.
 */
export function protegerSaidas() {
  for (const saida of [process.stdout, process.stderr]) {
    if (!saida.listenerCount('error')) saida.on('error', () => {})
  }
}

/**
 * @param receita     lerReceita(); null desliga tudo
 * @param conectado   o cliente da Fênix está conectado agora?
 * @param sair        o que a ponte faz depois de revivê-la (padrão: encerrar)
 */
export function criarRenascimento({
  receita,
  conectado,
  log = console.log,
  sair = () => process.exit(0),
  vivo = processoVivo,
  spawn = spawnPadrao,
  agora = Date.now,
  intervaloMs = 1000,
  saidaMs = 800,
}) {
  if (!receita) return null
  protegerSaidas()
  let timer = null
  let mortes = 0
  let desistiu = false
  let renasceu = false

  const parar = () => {
    clearInterval(timer)
    timer = null
    mortes = 0
  }

  function anotar(linha) {
    try {
      mkdirSync(dirname(receita.registro), { recursive: true })
      appendFileSync(receita.registro, `${new Date(agora()).toISOString()} ${linha}\n`)
    } catch {
      /* o registro nunca impede o renascimento */
    }
  }

  function renascer() {
    parar()
    const recentes = renascimentosRecentes(receita.registro, agora())
    if (recentes >= LIMITE) {
      desistiu = true
      log(`[apolo] a F.Ê.N.I.X. morreu ${recentes + 1} vezes em 10 minutos; não vou revivê-la de novo. Sigo sozinho: suba com npm start.`)
      return { ok: false, motivo: 'laço' }
    }
    let fd
    try {
      mkdirSync(dirname(receita.saida), { recursive: true })
      fd = openSync(receita.saida, 'a')
      const [comando, ...args] = receita.comando
      const filho = spawn(comando, args, {
        cwd: receita.cwd,
        env: ambienteDoRenascimento(receita),
        detached: true,
        stdio: ['ignore', fd, fd],
      })
      filho.unref?.()
      anotar(`renascida pelo A.P.O.L.O. (a anterior era o processo ${receita.pid})`)
      renasceu = true
      log(`[apolo] a F.Ê.N.I.X. morreu; trouxe de volta das cinzas (processo ${filho.pid ?? '?'}). Saída em ${receita.saida}.`)
    } catch (err) {
      log(`[apolo] não consegui reviver a F.Ê.N.I.X.: ${err.message}`)
      return { ok: false, motivo: err.message }
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
    // A Fênix nova sobe uma ponte nova; esta, filha da morta, sai do caminho.
    setTimeout(sair, saidaMs).unref?.()
    return { ok: true }
  }

  function checar() {
    if (conectado()) return parar()
    if (vivo(receita.pid)) {
      mortes = 0
      return
    }
    if (++mortes >= MORTES_SEGUIDAS) renascer()
  }

  return {
    /** A conexão caiu: começa a vigiar se ela morreu. */
    vigiar() {
      if (timer || desistiu || renasceu) return
      mortes = 0
      timer = setInterval(checar, intervaloMs)
      timer.unref?.()
    },
    parar,
    /** Para os testes e a aba SISTEMAS. */
    estado: () => ({ vigiando: Boolean(timer), desistiu, renasceu }),
  }
}
