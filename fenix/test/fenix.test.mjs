/**
 * Testes da guardiã, das rotinas, dos comandos livres e do canal da F.Ê.N.I.X.
 * Os serviços são pequenos programas Node escritos aqui mesmo.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'
import { criarCanal, tokenConfere } from '../src/canal.mjs'
import { expandir, lerAmbiente, lerConfig } from '../src/config.mjs'
import { criarFenix, receitaDoRenascimento } from '../src/fenix.mjs'
import { criarComandos, montar, rodar, semSegredos } from '../src/rotinas.mjs'
import { criarServicos } from '../src/servicos.mjs'

const TOKEN = 'f'.repeat(43)
const temp = () => realpathSync(mkdtempSync(join(tmpdir(), 'fenix-')))
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))
const esperar = async (cond, ms = 4000) => {
  const fim = Date.now() + ms
  while (!(await cond())) {
    if (Date.now() > fim) assert.fail('a condição não aconteceu a tempo')
    await dormir(10)
  }
}
const mudo = { write() {} }

/** Um serviço de mentira: um script Node numa pasta temporária. */
function servico(pasta, nome, codigo) {
  writeFileSync(join(pasta, `${nome}.mjs`), codigo)
  return { nome, comando: ['node', `${nome}.mjs`], cor: '37', opcional: false, versionado: false, portas: [], ambiente: {}, saude: null }
}

// ── configuração ─────────────────────────────────────────────────────────────

test('expandir troca ${VAR} e ${VAR:-padrão}', () => {
  assert.equal(expandir('a ${X} b', { X: '1' }), 'a 1 b')
  assert.equal(expandir('${Y:-8787}', {}), '8787')
  assert.equal(expandir('${Y:-8787}', { Y: '9000' }), '9000')
  assert.equal(expandir('${Z}', {}), '')
  assert.equal(expandir('${A:-https://x:${P:-5173}}', { P: '15173' }), 'https://x:15173')
  assert.equal(expandir('${A:-https://x:${P:-5173}}', { A: 'meu' }), 'meu')
})

test('lerConfig resolve caminhos, flags, proteção e recusa rotina com nome da Fênix', () => {
  const pasta = temp()
  writeFileSync(join(pasta, '.env.teste'), 'PORTA_X=9100\n# comentário\nSEGREDO="abc"\n')
  const base = {
    arquivosDeAmbiente: ['.env.teste'],
    servicos: [{ nome: 'app', comando: ['node', 'app.mjs'], portas: ['${PORTA_X:-1}'] }],
    flags: { '--writes': { ambiente: { A: '1' }, comandosLivres: true } },
    protecao: { revisao: ['^x/', { re: '\\.pem$', flags: 'i' }], branch: '^fase-' },
    rotinas: [{ nome: 'volume', comando: ['echo', '{n}'], parametros: { n: { formato: '[0-9]+' } } }],
  }
  writeFileSync(join(pasta, 'fenix.config.json'), JSON.stringify(base))
  const c = lerConfig(join(pasta, 'fenix.config.json'), { FENIX_PASTA: join(pasta, 'dados') })
  assert.equal(c.repo, pasta)
  assert.equal(c.pasta, join(pasta, 'dados'))
  assert.deepEqual(c.servicos[0].portas, [9100])
  assert.equal(c.ambiente.SEGREDO, 'abc')
  assert.equal(c.flags['--writes'].comandosLivres, true)
  assert.equal(c.protecao.revisao[1].test('A.PEM'), true)
  assert.equal(c.rotinas[0].parametros.n.formato.test('12'), true)
  assert.equal(c.rotinas[0].parametros.n.formato.test('12; rm'), false)

  writeFileSync(
    join(pasta, 'fenix.config.json'),
    JSON.stringify({ ...base, rotinas: [{ nome: 'atualizar', comando: ['true'] }] }),
  )
  assert.throws(() => lerConfig(join(pasta, 'fenix.config.json')), /própria Fênix/)
})

test('lerAmbiente lê CHAVE=valor, com aspas e comentário', () => {
  const pasta = temp()
  writeFileSync(join(pasta, '.env'), 'A=1\nexport B="dois"\nC=tres # nota\n\n#D=4\n')
  assert.deepEqual(lerAmbiente(join(pasta, '.env')), { A: '1', B: 'dois', C: 'tres' })
  assert.deepEqual(lerAmbiente(join(pasta, 'nao-existe')), {})
})

// ── rotinas e comandos ──────────────────────────────────────────────────────

const VOLUME = {
  nome: 'volume',
  comando: ['osascript', '-e', 'set volume output volume {nivel}'],
  parametros: { nivel: { formato: /^(?:100|[1-9]?[0-9])$/, descricao: 'de 0 a 100' } },
}

test('montar só aceita parâmetro no formato e nenhum desconhecido', () => {
  assert.deepEqual(montar(VOLUME, { nivel: 30 }), ['osascript', '-e', 'set volume output volume 30'])
  assert.throws(() => montar(VOLUME, { nivel: '30; rm -rf ~' }), /inválido/)
  assert.throws(() => montar(VOLUME, { nivel: '101' }), /inválido/)
  assert.throws(() => montar(VOLUME, {}), /inválido/)
  assert.throws(() => montar(VOLUME, { nivel: 1, outro: 2 }), /não tem outro/)
})

test('rodar devolve o código, a saída e respeita o prazo', async () => {
  const ok = await rodar(['node', '-e', 'console.log("oi")'], { cwd: tmpdir() })
  assert.equal(ok.ok, true)
  assert.equal(ok.saida, 'oi')
  const falha = await rodar(['node', '-e', 'process.exit(3)'], { cwd: tmpdir() })
  assert.deepEqual([falha.ok, falha.codigo], [false, 3])
  const lento = await rodar(['node', '-e', 'setTimeout(() => {}, 5000)'], { cwd: tmpdir(), prazoMs: 100 })
  assert.equal(lento.estourou, true)
  assert.equal(lento.ok, false)
  const inexistente = await rodar(['programa-que-nao-existe-123'], { cwd: tmpdir() })
  assert.equal(inexistente.ok, false)
})

test('nenhum segredo do ambiente chega a um comando livre', () => {
  const env = semSegredos({ PATH: '/bin', GEMINI_API_KEY: 'x', APOLO_GATEWAY_TOKEN: 'y', FENIX_TOKEN: 'z', HOME: '/h' })
  assert.deepEqual(Object.keys(env).sort(), ['HOME', 'PATH'])
})

test('comando livre: desligado por padrão, só roda confirmado e com o texto proposto', async () => {
  const pasta = temp()
  const desligado = criarComandos({ repo: pasta, pasta, log() {} })
  assert.equal(desligado.propor({ script: 'echo oi' }).ok, false)

  let barrado = null
  const c = criarComandos({ repo: pasta, pasta, habilitado: true, bloqueio: () => barrado, log() {} })
  assert.equal(c.propor({ script: '   ' }).ok, false)
  const { proposta } = c.propor({ script: 'echo "$GEMINI_API_KEY" feito > saida.txt', motivo: 'teste' })
  assert.equal(c.pendentes().length, 1)
  assert.equal(readdirSync(pasta).includes('saida.txt'), false, 'propor não roda nada')

  barrado = 'há uma versão em teste'
  assert.equal((await c.confirmar(proposta.id)).mensagem, 'há uma versão em teste')
  assert.equal(c.pendentes().length, 0, 'a proposta barrada não volta a valer')

  barrado = null
  const outra = c.propor({ script: 'echo "[$GEMINI_API_KEY]" > saida.txt' }).proposta
  const r = await c.confirmar(outra.id)
  assert.equal(r.ok, true)
  assert.equal(readFileSync(join(pasta, 'saida.txt'), 'utf8'), '[]\n')
  assert.equal((await c.confirmar(outra.id)).ok, false, 'confirmar duas vezes não roda de novo')
  const registro = readFileSync(join(pasta, 'comandos.log'), 'utf8')
  assert.match(registro, /terminou com o código 0/)
})

test('comando livre expira e pode ser cancelado', async () => {
  const pasta = temp()
  const c = criarComandos({ repo: pasta, pasta, habilitado: true, validadeMs: 20, log() {} })
  const { proposta } = c.propor({ script: 'true' })
  await dormir(40)
  assert.equal((await c.confirmar(proposta.id)).ok, false)
  const outra = c.propor({ script: 'true' }).proposta
  assert.equal(c.cancelar(outra.id).ok, true)
  assert.equal((await c.confirmar(outra.id)).ok, false)
})

// ── guardiã ─────────────────────────────────────────────────────────────────

test('um serviço que cai volta sozinho, com espera, e o opcional que sai com 0 fica quieto', async () => {
  const pasta = temp()
  writeFileSync(join(pasta, 'quedas.txt'), '')
  const instavel = servico(
    pasta,
    'instavel',
    `import { appendFileSync } from 'node:fs'
     appendFileSync('quedas.txt', 'x')
     setTimeout(() => process.exit(1), 30)`,
  )
  const nada = { ...servico(pasta, 'nada', 'process.exit(0)'), opcional: true }
  const s = criarServicos({ repo: pasta, servicos: [instavel, nada], log() {}, saida: mudo, esperasMs: [20, 40], intervaloMs: 50 })
  s.ligarTodos()
  await esperar(() => readFileSync(join(pasta, 'quedas.txt'), 'utf8').length >= 3)
  const estado = Object.fromEntries(s.estado().map((e) => [e.nome, e]))
  assert.ok(estado.instavel.reinicios >= 2)
  assert.equal(estado.nada.status, 'desligado')
  assert.equal(estado.nada.reinicios, 0)
  await s.encerrar()
})

test('um serviço que trava é derrubado e sobe de novo', async () => {
  const pasta = temp()
  writeFileSync(join(pasta, 'partidas.txt'), '')
  const travado = {
    ...servico(
      pasta,
      'travado',
      `import { createServer } from 'node:http'
       import { appendFileSync } from 'node:fs'
       appendFileSync('partidas.txt', 'x')
       const s = createServer((q, r) => { if (!globalThis.travou) r.end('ok') })
       s.listen(0, () => { appendFileSync('porta.txt', String(s.address().port) + '\\n') })
       setTimeout(() => (globalThis.travou = true), 60)`,
    ),
  }
  // A porta muda a cada partida: a saúde lê a última anotada.
  let porta = 0
  const lerPorta = () => {
    try {
      porta = Number(readFileSync(join(pasta, 'porta.txt'), 'utf8').trim().split('\n').pop())
    } catch {
      /* ainda não subiu */
    }
  }
  const s = criarServicos({ repo: pasta, servicos: [travado], log() {}, saida: mudo, esperasMs: [10], intervaloMs: 20, subidaMs: 400 })
  // Endereço dinâmico: a lista é lida de novo a cada checagem.
  travado.saude = { urls: [], ca: null, clientes: null, prazoMs: 100 }
  Object.defineProperty(travado.saude, 'urls', {
    get: () => {
      lerPorta()
      return porta ? [`http://127.0.0.1:${porta}/`] : ['http://127.0.0.1:1/']
    },
  })
  s.ligarTodos()
  await esperar(() => readFileSync(join(pasta, 'partidas.txt'), 'utf8').length >= 2, 8000)
  await s.encerrar()
})

test('desligar é planejado: não conta como queda nem reinicia', async () => {
  const pasta = temp()
  const longo = servico(pasta, 'longo', 'setInterval(() => {}, 1000)')
  const s = criarServicos({ repo: pasta, servicos: [longo], log() {}, saida: mudo, esperasMs: [10] })
  s.ligar('longo')
  await dormir(50)
  await s.desligar('longo')
  await dormir(50)
  const [e] = s.estado()
  assert.deepEqual([e.status, e.reinicios, e.pid], ['desligado', 0, null])
  await s.encerrar()
})

test('quando a troca de versão assume a queda, a guardiã não reinicia', async () => {
  const pasta = temp()
  const cai = { ...servico(pasta, 'cai', 'setTimeout(() => process.exit(2), 20)'), versionado: true }
  const quedas = []
  const s = criarServicos({ repo: pasta, servicos: [cai], log() {}, saida: mudo, esperasMs: [10] })
  s.definir({ aoCair: (nome, motivo) => (quedas.push([nome, motivo]), true) })
  s.ligar('cai')
  await esperar(() => quedas.length === 1)
  await dormir(60)
  assert.deepEqual(quedas, [['cai', 'encerrou (2)']])
  assert.equal(s.estado()[0].reinicios, 0)
  await s.encerrar()
})

// ── canal ───────────────────────────────────────────────────────────────────

const conectar = (porta, token = TOKEN) =>
  new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${porta}/fenix`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    const recebidas = []
    ws.on('message', (d) => recebidas.push(JSON.parse(d.toString())))
    ws.on('open', () => resolve({ ws, recebidas }))
    ws.on('unexpected-response', (_q, res) => resolve({ status: res.statusCode }))
    ws.on('error', () => {})
  })

test('o canal exige o token e responde pedidos com o mesmo id', async () => {
  const canal = criarCanal({ token: TOKEN, porta: 0, atender: async (m) => ({ ok: true, eco: m.type }), log() {} })
  const porta = await canal.ligar()
  assert.equal((await conectar(porta, null)).status, 401)
  assert.equal((await conectar(porta, 'errado')).status, 401)
  const { ws, recebidas } = await conectar(porta)
  ws.send(JSON.stringify({ type: 'estado', id: 7 }))
  await esperar(() => recebidas.length === 1)
  assert.deepEqual(recebidas[0], { type: 'estado:resposta', resposta: 7, ok: true, eco: 'estado' })
  ws.close()
  await canal.fechar()
})

test('avisos sem ninguém conectado esperam o próximo cliente', async () => {
  const canal = criarCanal({ token: TOKEN, porta: 0, atender: async () => undefined, log() {} })
  const porta = await canal.ligar()
  canal.avisar({ type: 'versao:resultado', tipo: 'revertido' })
  canal.transmitir({ type: 'estado' })
  const { ws, recebidas } = await conectar(porta)
  await esperar(() => recebidas.length === 1)
  await dormir(30)
  assert.deepEqual(recebidas, [{ type: 'versao:resultado', tipo: 'revertido' }])
  ws.close()
  await canal.fechar()
})

test('tokenConfere exige Bearer e o valor exato', () => {
  assert.equal(tokenConfere(`Bearer ${TOKEN}`, TOKEN), true)
  assert.equal(tokenConfere(`Bearer ${TOKEN}x`, TOKEN), false)
  assert.equal(tokenConfere(TOKEN, TOKEN), false)
  assert.throws(() => criarCanal({ token: 'curto', atender() {} }), /32 caracteres/)
})

// ── a Fênix inteira ─────────────────────────────────────────────────────────

test('a Fênix sobe os serviços, roda rotinas pelo canal e passa o endereço aos filhos', async () => {
  const pasta = temp()
  writeFileSync(
    join(pasta, 'app.mjs'),
    `import { writeFileSync } from 'node:fs'
     writeFileSync('visto.json', JSON.stringify({ url: process.env.FENIX_URL, flag: process.env.LIGADO ?? null }))
     setInterval(() => {}, 1000)`,
  )
  writeFileSync(
    join(pasta, 'fenix.config.json'),
    JSON.stringify({
      nome: 'teste',
      pasta: join(pasta, 'dados'),
      escuta: { porta: 0 },
      servicos: [{ nome: 'app', comando: ['node', 'app.mjs'] }],
      flags: { '--liga': { ambiente: { LIGADO: 'sim' } } },
      rotinas: [
        {
          nome: 'eco',
          comando: ['node', '-e', 'console.log(process.argv[1])', '{texto}'],
          parametros: { texto: { formato: '[a-z]+' } },
        },
      ],
    }),
  )
  const config = lerConfig(join(pasta, 'fenix.config.json'), {})
  const fenix = criarFenix(config, { flags: ['--liga'], token: TOKEN, log() {}, saida: mudo })
  const porta = await fenix.iniciar()
  await esperar(() => readdirSync(pasta).includes('visto.json'))
  const visto = JSON.parse(readFileSync(join(pasta, 'visto.json'), 'utf8'))
  assert.equal(visto.url, `ws://localhost:${porta}/fenix`)
  assert.equal(visto.flag, 'sim')

  const { ws, recebidas } = await conectar(porta)
  await esperar(() => recebidas.some((m) => m.type === 'estado' && m.inicial))
  const pedir = async (msg) => {
    const id = Math.random()
    ws.send(JSON.stringify({ ...msg, id }))
    await esperar(() => recebidas.some((m) => m.resposta === id), 8000)
    return recebidas.find((m) => m.resposta === id)
  }
  const eco = await pedir({ type: 'rotina', nome: 'eco', parametros: { texto: 'fenix' } })
  assert.equal(eco.ok, true)
  assert.equal(eco.saida, 'fenix')
  assert.equal((await pedir({ type: 'rotina', nome: 'eco', parametros: { texto: 'a;b' } })).ok, false)
  assert.equal((await pedir({ type: 'rotina', nome: 'nao-existe' })).ok, false)
  // Sem a flag que libera, comando livre é recusado.
  assert.equal((await pedir({ type: 'comando:propor', script: 'true' })).ok, false)
  const diag = await pedir({ type: 'rotina', nome: 'diagnostico' })
  assert.match(diag.saida, /app: ligado/)
  const estado = await pedir({ type: 'estado' })
  assert.deepEqual(
    estado.rotinas.map((r) => r.nome),
    ['reiniciar', 'atualizar', 'diagnostico', 'eco'],
  )
  ws.close()
  await fenix.encerrar()
})

test('os tempos do config valem só como números positivos e só os que existem', () => {
  const pasta = temp()
  writeFileSync(
    join(pasta, 'fenix.config.json'),
    JSON.stringify({
      servicos: [{ nome: 'app', comando: ['node', 'app.mjs'] }],
      tempos: {
        servicos: { esperasMs: [200, 400], intervaloMs: 300, inventado: 1 },
        versoes: { subidaMs: '6000', estabilidadeMs: -1, vigiaMs: 'x' },
      },
    }),
  )
  const c = lerConfig(join(pasta, 'fenix.config.json'), {})
  assert.deepEqual(c.tempos, { servicos: { intervaloMs: 300, esperasMs: [200, 400] }, versoes: { subidaMs: 6000 } })
  writeFileSync(join(pasta, 'fenix.config.json'), JSON.stringify({ servicos: [{ nome: 'app', comando: ['node', 'app.mjs'] }] }))
  assert.deepEqual(lerConfig(join(pasta, 'fenix.config.json'), {}).tempos, { servicos: {}, versoes: {} })
})

test('quem a Fênix sobe recebe o pid dela e a receita para revivê-la (docs/adr/0028)', async () => {
  const pasta = temp()
  writeFileSync(
    join(pasta, 'app.mjs'),
    `import { writeFileSync } from 'node:fs'
     writeFileSync('visto.json', JSON.stringify({ pid: process.env.FENIX_PID, receita: process.env.FENIX_RENASCER ?? null }))
     setInterval(() => {}, 1000)`,
  )
  writeFileSync(
    join(pasta, 'fenix.config.json'),
    JSON.stringify({
      pasta: join(pasta, 'dados'),
      escuta: { porta: 0 },
      servicos: [{ nome: 'app', comando: ['node', 'app.mjs'], ambiente: { SO_DO_APP: '1' } }],
      flags: { '--liga': { ambiente: { LIGADO: 'sim' } } },
    }),
  )
  const config = lerConfig(join(pasta, 'fenix.config.json'), {})
  const renascer = { comando: ['node', 'fenix.mjs', '--config', 'x.json', '--liga'], cwd: pasta }
  const fenix = criarFenix(config, { flags: ['--liga'], token: TOKEN, log() {}, saida: mudo, renascer })
  await fenix.iniciar()
  await esperar(() => readdirSync(pasta).includes('visto.json'))
  const visto = JSON.parse(readFileSync(join(pasta, 'visto.json'), 'utf8'))
  await fenix.encerrar()
  assert.equal(visto.pid, String(process.pid))
  const receita = JSON.parse(visto.receita)
  assert.deepEqual(receita, receitaDoRenascimento(config, renascer))
  assert.deepEqual(receita.comando, renascer.comando)
  assert.equal(receita.saida, join(pasta, 'dados', 'fenix.log'))
  assert.equal(receita.registro, join(pasta, 'dados', 'renascimentos.log'))
  // O que ela põe no ambiente não volta para a próxima; o token do arquivo, ela relê.
  assert.deepEqual(receita.limpar.sort(), ['FENIX_TOKEN', 'LIGADO', 'SO_DO_APP'])
  assert.equal(receitaDoRenascimento(config, { ...renascer, tokenDoAmbiente: true }).limpar.includes('FENIX_TOKEN'), false)
})

test('renascida, a Fênix registra e avisa que o A.P.O.L.O. a trouxe de volta', async () => {
  const pasta = temp()
  writeFileSync(join(pasta, 'app.mjs'), 'setInterval(() => {}, 1000)')
  writeFileSync(
    join(pasta, 'fenix.config.json'),
    JSON.stringify({ pasta: join(pasta, 'dados'), escuta: { porta: 0 }, servicos: [{ nome: 'app', comando: ['node', 'app.mjs'] }] }),
  )
  const logs = []
  const fenix = criarFenix(lerConfig(join(pasta, 'fenix.config.json'), {}), {
    token: TOKEN,
    log: (l) => logs.push(l),
    saida: mudo,
    renascida: true,
  })
  await fenix.iniciar()
  await fenix.encerrar()
  assert.ok(logs.some((l) => /renasci/.test(l)))
  assert.match(readFileSync(join(pasta, 'dados', 'eventos.log'), 'utf8'), /o A\.P\.O\.L\.O\. me trouxe de volta das cinzas/)
})

// ── independência ───────────────────────────────────────────────────────────

test('a Fênix não importa nada de fora da própria pasta, a não ser o Node e o ws', () => {
  const raiz = fileURLToPath(new URL('..', import.meta.url))
  const arquivos = []
  const varrer = (pasta) => {
    for (const nome of readdirSync(pasta)) {
      if (nome === 'node_modules') continue
      const caminho = join(pasta, nome)
      if (statSync(caminho).isDirectory()) varrer(caminho)
      else if (nome.endsWith('.mjs')) arquivos.push(caminho)
    }
  }
  varrer(raiz)
  for (const arquivo of arquivos) {
    const fonte = readFileSync(arquivo, 'utf8')
    for (const [, alvo] of fonte.matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)) {
      const permitido = alvo.startsWith('node:') || alvo === 'ws' || alvo.startsWith('./') || /^\.\.\/(src|fenix)/.test(alvo)
      assert.ok(permitido, `${arquivo} importa ${alvo}`)
    }
  }
})

// ── avisos ──────────────────────────────────────────────────────────────────

test('a Fênix avisa a central quando um serviço cai, e o botão Descartar chega até ela', async () => {
  const { WebSocketServer } = await import('ws')
  const { createServer } = await import('node:http')
  const http = createServer()
  const hub = new WebSocketServer({ server: http, verifyClient: ({ req }, ok) => ok(req.headers.authorization === `Bearer ${TOKEN}`, 401) })
  const recebidas = []
  let cliente
  hub.on('connection', (ws) => {
    cliente = ws
    ws.on('message', (d) => recebidas.push(JSON.parse(d.toString())))
  })
  await new Promise((r) => http.listen(0, '127.0.0.1', r))
  const pasta = temp()
  writeFileSync(join(pasta, 'cai.mjs'), 'setTimeout(() => process.exit(3), 50)')
  writeFileSync(
    join(pasta, 'fenix.config.json'),
    JSON.stringify({
      nome: 'teste',
      pasta: join(pasta, 'dados'),
      escuta: { porta: 0 },
      notificacoes: { url: `ws://127.0.0.1:${http.address().port}/notificacoes`, token: TOKEN },
      servicos: [{ nome: 'cai', comando: ['node', 'cai.mjs'] }],
    }),
  )
  const fenix = criarFenix(lerConfig(join(pasta, 'fenix.config.json'), {}), { token: TOKEN, log() {}, saida: mudo })
  await fenix.iniciar()
  await esperar(() => recebidas.some((m) => m.type === 'notificar' && /cai caiu/.test(m.titulo)), 6000)
  const aviso = recebidas.find((m) => /cai caiu/.test(m.titulo))
  assert.equal(aviso.prioridade, 'alta')
  assert.match(aviso.texto, /encerrou \(3\)/)
  // Um segundo tombo logo depois não vira outro aviso.
  await dormir(1500)
  assert.equal(recebidas.filter((m) => /cai caiu/.test(m.titulo)).length, 1)
  // O toque em Descartar chega à Fênix (sem versão em teste, ela só recusa).
  cliente.send(JSON.stringify({ type: 'notificacao:acao', notificacao: 'x', acao: 'descartar_versao' }))
  await dormir(100)
  await fenix.encerrar()
  for (const ws of hub.clients) ws.terminate()
  await new Promise((r) => http.close(r))
})
