/**
 * Política de segurança do autodesenvolvimento — ver docs/adr/0011.
 *
 * Três regras, nesta ordem de força:
 *
 *   1. PROIBIDOS: o agente nunca toca, e uma alteração que os contenha é
 *      descartada. São os segredos e o próprio Git.
 *   2. SENSIVEIS: o que sustenta a segurança do sistema — o gate, o supervisor,
 *      as dependências, as regras dos agentes. O agente pode propor a mudança,
 *      mas ela para na branch: nem roda nem entra sozinha, só por revisão humana.
 *      Sem isso, a diretiva de rollback poderia ser desligada por quem ela vigia.
 *   3. O resto vale na hora, desde que passe nas checagens e sobreviva ao
 *      período de observação do supervisor.
 *
 * Quem aplica estas regras de verdade é a comparação do resultado final (o
 * commit), feita pela ponte e de novo pelo supervisor. As barreiras durante o
 * trabalho do agente só evitam tentativa desperdiçada: o que vale é o que ficou.
 */

import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

/** Fora do repositório de propósito: o Vite, o tsc e o oxlint varrem a raiz. */
export const PASTA_AUTODEV =
  process.env.APOLO_AUTODEV_PASTA?.trim() || join(homedir(), '.apolo', 'autodev')

export const PROIBIDOS = [
  /(^|\/)\.env(\.[^/]*)?$/,
  /(^|\/)\.git(\/|$)/,
  /\.(pem|key|p12|mobileprovision)$/i,
]
/** O modelo de variáveis não tem segredo nenhum e precisa acompanhar o código. */
const LIBERADOS = new Set(['.env.example'])

export const SENSIVEIS = [
  // O supervisor e a inicialização.
  /^scripts\//,
  /^bridge\/autodev\//,
  // O gate, o sandbox do agente, a proteção SSRF e o saneamento do HTML.
  /^bridge\/server\.mjs$/,
  // Roda antes de todo o resto e decide a configuração que o gate lê.
  /^bridge\/env\.mjs$/,
  // Commita e envia código do próprio projeto: quem pode mexer nele pode
  // mudar o que vai para a main.
  /^bridge\/git\.mjs$/,
  /^bridge\/net\.mjs$/,
  /^bridge\/page\.mjs$/,
  /^bridge\/chrome\.mjs$/,
  /^src\/ui\/sanitise\.ts$/,
  /^src\/lib\/autodev\.ts$/,
  // CSP e o que roda como código de configuração, fora do navegador.
  /^index\.html$/,
  /^vite\.config\.ts$/,
  /^\.oxlintrc\.json$/,
  // Dependências: `npm install` roda scripts de terceiros nesta máquina.
  /^package(-lock)?\.json$/,
  // Regras dos agentes e automações.
  /^(AGENTS|CLAUDE|GEMINI)\.md$/,
  /^\.github\//,
  /^\.claude\//,
  /^\.gitignore$/,
]

const proibido = (rel) => !LIBERADOS.has(rel) && PROIBIDOS.some((re) => re.test(rel))

/** Separa os arquivos alterados pelo que eles exigem. */
export function classificar(arquivos) {
  return {
    proibidos: arquivos.filter(proibido),
    sensiveis: arquivos.filter((f) => !proibido(f) && SENSIVEIS.some((re) => re.test(f))),
  }
}

/** Resolve os links do trecho que já existe; um arquivo novo ainda não existe. */
function realDe(caminho) {
  try {
    return realpathSync(caminho)
  } catch {
    const pai = dirname(caminho)
    return pai === caminho ? caminho : join(realDe(pai), relative(pai, caminho))
  }
}

/** Se uma ferramenta de arquivo pode escrever neste caminho. */
export function escritaPermitida(raiz, caminho) {
  if (typeof caminho !== 'string' || !caminho) return false
  const base = realDe(raiz)
  const alvo = realDe(resolve(raiz, caminho))
  const rel = relative(base, alvo)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return false
  if (rel === 'node_modules' || rel.startsWith('node_modules/')) return false
  return !proibido(rel)
}

/**
 * Se uma ferramenta de arquivo pode ler este caminho. O sandbox só cobre o Bash:
 * sem isto, Read, Grep e Glob alcançariam o .env.local e as chaves da máquina.
 * Fora da cópia, só as dependências, para consultar os tipos.
 */
export function leituraPermitida(raiz, repo, caminho) {
  if (caminho === undefined || caminho === null || caminho === '') return true
  if (typeof caminho !== 'string') return false
  const alvo = realDe(resolve(raiz, caminho))
  const dentro = (base) => {
    const rel = relative(realDe(base), alvo)
    return !rel.startsWith('..') && !isAbsolute(rel)
  }
  if (dentro(join(repo, 'node_modules'))) return true
  return dentro(raiz) && !proibido(relative(realDe(raiz), alvo))
}

/** Sem encadeamento, redirecionamento nem substituição: um comando por vez. */
const SHELL_ESPECIAL = /[;&|`$<>\n\\]/
const COMANDOS = [
  /^npm run (lint|build)$/,
  /^npx (tsc|oxlint)( |$)/,
  /^git (status|diff|log|show)( |$)/,
  /^(ls|pwd|wc|head|tail|cat|grep|rg|find)( |$)/,
]
const OPCAO_PERIGOSA = /(^| )(-exec|-execdir|-ok|-delete|-fprint\S*|--output\S*)( |=|$)/

/** Só o que serve para ler o projeto e conferir o próprio trabalho. */
export function comandoPermitido(comando) {
  if (typeof comando !== 'string') return false
  const c = comando.trim()
  if (!c || SHELL_ESPECIAL.test(c) || OPCAO_PERIGOSA.test(c)) return false
  return COMANDOS.some((re) => re.test(c))
}

/** O que nenhum comando do agente lê, mesmo dentro do sandbox. */
export const leiturasNegadas = (repo) => [
  join(repo, '.env.local'),
  ...['.ssh', '.aws', '.gnupg', '.config', '.claude', '.claude.json', '.npmrc', '.netrc'].map(
    (nome) => join(homedir(), nome),
  ),
]
