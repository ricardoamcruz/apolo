/**
 * O que o A.P.O.L.O. lembra entre uma execução e outra (RF-57, docs/adr/0018).
 *
 * Fica na ponte, e não no navegador: assim sobrevive a outro navegador e às trocas
 * de versão do autodesenvolvimento. Só aceita as chaves conhecidas, porque o que
 * chega aqui vem pela rede. Quando a memória da Fase 1 existir, isto muda para lá.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const PADRAO = { exibirPonte: false, exibirChat: false }

const validas = (dados) =>
  Object.fromEntries(
    Object.keys(PADRAO)
      .filter((chave) => typeof dados?.[chave] === 'boolean')
      .map((chave) => [chave, dados[chave]]),
  )

const ARQUIVO = process.env.APOLO_PREFERENCIAS ?? join(homedir(), '.apolo', 'preferencias.json')

export function criarPreferencias(arquivo = ARQUIVO) {
  let valores = { ...PADRAO }
  try {
    valores = { ...PADRAO, ...validas(JSON.parse(readFileSync(arquivo, 'utf8'))) }
  } catch {
    /* primeira vez, ou arquivo ilegível: vale o padrão */
  }
  return {
    valores: () => valores,
    gravar(patch) {
      valores = { ...valores, ...validas(patch) }
      mkdirSync(dirname(arquivo), { recursive: true })
      writeFileSync(arquivo, JSON.stringify(valores, null, 2))
      return valores
    },
  }
}
