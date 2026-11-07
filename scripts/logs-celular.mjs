/**
 * Mostra o que o app do celular mediu (docs/adr/0020).
 *
 *   npm run logs:celular            hoje
 *   npm run logs:celular -- 7       últimos 7 dias
 *   npm run logs:celular -- 1 --eventos   e também as quedas e os erros, um a um
 */
import process from 'node:process'
import { PASTA_DE_LOGS, lerEventos, resumir } from '../bridge/telemetria.mjs'

const LEGENDA = {
  ping: 'iPhone até o Mac e de volta (Tailscale)',
  canal_conectou: 'abrir a conexão com o Mac',
  canal_caiu: 'tempo conectado antes de cair',
  canal_aberto: 'tempo com a conexão aberta (visto do Mac)',
  credencial: 'pedir a credencial da voz ao Mac',
  voz_abriu: 'abrir a voz, da credencial ao Google',
  voz_resposta: 'você parar de falar até ele começar a falar',
  voz_transcricao: 'você começar a falar até a primeira palavra na tela',
  tarefa: 'tarefa inteira, vista do iPhone',
  tarefa_primeiro_texto: 'tarefa até o primeiro texto do agente',
  tarefa_agente: 'tarefa inteira, vista do Mac (só o agente)',
  tarefa_primeira_ferramenta: 'tarefa até o agente começar a agir',
}

const dias = Number(process.argv.find((a) => /^\d+$/.test(a))) || 1
const inicio = new Date()
inicio.setHours(0, 0, 0, 0)
inicio.setDate(inicio.getDate() - (dias - 1))

const eventos = lerEventos({ desde: inicio.getTime() })
if (!eventos.length) {
  console.log(`Nada registrado desde ${inicio.toLocaleDateString('pt-BR')} em ${PASTA_DE_LOGS}.`)
  process.exit(0)
}

const coluna = (texto, largura) => String(texto).padEnd(largura)
console.log(`${eventos.length} eventos desde ${inicio.toLocaleDateString('pt-BR')}. Tempos em ms.\n`)
console.log(`${coluna('medida', 24)}${coluna('rede', 10)}${coluna('vezes', 7)}${coluna('mediana', 9)}${coluna('p95', 8)}${coluna('máx', 8)}o que é`)
for (const l of resumir(eventos)) {
  console.log(
    `${coluna(l.nome, 24)}${coluna(l.rede, 10)}${coluna(l.vezes, 7)}${coluna(l.mediana, 9)}${coluna(l.p95, 8)}${coluna(l.max, 8)}${LEGENDA[l.nome] ?? ''}`,
  )
}

if (process.argv.includes('--eventos')) {
  console.log('\nEventos sem duração e quedas:')
  for (const e of eventos) {
    if (e.ms !== undefined && e.nome !== 'canal_caiu' && e.nome !== 'tarefa_agente') continue
    const hora = new Date(e.t).toLocaleTimeString('pt-BR')
    console.log(`${hora}  ${e.nome}  ${e.ms ?? ''}  ${e.info ?? ''} ${e.rede ?? ''}`.trimEnd())
  }
}
