/**
 * O lado da ponte no protocolo Â.N.C.O.R.A. (docs/adr/0041).
 *
 * A ponte não sabe fazer o pânico: ela só sabe se a âncora está instalada, qual é,
 * se está no ar, e como chamá-la. O programa é do root, em /usr/local/bin/ancora,
 * e quem o aciona pela voz é o Ricardo, com o sim conferido na transcrição
 * (src/lib/ancora.ts). Acionada, a âncora derruba esta ponte junto com o resto.
 *
 * Arquivo sensível (bridge/autodev/politica.mjs): ele sobe um processo solto.
 */
import { spawn as spawnPadrao } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const ANCORA_BIN = process.env.APOLO_ANCORA_BIN?.trim() || '/usr/local/bin/ancora'
export const ANCORA_RAIZ = process.env.APOLO_ANCORA_RAIZ?.trim() || '/usr/local/ancora'
export const ANCORA_DADOS = process.env.APOLO_ANCORA_DADOS?.trim() || join(homedir(), '.apolo', 'ancora')

/** Depois disso, o bom dia lembra de congelar uma âncora nova. */
export const ANCORA_VELHA_DIAS = 30

const lerJson = (arquivo) => {
  try {
    return JSON.parse(readFileSync(arquivo, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Instalada, qual, de quando e se está no ar. `shaNoAr` é o commit da cópia em
 * execução: a âncora só está no ar enquanto ele for o dela.
 */
export function estadoDaAncora({ shaNoAr = '', bin = ANCORA_BIN, raiz = ANCORA_RAIZ, dados = ANCORA_DADOS, agora = Date.now() } = {}) {
  const instalada = existsSync(bin)
  const atual = lerJson(join(raiz, 'atual.json'))
  const marca = lerJson(join(dados, 'no-ar.json'))
  const noAr = Boolean(marca && (marca.modo === 'copia' || (shaNoAr && marca.sha === shaNoAr)))
  const dias = atual?.em ? Math.floor((agora - Date.parse(atual.em)) / 86_400_000) : null
  return { instalada, atual, noAr, modo: noAr ? marca.modo : null, dias }
}

/** O estado em frases, para a voz. */
export function textoDaAncora(e) {
  if (!e.instalada) {
    return 'O protocolo âncora não está instalado neste Mac: rode sudo node scripts/ancora/ancora.mjs instalar e depois sudo ancora --atualizar main.'
  }
  const qual = e.atual
    ? `A âncora ${e.atual.n} é o commit ${String(e.atual.sha).slice(0, 7)}, congelado há ${e.dias} ${e.dias === 1 ? 'dia' : 'dias'}.`
    : 'Ainda não há âncora congelada: rode sudo ancora --atualizar main.'
  const onde = e.noAr
    ? e.modo === 'copia'
      ? ' Ela está no ar pela cópia congelada, porque o repositório não estava utilizável.'
      : ' Ela está no ar agora.'
    : ''
  return `${qual}${onde}`
}

/** O lembrete do bom dia, quando a âncora envelhece; null se ela está em dia. */
export function lembreteDaAncora(e) {
  if (!e.instalada || !e.atual || e.dias === null || e.dias <= ANCORA_VELHA_DIAS) return null
  return `A âncora tem ${e.dias} dias. Quando quiser, congele uma nova com sudo ancora --atualizar main.`
}

/**
 * Chama a âncora, solta, e não espera: ela derruba esta ponte. `origem` vai para o
 * registro dela; só palavras conhecidas, nunca texto livre.
 */
export function acionarAncora({ origem = 'voz', bin = ANCORA_BIN, spawn = spawnPadrao } = {}) {
  if (!existsSync(bin)) return { ok: false, mensagem: textoDaAncora({ instalada: false }) }
  const de = ['voz', 'voz-celular'].includes(origem) ? origem : 'voz'
  const filho = spawn(bin, ['--origem', de], { detached: true, stdio: 'ignore' })
  filho.unref?.()
  return { ok: true, mensagem: 'O protocolo âncora foi acionado: tudo vai desligar e voltar na versão de segurança.' }
}
