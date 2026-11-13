/**
 * O H.E.R.M.E.S. de pé sem quem o subiu (docs/adr/0029).
 *
 * Quem sobe o H.E.R.M.E.S. (a F.Ê.N.I.X., ou um terminal) lê a saída dele por um
 * cano. Se esse processo morre, o cano quebra: escrever nele dá EPIPE, e um
 * 'error' sem ouvinte derruba o processo no primeiro console.log. Aqui o cano
 * quebrado vira um arquivo de registro, com uma linha dizendo o que aconteceu, e
 * o serviço continua atendendo o celular e as notificações.
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { format } from 'node:util'

/**
 * @param nome      como o serviço se apresenta no registro
 * @param arquivo   para onde a saída vai depois que o cano quebrar
 * @param pai       o processo que o subiu; se ele sair, o registro diz
 */
export function protegerSaidas({ nome, arquivo, pai = process.ppid, intervaloMs = 2000 }) {
  let desviado = false
  const escrever = (...partes) => {
    try {
      mkdirSync(dirname(arquivo), { recursive: true })
      appendFileSync(arquivo, `${new Date().toISOString()} ${format(...partes)}\n`)
    } catch {
      /* sem registro, mas de pé */
    }
  }
  const desviar = (motivo) => {
    if (desviado) return
    desviado = true
    console.log = console.info = console.warn = console.error = escrever
    escrever(`[${nome}] ${motivo}; sigo de pé sozinho e registro a saída aqui.`)
  }
  for (const saida of [process.stdout, process.stderr]) {
    saida.on('error', (err) => desviar(`a saída do terminal quebrou (${err.code ?? err.message})`))
  }
  // Órfão: o sistema troca o pai. Avisado aqui, antes da primeira linha perdida.
  const vigia = setInterval(() => {
    if (pai > 1 && process.ppid !== pai) {
      clearInterval(vigia)
      desviar(`quem me subiu (processo ${pai}) saiu`)
    }
  }, intervaloMs)
  vigia.unref()
  return { desviado: () => desviado, arquivo }
}
