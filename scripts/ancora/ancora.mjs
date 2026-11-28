#!/usr/bin/env node
/**
 * Â.N.C.O.R.A. — Agora Nós Conheceremos O Retrocesso Automático (docs/adr/0041).
 *
 * O pânico do A.P.O.L.O.: desliga tudo sem perguntar nada a ninguém, guarda o que
 * estava sem commit, põe no ar a versão de segurança (a âncora) e confere que tudo
 * subiu. Não importa nada do projeto e só usa o Node: tem de rodar mesmo com o
 * repositório, a Fênix e a `main` quebrados.
 *
 *   ancora                        o pânico (também --panico)
 *   ancora --origem voz --motivo "..."   quem pediu e por quê, para o registro
 *   ancora --sair                 desliga a âncora e sobe a main do repositório
 *   ancora --estado               qual âncora está instalada e se está no ar
 *   ancora --testar-atalho        mostra o código que o Atalho do iPhone deve mandar agora
 *   sudo ancora --atualizar <commit|main>   congela uma âncora nova (só o root)
 *   sudo node scripts/ancora/ancora.mjs instalar   instala tudo (uma vez)
 *   ancora vigia                  escuta o pedido do iPhone (o LaunchAgent roda isto)
 *
 * Instalado, este arquivo fica em /usr/local/ancora/bin/ancora.mjs, do root, com a
 * configuração em /usr/local/ancora/ancora.conf. Os testes apontam ANCORA_RAIZ para
 * uma pasta temporária.
 */
import { execFile as execFileCb, execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  chmodSync,
  closeSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { request as requestHttp } from 'node:http'
import { request as requestHttps } from 'node:https'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFile = promisify(execFileCb)

export const RAIZ_PADRAO = '/usr/local/ancora'
const raiz = () => process.env.ANCORA_RAIZ?.trim() || RAIZ_PADRAO

/** Os serviços do A.P.O.L.O. que o pânico encerra pelo comando (o resto sai pelas portas). */
export const PROGRAMAS = [
  /fenix\/fenix\.mjs/,
  /bridge\/server\.mjs/,
  /node_modules\/vite\/bin\/vite\.js/,
  /hermes\/hermes\.mjs/,
  /modules\/aurora\/aurora\.mjs/,
]

/** As opções da Fênix que o pânico repete ao subir de novo. */
export const OPCOES_DA_FENIX = ['--writes', '--autodev']

/** Uma vez a cada 10 minutos, no máximo, pelo iPhone. */
export const INTERVALO_DO_IPHONE_MS = 10 * 60_000

// ---------------------------------------------------------------- configuração

export function lerConf(pasta = raiz()) {
  const conf = JSON.parse(readFileSync(join(pasta, 'ancora.conf'), 'utf8'))
  const dados = conf.dados ?? join(conf.home, '.apolo', 'ancora')
  return { ...conf, raiz: pasta, dados }
}

/** A identidade de uma âncora congelada: número, commit e quando. */
export function lerAncora(pasta) {
  try {
    return JSON.parse(readFileSync(join(pasta, 'ANCORA.json'), 'utf8'))
  } catch {
    return null
  }
}

const carimbo = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

// ---------------------------------------------------------------- manifesto

/** Cada arquivo da pasta (sem o .git e o próprio manifesto) com o SHA-256 dele, em ordem. */
export function gerarManifesto(pasta) {
  const linhas = []
  const andar = (dir) => {
    for (const item of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const caminho = join(dir, item.name)
      const rel = relative(pasta, caminho)
      if (rel === '.git' || rel === 'MANIFESTO') continue
      const info = lstatSync(caminho)
      if (info.isSymbolicLink()) {
        linhas.push(`${createHash('sha256').update(`link:${readlinkSync(caminho)}`).digest('hex')}  ${rel}`)
      } else if (info.isDirectory()) {
        andar(caminho)
      } else if (info.isFile()) {
        linhas.push(`${createHash('sha256').update(readFileSync(caminho)).digest('hex')}  ${rel}`)
      }
    }
  }
  andar(pasta)
  return `${linhas.join('\n')}\n`
}

/** A cópia confere com o manifesto dela? `{ ok, motivo? }`. */
export function conferirManifesto(pasta) {
  let esperado
  try {
    esperado = readFileSync(join(pasta, 'MANIFESTO'), 'utf8')
  } catch {
    return { ok: false, motivo: 'não tem MANIFESTO' }
  }
  const agora = gerarManifesto(pasta)
  if (agora === esperado) return { ok: true }
  const a = new Set(esperado.split('\n'))
  const b = new Set(agora.split('\n'))
  const diferentes = [...new Set([...[...a].filter((l) => !b.has(l)), ...[...b].filter((l) => !a.has(l))].map((l) => l.slice(66)))].filter(Boolean)
  return { ok: false, motivo: `${diferentes.length} arquivo(s) não conferem (${diferentes.slice(0, 3).join(', ')})` }
}

// ---------------------------------------------------------------- processos

/**
 * O que matar, a partir da foto dos processos. Puro, para os testes.
 *
 * @param processos  `[{ pid, ppid, args, cwd }]`
 * @param escutando  os pids que escutam nas portas do A.P.O.L.O.
 * @param pastas     o repositório e a cópia ativa: um serviço só é nosso se roda de uma delas
 * @param extras     pids que se sabe serem nossos (o caffeinate da noite)
 * @param perfil     a pasta do perfil do Chrome da interface
 * @param eu         o pid deste processo: ele e quem o chamou nunca entram
 */
export function escolherAlvos({ processos, escutando = [], pastas = [], extras = [], perfil = null, eu = process.pid }) {
  const porPid = new Map(processos.map((p) => [p.pid, p]))
  const dentro = (cwd) => Boolean(cwd) && pastas.some((pasta) => cwd === pasta || cwd.startsWith(`${pasta}/`))
  const nosso = (p) => escutando.includes(p.pid) || (PROGRAMAS.some((re) => re.test(p.args)) && dentro(p.cwd))
  // Quem chamou o pânico fica de pé (o terminal, o vigia), menos quando é um dos
  // serviços: a ponte que o chamou pela voz cai junto com o resto.
  const protegidos = new Set([eu])
  for (let p = porPid.get(porPid.get(eu)?.ppid), i = 0; p && i < 50; p = porPid.get(p.ppid), i++) if (!nosso(p)) protegidos.add(p.pid)
  const alvos = new Set()
  for (const pid of [...escutando, ...extras]) if (porPid.has(pid)) alvos.add(pid)
  for (const p of processos) {
    if (PROGRAMAS.some((re) => re.test(p.args)) && dentro(p.cwd)) alvos.add(p.pid)
    if (perfil && p.args.includes(`--user-data-dir=${perfil}`)) alvos.add(p.pid)
  }
  // Tudo o que eles abriram: o agente do autodev, o Chrome do teste, o caffeinate.
  let cresceu = true
  while (cresceu) {
    cresceu = false
    for (const p of processos) {
      if (!alvos.has(p.pid) && alvos.has(p.ppid)) {
        alvos.add(p.pid)
        cresceu = true
      }
    }
  }
  for (const pid of protegidos) alvos.delete(pid)
  return [...alvos]
}

/** A foto dos processos do sistema, com a pasta de cada `node`. */
export function fotografarProcessos() {
  const ps = spawnSync('ps', ['-axo', 'pid=,ppid=,args='], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).stdout ?? ''
  const processos = ps
    .split('\n')
    .map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l))
    .filter(Boolean)
    .map(([, pid, ppid, args]) => ({ pid: Number(pid), ppid: Number(ppid), args, cwd: null }))
  const lsof = spawnSync('lsof', ['-a', '-d', 'cwd', '-c', 'node', '-Fpn'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).stdout ?? ''
  const pastas = new Map()
  let atual = null
  for (const l of lsof.split('\n')) {
    if (l.startsWith('p')) atual = Number(l.slice(1))
    else if (l.startsWith('n') && atual) pastas.set(atual, l.slice(1))
  }
  for (const p of processos) p.cwd = pastas.get(p.pid) ?? null
  return processos
}

export function quemEscuta(portas) {
  const pids = new Set()
  for (const porta of portas) {
    const r = spawnSync('lsof', ['-nP', '-t', `-iTCP:${porta}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
    for (const pid of (r.stdout ?? '').split(/\s+/).filter(Boolean)) pids.add(Number(pid))
  }
  return [...pids]
}

const vivo = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM'
  }
}
const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms))

/** SIGTERM, até 5 s, e SIGKILL no que sobrar. Devolve quantos encerrou. */
export async function encerrar(pids, { prazoMs = 5000 } = {}) {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      /* já saiu */
    }
  }
  const fim = Date.now() + prazoMs
  while (Date.now() < fim && pids.some(vivo)) await dormir(100)
  for (const pid of pids.filter(vivo)) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* já saiu */
    }
  }
  return pids.length
}

/** As opções da Fênix no ar (--writes, --autodev), para subir a nova igual. */
export function opcoesDaFenixNoAr(processos, padrao = []) {
  const fenix = processos.find((p) => /fenix\/fenix\.mjs/.test(p.args) && !/\s(rotina|avisar|trocar|rollback)\s/.test(` ${p.args} `))
  if (!fenix) return padrao
  return OPCOES_DA_FENIX.filter((o) => fenix.args.split(/\s+/).includes(o))
}

// ---------------------------------------------------------------- git

const gitEm = (pasta) => async (...args) => {
  const r = await execFile('git', args, {
    cwd: pasta,
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
  })
  return r.stdout.trim()
}

/**
 * O que estava sem commit vai para uma branch `panico/<carimbo>`, e o estado de
 * trabalho da Fênix e do autodev vai para o arquivo. Nada é apagado.
 */
export async function guardar({ repo, dados, home, agora = new Date(), log = console.log }) {
  const marca = carimbo(agora)
  const arquivo = join(dados, 'arquivo', marca)
  const feito = { branch: null, movidos: [] }
  const git = gitEm(repo)
  try {
    if ((await git('status', '--porcelain')).trim()) {
      const de = await git('rev-parse', '--abbrev-ref', 'HEAD').catch(() => '?')
      feito.branch = `panico/${marca}`
      await git('switch', '-c', feito.branch)
      await git('add', '-A')
      await git(
        '-c', 'user.name=Âncora', '-c', 'user.email=ancora@localhost', '-c', 'commit.gpgsign=false',
        'commit', '--no-verify', '-q', '-m', `Â.N.C.O.R.A.: o que estava sem commit em ${de}`,
      )
      log(`guardei o que estava sem commit na branch ${feito.branch}`)
    }
  } catch (err) {
    log(`não consegui guardar o que estava sem commit: ${String(err.message).split('\n')[0]}`)
    feito.erro = err.message
  }
  const apolo = join(home, '.apolo')
  for (const alvo of [
    join(apolo, 'fenix', 'transicao.json'),
    join(apolo, 'fenix', 'noite.json'),
    join(apolo, 'autodev', 'worktrees'),
    join(apolo, 'autodev', 'estado.json'),
    join(apolo, 'autodev', 'noite.json'),
  ]) {
    if (!existsSync(alvo)) continue
    const destino = join(arquivo, relative(apolo, alvo))
    mkdirSync(dirname(destino), { recursive: true })
    try {
      renameSync(alvo, destino)
    } catch {
      cpSync(alvo, destino, { recursive: true })
      rmSync(alvo, { recursive: true, force: true })
    }
    feito.movidos.push(relative(apolo, alvo))
  }
  if (feito.movidos.length) log(`arquivei ${feito.movidos.join(', ')} em ${arquivo}`)
  await git('worktree', 'prune').catch(() => {})
  return feito
}

// ---------------------------------------------------------------- saúde

/** GET simples, com o certificado do A.P.O.L.O.; `{ ok, status, corpo }`. Nunca rejeita. */
export function obter(url, { ca = null, prazoMs = 5000 } = {}) {
  return new Promise((resolve) => {
    let alvo
    try {
      alvo = new URL(url)
    } catch {
      return resolve({ ok: false, motivo: 'endereço inválido' })
    }
    const pedir = alvo.protocol === 'https:' ? requestHttps : requestHttp
    const req = pedir(alvo, { method: 'GET', timeout: prazoMs, ...(ca ? { ca } : {}) }, (res) => {
      let corpo = ''
      res.setEncoding('utf8')
      res.on('data', (d) => (corpo += d.length < 100_000 ? d : ''))
      res.on('end', () => resolve({ ok: (res.statusCode ?? 0) > 0 && res.statusCode < 500, status: res.statusCode, corpo }))
    })
    req.on('timeout', () => req.destroy(new Error('sem resposta')))
    req.on('error', (err) => resolve({ ok: false, motivo: err.message }))
    req.end()
  })
}

/** Espera cada serviço responder; `[{ nome, ok, opcional }]`. */
export async function conferirServicos(servicos, { ca = null, prazoMs = 180_000, intervaloMs = 2000 } = {}) {
  const fim = Date.now() + prazoMs
  const estado = new Map(servicos.map((s) => [s.nome, false]))
  while (Date.now() < fim) {
    for (const s of servicos) if (!estado.get(s.nome)) estado.set(s.nome, (await obter(s.url, { ca })).ok)
    if (servicos.every((s) => estado.get(s.nome) || s.opcional)) {
      // Os opcionais ganham mais uma volta: sobem junto.
      for (const s of servicos) if (!estado.get(s.nome)) estado.set(s.nome, (await obter(s.url, { ca })).ok)
      break
    }
    await dormir(intervaloMs)
  }
  return servicos.map((s) => ({ nome: s.nome, ok: estado.get(s.nome), opcional: Boolean(s.opcional) }))
}

// ---------------------------------------------------------------- avisos

/**
 * Avisa o Mac e o iPhone sem o H.E.R.M.E.S., que pode estar desligado: o ntfy e a
 * central do macOS, direto. Só frases para gente (docs/adr/0027). Nunca rejeita.
 */
export async function avisar(conf, { titulo, texto, prioridade = 'alta' }) {
  if (process.platform === 'darwin' && !process.env.ANCORA_SEM_AVISOS) {
    spawnSync('osascript', ['-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title (item 1 of argv)', '-e', 'end run', titulo, texto], { timeout: 10_000 })
  }
  const ntfy = conf.ntfy
  if (!ntfy?.topico || process.env.ANCORA_SEM_AVISOS) return
  await new Promise((resolve) => {
    try {
      const alvo = new URL(`${String(ntfy.servidor ?? 'https://ntfy.sh').replace(/\/$/, '')}/${encodeURIComponent(ntfy.topico)}`)
      const req = (alvo.protocol === 'https:' ? requestHttps : requestHttp)(
        alvo,
        { method: 'POST', timeout: 10_000, headers: { Title: encodeURIComponent(titulo), Priority: prioridade === 'alta' ? 'high' : 'default', 'Content-Type': 'text/plain; charset=utf-8' } },
        (res) => {
          res.resume()
          res.on('end', resolve)
        },
      )
      req.on('timeout', () => req.destroy())
      req.on('error', resolve)
      req.end(texto)
    } catch {
      resolve()
    }
  })
}

// ---------------------------------------------------------------- subir

function ambienteDaFenix(conf, extra = {}) {
  const env = { ...process.env }
  for (const k of Object.keys(env)) if (/^FENIX_|^ANCORA_(?!RAIZ|SEM_AVISOS)/.test(k)) delete env[k]
  const node = conf.node ?? process.execPath
  env.PATH = [dirname(node), '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin', env.PATH].filter(Boolean).join(':')
  env.HOME = conf.home
  return { ...env, ...extra }
}

/** Sobe a Fênix, solta, com a saída no fenix.log de sempre. */
function subirFenix(conf, pasta, opcoes, extra = {}) {
  const saida = join(conf.home, '.apolo', 'fenix', 'fenix.log')
  mkdirSync(dirname(saida), { recursive: true })
  const fd = openSync(saida, 'a')
  try {
    const filho = spawn(conf.node ?? process.execPath, [join(pasta, 'fenix', 'fenix.mjs'), ...opcoes], {
      cwd: pasta,
      env: ambienteDaFenix(conf, extra),
      detached: true,
      stdio: ['ignore', fd, fd],
    })
    filho.unref()
    return filho.pid
  } finally {
    closeSync(fd)
  }
}

/** A âncora que confere: a atual ou, se ela não bater com o manifesto, a anterior. */
export function escolherAncora(conf, log = console.log) {
  for (const n of [conf.atual, conf.anterior].filter((x) => Number.isInteger(x))) {
    const pasta = join(conf.raiz, String(n))
    const id = lerAncora(pasta)
    if (!id) {
      log(`✖ a âncora ${n} não existe em ${pasta}`)
      continue
    }
    const c = conferirManifesto(pasta)
    if (c.ok) return { n, pasta, ...id }
    log(`✖ a âncora ${n} não confere com o manifesto: ${c.motivo}`)
  }
  return null
}

/** Põe o repositório no commit da âncora. `{ ok, motivo? }`. */
async function repositorioNaAncora(conf, ancora, log) {
  const git = gitEm(conf.repo)
  try {
    await git('-c', 'advice.detachedHead=false', 'switch', '--detach', '--discard-changes', ancora.sha)
    if ((await git('rev-parse', 'HEAD')) !== ancora.sha) return { ok: false, motivo: 'o repositório não ficou no commit da âncora' }
    if (await git('status', '--porcelain', '--untracked-files=no')) return { ok: false, motivo: 'o repositório não ficou limpo no commit da âncora' }
  } catch (err) {
    return { ok: false, motivo: `o Git recusou: ${String(err.stderr || err.message).trim().split('\n').pop()}` }
  }
  // As dependências vêm da cópia congelada: as do repositório podem ser de outra versão.
  if (existsSync(join(ancora.pasta, 'node_modules'))) {
    const r = spawnSync('rsync', ['-a', '--delete', `${join(ancora.pasta, 'node_modules')}/`, `${join(conf.repo, 'node_modules')}/`], { encoding: 'utf8' })
    if (r.status !== 0) return { ok: false, motivo: `não consegui copiar as dependências: ${(r.stderr ?? '').trim().split('\n').pop()}` }
  }
  log(`✔ repositório no commit da âncora ${ancora.n} (${ancora.sha.slice(0, 7)})`)
  return { ok: true }
}

function prepararCopiaAtiva(conf, ancora, log) {
  const ativa = join(conf.dados, 'ativa')
  mkdirSync(ativa, { recursive: true })
  const r = spawnSync('rsync', ['-a', '--delete', `${ancora.pasta}/`, `${ativa}/`], { encoding: 'utf8' })
  if (r.status !== 0) return { ok: false, motivo: `não consegui copiar a âncora: ${(r.stderr ?? '').trim().split('\n').pop()}` }
  // A única coisa de fora: as chaves, que nunca ficam no repositório nem na âncora.
  const env = join(conf.repo, '.env.local')
  if (existsSync(env)) copyFileSync(env, join(ativa, '.env.local'))
  log(`✔ cópia da âncora ${ancora.n} pronta em ${ativa}`)
  return { ok: true, pasta: ativa }
}

async function subirEConferir(conf, pasta, opcoes, extra, log, prazos) {
  const pid = subirFenix(conf, pasta, opcoes, extra)
  log(`… a Fênix subiu (processo ${pid}); esperando os serviços`)
  const servicos = await conferirServicos(conf.servicos ?? [], { ca: lerCa(conf), ...prazos })
  for (const s of servicos) log(`${s.ok ? '✔' : '✖'} ${s.nome}${s.ok ? '' : s.opcional ? ' (opcional) não respondeu' : ' não respondeu'}`)
  const ok = servicos.every((s) => s.ok || s.opcional)
  return { ok, pid, servicos }
}

function lerCa(conf) {
  try {
    return conf.ca ? readFileSync(conf.ca) : null
  } catch {
    return null
  }
}

/** Abre a interface e espera ela se conectar à ponte. */
async function abrirInterface(conf, pasta, log, prazoMs = 60_000) {
  const i = conf.interface
  if (!i?.abrir?.length) return true
  const [comando, ...args] = i.abrir
  spawnSync(comando, args, { cwd: pasta, env: ambienteDaFenix(conf), timeout: 60_000 })
  if (!i.saude) return true
  const fim = Date.now() + prazoMs
  while (Date.now() < fim) {
    const r = await obter(i.saude, { ca: lerCa(conf) })
    try {
      if (r.ok && JSON.parse(r.corpo).interfaces > 0) {
        log('✔ interface conectada')
        return true
      }
    } catch {
      /* ainda subindo */
    }
    await dormir(2000)
  }
  log('✖ a interface não se conectou (abra https://localhost:5173 à mão)')
  return false
}

// ---------------------------------------------------------------- pânico

function registrador(conf, saida = console.log) {
  mkdirSync(conf.dados, { recursive: true })
  const arquivo = join(conf.dados, 'registro.log')
  return (linha) => {
    saida(linha)
    try {
      appendFileSync(arquivo, `${new Date().toISOString()} ${linha}\n`)
    } catch {
      /* o registro nunca para o pânico */
    }
  }
}

/** Um pânico de cada vez. */
function travar(conf) {
  const trava = join(conf.dados, 'panico.lock')
  mkdirSync(conf.dados, { recursive: true })
  try {
    const pid = Number(readFileSync(trava, 'utf8'))
    if (pid && pid !== process.pid && vivo(pid)) return null
  } catch {
    /* sem trava */
  }
  writeFileSync(trava, String(process.pid))
  return () => rmSync(trava, { force: true })
}

/** Desliga tudo o que é do A.P.O.L.O. Devolve as opções que a Fênix tinha. */
async function desligarTudo(conf, log) {
  const processos = fotografarProcessos()
  const opcoes = opcoesDaFenixNoAr(processos, conf.opcoes ?? OPCOES_DA_FENIX)
  let extras = []
  try {
    const noite = JSON.parse(readFileSync(join(conf.home, '.apolo', 'autodev', 'noite.json'), 'utf8'))
    if (Number.isInteger(noite.cafe)) extras = [noite.cafe]
  } catch {
    /* sem noite */
  }
  const alvos = escolherAlvos({
    processos,
    escutando: quemEscuta(conf.portas ?? []),
    pastas: [conf.repo, join(conf.dados, 'ativa')],
    extras: extras.filter((pid) => /caffeinate/.test(processos.find((p) => p.pid === pid)?.args ?? '')),
    perfil: join(conf.home, '.apolo', 'chrome'),
  })
  await encerrar(alvos)
  const sobrou = quemEscuta(conf.portas ?? [])
  log(`${sobrou.length ? '✖' : '✔'} desliguei ${alvos.length} processo(s) do A.P.O.L.O.${sobrou.length ? `; ainda há quem escute nas portas (${sobrou.join(', ')})` : ''}`)
  return opcoes
}

/**
 * O pânico inteiro. `{ ok, modo, ancora }`.
 *
 * @param prazos  `{ prazoMs, intervaloMs }` da conferência dos serviços (os testes encurtam)
 */
export async function panico(conf, { origem = 'terminal', motivo = '', saida = console.log, prazos = {}, comInterface = true } = {}) {
  const log = registrador(conf, saida)
  const soltar = travar(conf)
  if (!soltar) {
    log('já há um pânico em andamento; não começo outro.')
    return { ok: false, motivo: 'em andamento' }
  }
  try {
    log(`Â.N.C.O.R.A. acionada (${origem}${motivo ? `: ${motivo}` : ''})`)
    await avisar(conf, { titulo: 'A.P.O.L.O.: protocolo âncora', texto: 'Desligando tudo para subir a versão de segurança.' })

    const opcoes = await desligarTudo(conf, log)
    await guardar({ repo: conf.repo, dados: conf.dados, home: conf.home, log: (l) => log(`✔ ${l}`) })

    const ancora = escolherAncora(conf, log)
    if (!ancora) {
      log('✖ nenhuma âncora conferiu com o manifesto: não subi nada.')
      await avisar(conf, { titulo: 'A.P.O.L.O.: a âncora não subiu', texto: 'Nenhuma versão de segurança conferiu. Preciso que você olhe o Mac.' })
      return { ok: false, motivo: 'sem âncora' }
    }
    log(`✔ âncora ${ancora.n} conferida (${ancora.sha.slice(0, 7)})`)

    let modo = 'repositorio'
    let pasta = conf.repo
    let r = await repositorioNaAncora(conf, ancora, log)
    if (r.ok) {
      r = await subirEConferir(conf, pasta, opcoes, {}, log, prazos)
      if (!r.ok) {
        log('✖ a âncora não ficou de pé no repositório; tentando a cópia congelada')
        await desligarTudo(conf, log)
      }
    } else {
      log(`✖ ${r.motivo}; usando a cópia congelada`)
    }
    if (!r.ok) {
      modo = 'copia'
      const copia = prepararCopiaAtiva(conf, ancora, log)
      if (copia.ok) {
        pasta = copia.pasta
        r = await subirEConferir(conf, pasta, opcoes, { FENIX_VERSAO_FIXA: '1' }, log, prazos)
      } else {
        log(`✖ ${copia.motivo}`)
        r = copia
      }
    }

    if (r.ok) {
      writeFileSync(join(conf.dados, 'no-ar.json'), JSON.stringify({ n: ancora.n, sha: ancora.sha, modo, origem, motivo, em: new Date().toISOString() }, null, 2))
      if (comInterface) await abrirInterface(conf, pasta, log)
      log(`✔ a âncora ${ancora.n} está no ar (${modo === 'copia' ? 'da cópia congelada' : 'no repositório'})`)
      await avisar(conf, {
        titulo: 'A.P.O.L.O.: a âncora está no ar',
        texto: modo === 'copia'
          ? 'Subi a versão de segurança pela cópia congelada, porque o repositório não estava utilizável. Para voltar, conserte o repositório e rode ancora --sair.'
          : 'A versão de segurança está no ar. O que estava sem commit ficou numa branch panico.',
        prioridade: 'normal',
      })
    } else {
      log('✖ a âncora não ficou de pé. O detalhe está no registro e no fenix.log.')
      await avisar(conf, { titulo: 'A.P.O.L.O.: a âncora não subiu', texto: 'A versão de segurança não ficou de pé. Preciso que você olhe o Mac.' })
    }
    return { ok: Boolean(r.ok), modo, ancora: ancora.n }
  } finally {
    soltar()
  }
}

/** Desliga a âncora e sobe a main do repositório, como um npm start. */
export async function sairDaAncora(conf, { saida = console.log, prazos = {} } = {}) {
  const log = registrador(conf, saida)
  const opcoes = await desligarTudo(conf, log)
  rmSync(join(conf.dados, 'no-ar.json'), { force: true })
  try {
    await gitEm(conf.repo)('switch', 'main')
    log('✔ repositório na main')
  } catch (err) {
    log(`✖ não consegui pôr o repositório na main: ${String(err.stderr || err.message).trim().split('\n').pop()}`)
    return { ok: false }
  }
  const r = await subirEConferir(conf, conf.repo, opcoes, {}, log, prazos)
  log(r.ok ? '✔ a main está no ar' : '✖ a main não ficou de pé; rode ancora de novo para voltar à âncora')
  return { ok: r.ok }
}

/** A âncora está no ar? O commit no ar tem de ser o dela. */
export async function ancoraNoAr(conf) {
  let marca
  try {
    marca = JSON.parse(readFileSync(join(conf.dados, 'no-ar.json'), 'utf8'))
  } catch {
    return null
  }
  if (marca.modo === 'copia') return marca
  const sha = await gitEm(conf.repo)('rev-parse', 'HEAD').catch(() => '')
  return sha === marca.sha ? marca : null
}

// ---------------------------------------------------------------- o iPhone

/** A hora local em AAAAMMDDhhmm. */
export function minutoLocal(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`
}

/** O código que o Atalho manda: vale um minuto, e a palavra nunca passa pelo ntfy. */
export const codigoDaAncora = (segredo, d) => createHash('sha256').update(`${segredo}:${minutoLocal(d)}`).digest('hex')

/**
 * O pedido do iPhone vale? Aceita o minuto de agora, os dois anteriores e o
 * seguinte (o relógio do celular e o do Mac nunca batem certinho), e nunca o mesmo
 * código duas vezes.
 */
export function codigoValido(segredo, recebido, agora = new Date(), usados = new Set()) {
  const texto = String(recebido ?? '').trim().toLowerCase()
  if (!segredo || !/^[0-9a-f]{64}$/.test(texto) || usados.has(texto)) return false
  for (const desvio of [0, -1, -2, 1]) {
    if (codigoDaAncora(segredo, new Date(agora.getTime() + desvio * 60_000)) === texto) return true
  }
  return false
}

/**
 * O vigia: escuta `<tópico>-ancora` no ntfy e aciona o pânico com o código certo.
 * Roda como o usuário do Ricardo, pelo LaunchAgent do root.
 */
export async function vigia(conf, { saida = console.log } = {}) {
  const log = registrador(conf, saida)
  if (!conf.ntfy?.topico || !conf.segredo) {
    log('vigia: falta o tópico do ntfy ou a palavra-senha em ancora.conf; nada a vigiar.')
    await dormir(60 * 60_000)
    return
  }
  const usados = new Set()
  let ultimoPanico = 0
  let ultimoAvisoErrado = 0
  let desde = String(Math.floor(Date.now() / 1000))
  let espera = 5000
  const servidor = String(conf.ntfy.servidor ?? 'https://ntfy.sh').replace(/\/$/, '')
  log(`vigia: escutando o tópico da âncora em ${servidor}`)
  for (;;) {
    await new Promise((resolve) => {
      const alvo = new URL(`${servidor}/${encodeURIComponent(`${conf.ntfy.topico}-ancora`)}/json?since=${encodeURIComponent(desde)}`)
      const req = (alvo.protocol === 'https:' ? requestHttps : requestHttp)(alvo, { method: 'GET' }, (res) => {
        espera = 5000
        let resto = ''
        res.setEncoding('utf8')
        res.on('data', (pedaco) => {
          resto += pedaco
          const linhas = resto.split('\n')
          resto = linhas.pop()
          for (const linha of linhas) {
            let m
            try {
              m = JSON.parse(linha)
            } catch {
              continue
            }
            if (m.event !== 'message') continue
            desde = m.id ?? desde
            // Velho demais não é pedido: é o histórico do tópico.
            if (m.time && Date.now() / 1000 - m.time > 180) continue
            const agora = Date.now()
            if (!codigoValido(conf.segredo, m.message, new Date(), usados)) {
              log('vigia: pedido recusado (código errado ou vencido)')
              if (agora - ultimoAvisoErrado > 60 * 60_000) {
                ultimoAvisoErrado = agora
                void avisar(conf, { titulo: 'A.P.O.L.O.: pedido da âncora recusado', texto: 'Chegou um pedido da âncora com o código errado. Nada foi feito.', prioridade: 'normal' })
              }
              continue
            }
            usados.add(String(m.message).trim().toLowerCase())
            if (agora - ultimoPanico < INTERVALO_DO_IPHONE_MS) {
              log('vigia: pedido certo, mas o último pânico foi há menos de 10 minutos; ignorado')
              continue
            }
            ultimoPanico = agora
            log('vigia: pedido certo do iPhone; acionando a âncora')
            void avisar(conf, { titulo: 'A.P.O.L.O.: protocolo âncora', texto: 'Recebi o pedido pelo iPhone. Desligando tudo e subindo a versão de segurança.', prioridade: 'normal' })
            const filho = spawn(conf.node ?? process.execPath, [fileURLToPath(import.meta.url), '--origem', 'iphone'], {
              detached: true,
              stdio: 'ignore',
              env: { ...process.env },
            })
            filho.unref()
          }
        })
        res.on('end', resolve)
        res.on('error', resolve)
      })
      req.on('error', (err) => {
        log(`vigia: sem conexão com o ntfy (${err.message}); tento de novo`)
        resolve()
      })
      req.end()
    })
    await dormir(espera)
    espera = Math.min(espera * 2, 60_000)
  }
}

// ---------------------------------------------------------------- root: atualizar e instalar

const souRoot = () => process.getuid?.() === 0 || process.env.ANCORA_SEM_ROOT === '1'

/** Roda como o usuário do Ricardo (sob sudo, o root clona e instala como ele). */
function comoUsuario(conf, comando, args, opcoes = {}) {
  const sudo = process.getuid?.() === 0 && conf.usuario
  const [c, a] = sudo ? ['sudo', ['-u', conf.usuario, '-H', comando, ...args]] : [comando, args]
  return execFileSync(c, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...opcoes }).trim()
}

/**
 * Congela uma âncora nova: o commit tem de estar na main do GitHub. Clona e instala
 * como o usuário, numa pasta temporária, e só então passa para o root.
 */
export function atualizar(conf, alvo, { saida = console.log, conferirGithub = true } = {}) {
  if (!souRoot()) throw new Error('só com sudo: sudo ancora --atualizar <commit>')
  const log = saida
  const git = (...a) => comoUsuario(conf, 'git', ['-C', conf.repo, ...a], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  if (conferirGithub) {
    try {
      git('fetch', '-q', 'origin', 'main')
    } catch {
      // Sob sudo, a credencial do GitHub nem sempre vem junto: vale a última main buscada.
      log('… não consegui buscar a main agora; confiro contra a última que este Mac buscou do GitHub (origin/main)')
    }
  }
  const ref = !alvo || alvo === 'main' ? (conferirGithub ? 'origin/main' : 'main') : alvo
  const sha = git('rev-parse', '--verify', `${ref}^{commit}`)
  if (conferirGithub) {
    try {
      git('merge-base', '--is-ancestor', sha, 'origin/main')
    } catch {
      throw new Error(`o commit ${sha.slice(0, 7)} não está na main do GitHub: a âncora só sai de código revisado.`)
    }
  }
  // A pasta é criada pelo usuário: é ele quem clona e instala, nunca o root.
  const temporaria = process.getuid?.() === 0 && conf.usuario
    ? comoUsuario(conf, 'mktemp', ['-d', '/tmp/ancora-XXXXXX'])
    : mkdtempSync(join(tmpdir(), 'ancora-'))
  log(`… clonando ${sha.slice(0, 7)}`)
  comoUsuario(conf, 'git', ['clone', '-q', '--no-hardlinks', conf.repo, temporaria])
  comoUsuario(conf, 'git', ['-C', temporaria, '-c', 'advice.detachedHead=false', 'switch', '-q', '--detach', sha])
  const origem = (() => {
    try {
      return git('remote', 'get-url', 'origin')
    } catch {
      return ''
    }
  })()
  if (origem) comoUsuario(conf, 'git', ['-C', temporaria, 'remote', 'set-url', 'origin', origem])
  if (!process.env.ANCORA_SEM_NPM) {
    log('… instalando as dependências (npm ci)')
    // O npm ao lado do node: o PATH do sudo nem sempre tem o /usr/local/bin.
    const npm = join(dirname(conf.node ?? process.execPath), 'npm')
    comoUsuario(conf, existsSync(npm) ? npm : 'npm', ['ci', '--no-audit', '--no-fund'], { cwd: temporaria, timeout: 20 * 60_000 })
  }
  const n = (Number.isInteger(conf.atual) ? conf.atual : 0) + 1
  const destino = join(conf.raiz, String(n))
  rmSync(destino, { recursive: true, force: true })
  try {
    renameSync(temporaria, destino)
  } catch {
    cpSync(temporaria, destino, { recursive: true, verbatimSymlinks: true })
    rmSync(temporaria, { recursive: true, force: true })
  }
  writeFileSync(join(destino, 'ANCORA.json'), JSON.stringify({ n, sha, em: new Date().toISOString() }, null, 2))
  if (process.getuid?.() === 0) {
    execFileSync('chown', ['-R', 'root:wheel', destino])
    execFileSync('chmod', ['-R', 'go-w', destino])
  }
  log('… gerando o manifesto')
  writeFileSync(join(destino, 'MANIFESTO'), gerarManifesto(destino))
  // O próprio script passa a ser o deste commit: revisado, como o resto.
  const novoScript = join(destino, 'scripts', 'ancora', 'ancora.mjs')
  if (existsSync(novoScript)) {
    mkdirSync(join(conf.raiz, 'bin'), { recursive: true })
    copyFileSync(novoScript, join(conf.raiz, 'bin', 'ancora.mjs'))
    chmodSync(join(conf.raiz, 'bin', 'ancora.mjs'), 0o644)
  }
  const anterior = Number.isInteger(conf.atual) ? conf.atual : null
  for (const item of readdirSync(conf.raiz)) {
    if (/^\d+$/.test(item) && ![n, anterior].includes(Number(item))) rmSync(join(conf.raiz, item), { recursive: true, force: true })
  }
  const { raiz: _r, dados: _d, ...gravar } = conf
  writeFileSync(join(conf.raiz, 'ancora.conf'), JSON.stringify({ ...gravar, atual: n, anterior }, null, 2))
  chmodSync(join(conf.raiz, 'ancora.conf'), 0o644)
  try {
    git('tag', '-f', `ancora-${n}`, sha)
  } catch {
    /* a tag é só para saber de onde veio */
  }
  writeFileSync(join(conf.raiz, 'atual.json'), JSON.stringify({ n, sha, em: new Date().toISOString() }, null, 2))
  chmodSync(join(conf.raiz, 'atual.json'), 0o644)
  log(`✔ âncora ${n} congelada no commit ${sha.slice(0, 7)}${anterior ? ` (a ${anterior} fica de reserva)` : ''}`)
  return { n, sha }
}

/** Pergunta sem mostrar o que se digita (a palavra-senha). */
async function perguntarEscondido(pergunta) {
  const { createInterface } = await import('node:readline')
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    rl._writeToOutput = (s) => {
      if (s.includes(pergunta)) process.stdout.write(s)
    }
    rl.question(pergunta, (r) => {
      rl.close()
      process.stdout.write('\n')
      resolve(r.trim())
    })
  })
}

/** Instala o script, a configuração, o comando, o vigia e o atalho da Área de Trabalho. */
export async function instalar({ repo, saida = console.log }) {
  if (process.getuid?.() !== 0) throw new Error('só com sudo: sudo node scripts/ancora/ancora.mjs instalar')
  const usuario = process.env.SUDO_USER
  if (!usuario || usuario === 'root') throw new Error('rode com sudo a partir do seu usuário, não como root direto.')
  const uid = Number(process.env.SUDO_UID)
  const home = execFileSync('dscl', ['.', '-read', `/Users/${usuario}`, 'NFSHomeDirectory'], { encoding: 'utf8' }).split(':').pop().trim()
  // O "~/" do fenix.config.json é a pasta dele, não a do root.
  process.env.HOME = home
  // A configuração vem do fenix.config.json, lido pelo código da própria Fênix uma vez só, aqui.
  const { lerConfig } = await import(join(repo, 'fenix', 'src', 'config.mjs'))
  const cfg = lerConfig(join(repo, 'fenix.config.json'), { ...process.env, HOME: home })
  const env = cfg.ambiente
  const portas = [...new Set([cfg.escuta.porta, ...cfg.servicos.flatMap((s) => s.portas)])].filter(Boolean)
  const servicos = cfg.servicos.filter((s) => s.saude?.urls?.length).map((s) => ({ nome: s.nome, url: s.saude.urls[0], opcional: s.opcional }))
  const ponte = cfg.servicos.find((s) => s.saude?.clientes === 'interfaces')
  const palavra = process.env.ANCORA_PALAVRA?.trim() || (await perguntarEscondido('Palavra-senha do Atalho do iPhone (não aparece ao digitar): '))
  if (palavra.length < 8) throw new Error('a palavra-senha precisa de pelo menos 8 caracteres.')
  const R = raiz()
  mkdirSync(join(R, 'bin'), { recursive: true, mode: 0o755 })
  let antiga = {}
  try {
    antiga = JSON.parse(readFileSync(join(R, 'ancora.conf'), 'utf8'))
  } catch {
    /* primeira instalação */
  }
  const conf = {
    ...antiga,
    usuario,
    uid,
    home,
    repo,
    node: process.execPath,
    portas,
    servicos,
    ca: cfg.tls?.cert ?? null,
    interface: { abrir: ['bash', 'scripts/abrir-interface.command'], saude: ponte?.saude?.urls?.[0] ?? null },
    ntfy: env.APOLO_NTFY_TOPICO ? { servidor: env.APOLO_NTFY_SERVIDOR || 'https://ntfy.sh', topico: env.APOLO_NTFY_TOPICO } : null,
    segredo: palavra,
    opcoes: OPCOES_DA_FENIX,
  }
  writeFileSync(join(R, 'ancora.conf'), JSON.stringify(conf, null, 2), { mode: 0o644 })
  copyFileSync(fileURLToPath(import.meta.url), join(R, 'bin', 'ancora.mjs'))
  chmodSync(join(R, 'bin', 'ancora.mjs'), 0o644)
  writeFileSync('/usr/local/bin/ancora', `#!/bin/bash\nexec "${process.execPath}" "${join(R, 'bin', 'ancora.mjs')}" "$@"\n`, { mode: 0o755 })
  execFileSync('chown', ['-R', 'root:wheel', R, '/usr/local/bin/ancora'])
  // O vigia: do root, mas roda como o usuário, a cada sessão.
  const dados = join(home, '.apolo', 'ancora')
  comoUsuario({ usuario }, 'mkdir', ['-p', dados])
  const plist = '/Library/LaunchAgents/com.apolo.ancora.vigia.plist'
  writeFileSync(
    plist,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.apolo.ancora.vigia</string>
  <key>ProgramArguments</key><array><string>${process.execPath}</string><string>${join(R, 'bin', 'ancora.mjs')}</string><string>vigia</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${join(dados, 'vigia.log')}</string>
  <key>StandardErrorPath</key><string>${join(dados, 'vigia.log')}</string>
</dict></plist>
`,
    { mode: 0o644 },
  )
  execFileSync('chown', ['root:wheel', plist])
  spawnSync('launchctl', ['bootout', `gui/${uid}`, plist])
  spawnSync('launchctl', ['bootstrap', `gui/${uid}`, plist])
  // Dois cliques na Área de Trabalho.
  const atalho = join(home, 'Desktop', 'Âncora.command')
  writeFileSync(atalho, '#!/bin/bash\n# Protocolo Â.N.C.O.R.A. (docs/adr/0041): desliga tudo e sobe a versão de segurança.\n/usr/local/bin/ancora --origem area-de-trabalho\nread -n 1 -s -r -p "Pressione uma tecla para fechar."\n', { mode: 0o755 })
  execFileSync('chown', ['root:wheel', atalho])
  saida('✔ instalado: /usr/local/bin/ancora, /usr/local/ancora, o vigia do iPhone e o Âncora.command na Área de Trabalho')
  saida('Agora congele a primeira âncora: sudo ancora --atualizar main')
  return conf
}

// ---------------------------------------------------------------- linha de comando

async function principal(argv) {
  const opc = (nome) => {
    const i = argv.indexOf(nome)
    return i >= 0 ? (argv[i + 1] ?? '') : null
  }
  if (argv[0] === 'instalar') {
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
    await instalar({ repo })
    return 0
  }
  const conf = lerConf()
  if (argv[0] === 'vigia') {
    await vigia(conf)
    return 0
  }
  if (argv.includes('--atualizar')) {
    atualizar(conf, opc('--atualizar'))
    return 0
  }
  if (argv.includes('--estado')) {
    const ids = [conf.atual, conf.anterior].filter(Number.isInteger).map((n) => ({ n, ...lerAncora(join(conf.raiz, String(n))) }))
    for (const a of ids) console.log(`âncora ${a.n}: commit ${String(a.sha ?? '?').slice(0, 7)}, congelada em ${a.em ?? '?'}${a.n === conf.atual ? ' (atual)' : ' (reserva)'}`)
    const noAr = await ancoraNoAr(conf)
    console.log(noAr ? `no ar: âncora ${noAr.n} (${noAr.modo}), desde ${noAr.em}` : 'a âncora não está no ar.')
    return 0
  }
  if (argv.includes('--testar-atalho')) {
    console.log(`código deste minuto (${minutoLocal(new Date())}): ${codigoDaAncora(conf.segredo, new Date())}`)
    return 0
  }
  if (argv.includes('--sair')) return (await sairDaAncora(conf)).ok ? 0 : 1
  const r = await panico(conf, { origem: opc('--origem') || 'terminal', motivo: opc('--motivo') || '' })
  return r.ok ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal(process.argv.slice(2)).then(
    (codigo) => process.exit(codigo),
    (err) => {
      console.error(`✖ ${err.message}`)
      process.exit(1)
    },
  )
}
