/**
 * Rotinas e comandos livres da F.Ê.N.I.X.
 *
 * Rotina é uma linha do fenix.config.json: um programa e argumentos fixos, sem
 * shell, revisados junto com o código. Parâmetro só entra se casar com o formato
 * declarado — `{nivel}` com `100|[1-9]?[0-9]`, por exemplo —, então nada do que o
 * modelo disser vira código.
 *
 * Comando livre é o contrário: um script bash qualquer. Por isso ele nunca roda
 * na hora. Vira uma proposta, que só roda com a confirmação do Ricardo, dentro do
 * prazo, e exatamente com o texto proposto. Fica desligado sem a opção que o
 * libera (no A.P.O.L.O., `--writes`), e bloqueado enquanto houver uma versão sem
 * revisão no ar: é ela que estaria pedindo.
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

export const SAIDA_MAX = 4000
const SCRIPT_MAX = 4000

/** Nenhum segredo do ambiente chega a um comando livre. */
const SEGREDO = /KEY|TOKEN|SECRET|SEGREDO|SENHA|PASSWORD|PASSWD|CREDENC|COOKIE|AUTH/i
export const semSegredos = (env) => Object.fromEntries(Object.entries(env).filter(([k]) => !SEGREDO.test(k)))

/** Monta os argumentos de uma rotina, recusando parâmetro fora do formato. */
export function montar(rotina, valores = {}) {
  const desconhecidos = Object.keys(valores ?? {}).filter((k) => !(k in rotina.parametros))
  if (desconhecidos.length) throw new Error(`a rotina ${rotina.nome} não tem ${desconhecidos.join(', ')}`)
  const finais = {}
  for (const [nome, p] of Object.entries(rotina.parametros)) {
    const valor = String(valores?.[nome] ?? p.padrao ?? '')
    if (!p.formato.test(valor)) throw new Error(`valor inválido para ${nome}: ${p.descricao}`)
    finais[nome] = valor
  }
  return rotina.comando.map((arg) => arg.replace(/\{(\w+)\}/g, (inteiro, k) => (k in finais ? finais[k] : inteiro)))
}

/** Roda sem shell, com prazo. Guarda o fim da saída, que é onde fica o erro. */
export function rodar([comando, ...args], { cwd, env = process.env, prazoMs = 600_000, saidaMax = SAIDA_MAX }) {
  return new Promise((resolve) => {
    const inicio = Date.now()
    let saida = ''
    let estourou = false
    const guardar = (d) => {
      saida = (saida + d.toString()).slice(-saidaMax * 2)
    }
    let filho
    try {
      filho = spawn(comando === 'node' ? process.execPath : comando, args, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (err) {
      return resolve({ ok: false, codigo: -1, saida: err.message, tempoMs: 0 })
    }
    const prazo = setTimeout(() => {
      estourou = true
      filho.kill('SIGTERM')
      setTimeout(() => filho.kill('SIGKILL'), 5000).unref()
    }, prazoMs)
    filho.stdout.on('data', guardar)
    filho.stderr.on('data', guardar)
    let terminou = false
    const fim = (codigo, extra = '') => {
      if (terminou) return
      terminou = true
      clearTimeout(prazo)
      const texto = (saida + extra).trim()
      resolve({
        ok: codigo === 0 && !estourou,
        codigo,
        estourou,
        tempoMs: Date.now() - inicio,
        saida: texto.length > saidaMax ? `…${texto.slice(-saidaMax)}` : texto,
      })
    }
    filho.on('error', (err) => fim(-1, `\n${err.message}`))
    filho.on('close', (codigo, sinal) => fim(codigo ?? sinal))
  })
}

/**
 * @param habilitado  se os comandos livres foram liberados na partida
 * @param bloqueio    devolve o motivo de recusar agora, ou null
 */
export function criarComandos({
  repo,
  pasta,
  habilitado = false,
  bloqueio = () => null,
  prazoMs = 120_000,
  validadeMs = 300_000,
  ambiente = process.env,
  log = console.log,
}) {
  const propostas = new Map()
  const registro = join(pasta, 'comandos.log')

  /** O script e o código de saída. A saída fica fora: pode ter dado sensível. */
  const anotar = (linha) => {
    log(linha)
    try {
      appendFileSync(registro, `${new Date().toISOString()} ${linha}\n`)
    } catch {
      /* o registro nunca impede um comando */
    }
  }

  const limpar = () => {
    for (const [id, p] of propostas) if (Date.now() > p.expiraEm) propostas.delete(id)
  }

  return {
    habilitado: () => habilitado,

    pendentes() {
      limpar()
      return [...propostas.values()]
    },

    propor({ script, motivo }) {
      if (!habilitado) {
        return { ok: false, mensagem: 'Comandos livres estão desligados nesta partida.' }
      }
      const barrado = bloqueio()
      if (barrado) return { ok: false, mensagem: barrado }
      const texto = typeof script === 'string' ? script.trim() : ''
      if (!texto) return { ok: false, mensagem: 'O comando veio vazio.' }
      if (texto.length > SCRIPT_MAX) return { ok: false, mensagem: 'O comando é longo demais para confirmar de olho.' }
      limpar()
      const agora = Date.now()
      const proposta = {
        id: randomUUID(),
        script: texto,
        motivo: String(motivo ?? '').slice(0, 300),
        criadaEm: agora,
        expiraEm: agora + validadeMs,
      }
      propostas.set(proposta.id, proposta)
      anotar(`[fenix] comando proposto ${proposta.id}: ${texto.replace(/\n/g, ' ⏎ ')}`)
      return { ok: true, proposta }
    },

    async confirmar(id) {
      limpar()
      const proposta = propostas.get(id)
      if (!proposta) return { ok: false, mensagem: 'Essa proposta não existe mais ou já expirou.' }
      propostas.delete(id)
      const barrado = bloqueio()
      if (barrado) return { ok: false, mensagem: barrado }
      anotar(`[fenix] rodando ${id}`)
      const r = await rodar(['/bin/bash', '-c', proposta.script], {
        cwd: repo,
        env: semSegredos(ambiente),
        prazoMs,
      })
      anotar(`[fenix] ${id} terminou com ${r.estourou ? 'o prazo estourado' : `o código ${r.codigo}`}`)
      return { ...r, mensagem: r.ok ? 'O comando terminou bem.' : 'O comando falhou.' }
    },

    cancelar(id) {
      const havia = propostas.delete(id)
      if (havia) anotar(`[fenix] comando ${id} cancelado`)
      return { ok: havia, mensagem: havia ? 'Cancelado.' : 'Essa proposta não existe mais.' }
    },
  }
}
