/**
 * O modo noturno (docs/adr/0040), com o autodesenvolvimento e a Fênix de mentira:
 * o plano, o "confirmo", o item que entra, o que quebra e é tentado de novo, o que
 * precisa do Ricardo, os limites e a manhã (conferência e PR em rascunho).
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { criarNoite, horaDeParar, itensDoTexto, relatorioDaNoite } from '../bridge/autodev/noite.mjs'
import { TRAVAS_DA_NOITE, travasTocadas } from '../bridge/autodev/politica.mjs'

const esperar = async (cond, ms = 3000) => {
  const fim = Date.now() + ms
  while (!cond()) {
    if (Date.now() > fim) assert.fail('a condição não aconteceu a tempo')
    await new Promise((r) => setTimeout(r, 5))
  }
}

/**
 * Um autodev que responde como o de verdade. `roteiro` diz o que acontece com cada
 * trabalho, na ordem: 'entra' (fica de pé e é aprovado), 'quebra' (a Fênix volta),
 * 'trava' (toca o que a noite não muda).
 */
function montar({ roteiro = [], ancora = false, podeEnviar = true, fenixOk = true } = {}) {
  let estado = { ligado: true, fase: 'ocioso' }
  let noAr = 'main'
  let seq = 0
  const pedidos = []
  const prs = []
  const fenix = []
  let noite
  const mudar = (patch) => {
    estado = { ...estado, ...patch }
    queueMicrotask(() => void noite.aoAutodev(estado))
  }
  const autodev = {
    estado: () => estado,
    async acao(acao, { pedido } = {}) {
      if (acao === 'propor') {
        pedidos.push(pedido)
        mudar({ fase: 'proposto', id: `t${++seq}`, pedido })
        return { ok: true, mensagem: 'Proposta registrada.' }
      }
      if (acao === 'confirmar') {
        const id = estado.id
        const vai = roteiro.shift() ?? 'entra'
        mudar({ fase: 'trabalhando' })
        setTimeout(() => {
          if (vai === 'entra') mudar({ fase: 'testando', sensiveis: ['scripts/x.mjs'] })
          else if (vai === 'trava') mudar({ fase: 'ocioso', resultado: { id, tipo: 'falhou', mensagem: 'Precisa de você: a alteração toca bridge/gate.mjs.' } })
          else mudar({ fase: 'ocioso', resultado: { id, tipo: 'revertido', mensagem: 'A nova versão parou de responder.' } })
        }, 5)
        return { ok: true, mensagem: 'Trabalho iniciado.' }
      }
      if (acao === 'aprovar') {
        const id = estado.id
        mudar({ fase: 'aplicando' })
        setTimeout(() => {
          // Aprovada, a branch de trabalho é a que segue no ar (docs/adr/0031).
          noAr = 'fase-3.7/noite-boa'
          mudar({ fase: 'ocioso', resultado: { id, tipo: 'aprovado', mensagem: 'Virou commit.', branch: noAr } })
        }, 5)
        return { ok: true, mensagem: 'Aprovando.' }
      }
      if (acao === 'cancelar') return { ok: true, mensagem: 'Cancelando.' }
      return { ok: false, mensagem: '?' }
    },
  }
  const arquivo = join(mkdtempSync(join(tmpdir(), 'noite-')), 'noite.json')
  const avisos = []
  noite = criarNoite({
    arquivo,
    autodev,
    backlog: async () => [{ id: '1.3', etapa: 'Etapa 1', texto: 'Popup que não fecha' }],
    pedidoDaTarefa: (i) => `Faça o item ${i.id}: ${i.texto}`,
    fenix: async (msg) => (fenix.push(msg), { ok: fenixOk, mensagem: fenixOk ? 'ok' : 'não' }),
    fenixConectada: () => true,
    branchNoAr: async () => noAr,
    shaNoAr: async () => 'abc1234def',
    ancoraNoAr: async () => ancora,
    podeEnviar,
    abrirPr: async (p) => (prs.push(p), { ok: true, texto: 'Pull request aberto: https://github.com/x/y/pull/21.' }),
    conferir: async () => ({ ok: true }),
    avisar: (a) => avisos.push(a),
    spawn: () => ({ pid: undefined, unref() {} }),
    pausaMs: 5,
    log: () => {},
  })
  return { noite, pedidos, prs, fenix, avisos, arquivo, autodev: () => estado, voltarParaAMain: () => (noAr = 'main') }
}

test('a hora de parar: 06:30 por padrão, sempre no futuro', () => {
  const agora = new Date(2026, 10, 27, 23, 0)
  assert.equal(new Date(horaDeParar('', agora)).getHours(), 6)
  assert.equal(new Date(horaDeParar('', agora)).getDate(), 28)
  assert.equal(new Date(horaDeParar('5h', agora)).getMinutes(), 0)
  assert.equal(new Date(horaDeParar('23:10', agora)).getDate(), 28, 'daqui a 10 minutos é cedo demais: vira amanhã')
  assert.equal(horaDeParar('25:00', agora), null)
  assert.deepEqual(itensDoTexto('1.3; corrigir o tocador do canto\nitem 2.1'), ['1.3', 'corrigir o tocador do canto', '2.1'])
})

test('a noite inteira: plano, confirmo, um item entra, um quebra e volta, e de manhã o PR em rascunho', async () => {
  const m = montar({ roteiro: ['entra', 'quebra', 'entra'] })
  const plano = await m.noite.acao('planejar', { itens: '1.3; corrigir o tocador do canto da tela', acompanhar: 'dormir' })
  assert.equal(plano.ok, true, plano.mensagem)
  assert.match(plano.mensagem, /2 itens/)
  assert.equal(m.pedidos.length, 0, 'nada começa antes do confirmo')
  const r = await m.noite.acao('comecar')
  assert.equal(r.ok, true, r.mensagem)
  assert.equal(m.fenix[0].type, 'versao:noite')
  assert.equal(m.fenix[0].acao, 'comecar')
  assert.equal(m.noite.silencio(), true)
  await esperar(() => m.noite.resumo().fase === 'terminada')
  const n = JSON.parse(readFileSync(m.arquivo, 'utf8'))
  assert.deepEqual(n.itens.map((i) => [i.status, i.tentativas]), [['feito', 1], ['feito', 2]])
  assert.match(m.pedidos[2], /A tentativa anterior não deu certo: A nova versão parou de responder/)
  assert.equal(m.prs.length, 1)
  assert.equal(m.prs[0].rascunho, true)
  assert.equal(m.prs[0].branch, 'fase-3.7/noite-boa')
  assert.match(m.prs[0].body, /Arquivos sensíveis:\*\* `scripts\/x\.mjs`/)
  assert.equal(n.pr, 'https://github.com/x/y/pull/21')
  assert.equal(m.fenix.at(-1).acao, 'terminar')
  assert.match(m.noite.relatorioDoBomDia(), /fiz 2 de 2 itens/)
  assert.equal(m.avisos.length, 1, 'um aviso só, de manhã')
})

test('três tentativas e desiste; o que toca as travas para como "precisa de você"', async () => {
  const m = montar({ roteiro: ['quebra', 'quebra', 'quebra', 'trava'] })
  await m.noite.acao('planejar', { itens: 'melhorar o painel de notícias; mudar o gate de permissões' })
  await m.noite.acao('comecar')
  await esperar(() => m.noite.resumo().fase === 'terminada')
  const n = JSON.parse(readFileSync(m.arquivo, 'utf8'))
  assert.deepEqual(n.itens.map((i) => [i.status, i.tentativas]), [['descartado', 3], ['precisa', 1]])
  assert.equal(m.prs.length, 0, 'sem nada feito, não há PR')
  assert.match(relatorioDaNoite(n), /precisa de você/)
})

test('a noite não começa com a âncora no ar, sem --writes, ou sem o plano', async () => {
  assert.match((await montar({ ancora: true }).noite.acao('planejar', { itens: '1.3' })).mensagem, /âncora está no ar/)
  assert.match((await montar({ podeEnviar: false }).noite.acao('planejar', { itens: '1.3' })).mensagem, /--writes/)
  assert.equal((await montar().noite.acao('comecar')).ok, false)
  assert.match((await montar().noite.acao('planejar', { itens: '9.9' })).mensagem, /Não há item 9\.9/)
  const semFenix = montar({ fenixOk: false })
  await semFenix.noite.acao('planejar', { itens: '1.3' })
  assert.match((await semFenix.noite.acao('comecar')).mensagem, /Fênix não autorizou/)
})

test('parar a noite no meio guarda o que já ficou bom', async () => {
  const m = montar({ roteiro: ['entra', 'entra', 'entra'] })
  await m.noite.acao('planejar', { itens: '1.3; segundo pedido bem descrito; terceiro pedido bem descrito' })
  await m.noite.acao('comecar')
  await esperar(() => m.noite.resumo().itens[0].status === 'feito')
  await m.noite.acao('parar')
  await esperar(() => m.noite.resumo().fase === 'terminada')
  const n = JSON.parse(readFileSync(m.arquivo, 'utf8'))
  assert.equal(n.motivoDoFim, 'pedido do Ricardo')
  assert.ok(n.itens.some((i) => i.status === 'esperando'), 'o resto não chegou a vez')
  assert.equal(m.prs.length, 1)
})

test('as travas da noite pegam o gate, a política, a âncora e as próprias ADRs', () => {
  assert.ok(TRAVAS_DA_NOITE.length >= 10)
  assert.deepEqual(
    travasTocadas(['bridge/gate.mjs', 'src/App.tsx', 'scripts/ancora/ancora.mjs', 'docs/adr/0040-modo-noturno.md', 'scripts/x.mjs']),
    ['bridge/gate.mjs', 'scripts/ancora/ancora.mjs', 'docs/adr/0040-modo-noturno.md'],
  )
})

test('se a Fênix voltar à main de madrugada (quedas seguidas), a noite para e guarda o que já ficou bom', async () => {
  const m = montar({ roteiro: ['entra', 'entra'] })
  await m.noite.acao('planejar', { itens: '1.3; segundo pedido bem descrito' })
  await m.noite.acao('comecar')
  await esperar(() => m.noite.resumo().itens[0].status === 'feito')
  m.voltarParaAMain()
  await esperar(() => m.noite.resumo().fase === 'terminada')
  const n = JSON.parse(readFileSync(m.arquivo, 'utf8'))
  if (n.itens[1].status === 'esperando') assert.match(n.motivoDoFim, /deixou de ser a da noite/)
  assert.equal(m.prs.length, 1)
  assert.equal(m.prs[0].branch, 'fase-3.7/noite-boa')
})
