/**
 * Lê o fenix.config.json do projeto que a F.Ê.N.I.X. guarda.
 *
 * O arquivo é a única coisa que a Fênix sabe do projeto: que serviços subir, como
 * saber se estão de pé, o que exige revisão humana e quais rotinas existem. Ela
 * não importa código do projeto, e é isso que permite levá-la para outro
 * repositório.
 *
 * Toda string aceita `${VAR}` e `${VAR:-padrão}`, lidos do ambiente na partida, e
 * caminhos começando em `~/` vão para a pasta do usuário.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

/** Sem chave dentro do padrão: as de dentro são trocadas primeiro. */
const VARIAVEL = /\$\{(\w+)(?::-([^{}]*))?\}/g

/** Troca `${VAR}` e `${VAR:-padrão}`, também um dentro do outro, pelo valor do ambiente. */
export function expandir(texto, env = process.env) {
  let atual = texto
  for (let i = 0; i < 5; i++) {
    const proximo = atual.replace(VARIAVEL, (_, nome, padrao) => env[nome]?.trim() || padrao || '')
    if (proximo === atual) break
    atual = proximo
  }
  return atual
}

const casa = (caminho) => (caminho.startsWith('~/') ? join(homedir(), caminho.slice(2)) : caminho)

/** Um padrão do arquivo: texto, ou `{ "re": "...", "flags": "i" }`. */
const padrao = (item) =>
  typeof item === 'string' ? new RegExp(item) : new RegExp(String(item.re), item.flags ?? '')

function expandirTudo(valor, env) {
  if (typeof valor === 'string') return expandir(valor, env)
  if (Array.isArray(valor)) return valor.map((v) => expandirTudo(v, env))
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, expandirTudo(v, env)]))
  }
  return valor
}

function exigir(condicao, mensagem) {
  if (!condicao) throw new Error(`fenix.config.json: ${mensagem}`)
}

const NOME = /^[a-z][a-z0-9_-]*$/
/** Ações da própria Fênix: nenhuma rotina do arquivo pode ter estes nomes. */
export const ROTINAS_PROPRIAS = new Set(['reiniciar', 'atualizar', 'diagnostico'])

export function lerConfig(arquivo, envDoTerminal = process.env) {
  const raiz = dirname(resolve(arquivo))
  const json = JSON.parse(readFileSync(arquivo, 'utf8'))
  const caminho = (c) => (isAbsolute(casa(c)) ? casa(c) : resolve(raiz, casa(c)))
  // Os arquivos de ambiente do projeto valem para as variáveis do próprio config e
  // para todos os serviços. O que está no terminal vale mais.
  const doArquivo = Object.assign({}, ...(json.arquivosDeAmbiente ?? []).map((a) => lerAmbiente(caminho(a))))
  const env = { ...doArquivo, ...envDoTerminal }
  const bruto = expandirTudo(json, env)

  exigir(Array.isArray(bruto.servicos) && bruto.servicos.length, 'falta a lista "servicos"')
  const servicos = bruto.servicos.map((s) => {
    exigir(NOME.test(s.nome ?? ''), `serviço sem nome válido: ${JSON.stringify(s.nome)}`)
    exigir(Array.isArray(s.comando) && s.comando.length, `o serviço ${s.nome} não tem "comando"`)
    return {
      nome: s.nome,
      comando: s.comando,
      cor: s.cor ?? '37',
      opcional: s.opcional === true,
      versionado: s.versionado === true,
      // Sobrevive à Fênix: ela o sobe, mas, se cair e voltar, adota a cópia que
      // continuou de pé em vez de derrubá-la (docs/adr/0029).
      independente: s.independente === true,
      portas: (s.portas ?? []).map(Number).filter(Boolean),
      ambiente: Object.fromEntries(
        Object.entries(s.ambiente ?? {}).map(([k, v]) => [k, v.startsWith('~/') ? casa(v) : v]),
      ),
      saude: s.saude
        ? {
            urls: s.saude.urls,
            ca: s.saude.ca ? caminho(s.saude.ca) : null,
            clientes: s.saude.clientes ?? null,
            prazoMs: Number(s.saude.prazoMs ?? 3000),
          }
        : null,
    }
  })

  const rotinas = (bruto.rotinas ?? []).map((r) => {
    exigir(NOME.test(r.nome ?? ''), `rotina sem nome válido: ${JSON.stringify(r.nome)}`)
    exigir(!ROTINAS_PROPRIAS.has(r.nome), `"${r.nome}" é uma rotina da própria Fênix`)
    exigir(Array.isArray(r.comando) && r.comando.length, `a rotina ${r.nome} não tem "comando"`)
    const parametros = Object.fromEntries(
      Object.entries(r.parametros ?? {}).map(([nome, p]) => [
        nome,
        { formato: new RegExp(`^(?:${p.formato})$`), descricao: p.descricao ?? nome, padrao: p.padrao },
      ]),
    )
    return {
      nome: r.nome,
      descricao: r.descricao ?? r.nome,
      comando: r.comando,
      parametros,
      prazoMs: Number(r.prazoMs ?? 600_000),
    }
  })

  const p = bruto.protecao ?? {}
  return {
    arquivo: resolve(arquivo),
    /** O ambiente de partida dos serviços: os arquivos do projeto e o terminal. */
    ambiente: env,
    nome: bruto.nome ?? 'projeto',
    repo: caminho(bruto.repositorio ?? '.'),
    versaoSegura: bruto.versaoSegura ?? 'main',
    pasta: env.FENIX_PASTA?.trim() || caminho(bruto.pasta ?? '~/.fenix'),
    escuta: {
      host: env.FENIX_HOST?.trim() || bruto.escuta?.host || '127.0.0.1',
      // 0 é válido: pede ao sistema uma porta livre.
      porta: Number(env.FENIX_PORTA || (bruto.escuta?.porta ?? 8790)),
    },
    tls:
      bruto.tls?.cert && bruto.tls?.key ? { cert: caminho(bruto.tls.cert), key: caminho(bruto.tls.key) } : null,
    preparar: bruto.preparar ?? [],
    servicos,
    flags: Object.fromEntries(
      Object.entries(bruto.flags ?? {}).map(([flag, f]) => [
        flag,
        { ambiente: f.ambiente ?? {}, comandosLivres: f.comandosLivres === true },
      ]),
    ),
    protecao: {
      revisao: (p.revisao ?? []).map(padrao),
      liberados: new Set(p.liberados ?? []),
      invariantes: (p.invariantes ?? []).map((i) => ({ arquivo: i.arquivo, contem: i.contem.map(padrao) })),
      branch: p.branch ? padrao(p.branch) : /^[\w./-]+$/,
    },
    instalar: bruto.instalar
      ? { comando: bruto.instalar.comando, quando: bruto.instalar.quando.map(padrao) }
      : null,
    rotinas,
    notificacoes:
      bruto.notificacoes?.url && bruto.notificacoes?.token
        ? {
            url: bruto.notificacoes.url,
            token: bruto.notificacoes.token,
            ca: bruto.notificacoes.ca ? caminho(bruto.notificacoes.ca) : null,
          }
        : null,
    tempos: tempos(bruto.tempos),
    comandos: {
      prazoMs: Number(bruto.comandos?.prazoMs ?? 120_000),
      validadeMs: Number(bruto.comandos?.validadeMs ?? 300_000),
    },
  }
}

/**
 * Os prazos da guardiã e das versões, para quem precisa de outros (um projeto
 * lento, os testes de resiliência). Só números, e só os que existem; o resto fica
 * com o padrão do código.
 */
const TEMPOS = {
  servicos: ['estavelMs', 'intervaloMs', 'subidaMs'],
  versoes: ['subidaMs', 'estabilidadeMs', 'intervaloMs', 'vigiaMs'],
}
function tempos(bruto) {
  const saida = {}
  for (const [parte, campos] of Object.entries(TEMPOS)) {
    const dados = bruto?.[parte] ?? {}
    const valores = Object.fromEntries(
      campos.filter((c) => Number(dados[c]) > 0).map((c) => [c, Number(dados[c])]),
    )
    if (parte === 'servicos' && Array.isArray(dados.esperasMs) && dados.esperasMs.every((n) => Number(n) > 0)) {
      valores.esperasMs = dados.esperasMs.map(Number)
    }
    saida[parte] = valores
  }
  return saida
}

/** Lê um arquivo .env simples: CHAVE=valor, com # de comentário. */
export function lerAmbiente(arquivo) {
  let texto
  try {
    texto = readFileSync(arquivo, 'utf8')
  } catch {
    return {}
  }
  const valores = {}
  for (const linha of texto.split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/.exec(linha)
    if (!m) continue
    let valor = m[2]
    if (/^(['"]).*\1$/.test(valor)) valor = valor.slice(1, -1)
    else valor = valor.replace(/\s+#.*$/, '')
    valores[m[1]] = valor
  }
  return valores
}
