/**
 * A Fênix renasce de propósito no código novo (docs/adr/0041, revisão do pacto).
 *
 * Ela troca a versão do projeto, mas continua rodando com o código de quando subiu.
 * Quando uma troca, uma aprovação ou uma atualização concluída muda o código dela
 * (a pasta da Fênix ou o arquivo de configuração), ela:
 *
 *   1. derruba os serviços e o canal;
 *   2. sobe uma Fênix nova, solta, com o mesmo comando;
 *   3. espera a nova responder com os serviços de pé;
 *   4. sai, se a nova ficou de pé. Se não ficou, mata a nova e chama o último
 *      recurso (no A.P.O.L.O., a âncora); sem ele, retoma o posto com o código
 *      dela e avisa.
 *
 * Nada aqui sabe do A.P.O.L.O.: o último recurso é um comando do fenix.config.json.
 */
import { spawn as spawnPadrao } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'

export const PRAZO_DA_NOVA_MS = 120_000

/**
 * @param git           roda o Git na pasta do projeto e devolve a saída
 * @param shaDaPartida  o commit em que esta Fênix subiu (ou uma função que o devolve)
 * @param caminhos      o que é o código dela, como o Git entende ("fenix/", "fenix.config.json")
 * @param receita       `{ comando, cwd, saida, env }`: como subir uma Fênix nova
 * @param ocupado       há uma troca ou um teste em andamento? Então não é hora
 * @param encerrar      derruba os serviços e fecha o canal
 * @param retomar       reabre o canal e sobe os serviços de novo, nesta mesma Fênix
 * @param respondeu     a Fênix nova está de pé, com os serviços? (pergunta pelo canal)
 * @param ultimoRecurso o comando de pânico, ou null
 */
export function criarRenovacao({
  git,
  shaDaPartida,
  caminhos,
  receita,
  ocupado = () => false,
  encerrar,
  retomar,
  respondeu,
  ultimoRecurso = null,
  anotar = console.log,
  avisar = () => {},
  sair = () => process.exit(0),
  spawn = spawnPadrao,
  existe = existsSync,
  prazoMs = PRAZO_DA_NOVA_MS,
  intervaloMs = 2000,
}) {
  const partida = typeof shaDaPartida === 'function' ? shaDaPartida : () => shaDaPartida
  let renovando = false
  /** Um commit cuja Fênix nova já falhou: não se tenta de novo o mesmo. */
  let desistiDe = null
  const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms))

  /** Os arquivos da Fênix que mudaram desde a partida; vazio se nenhum. */
  async function mudancas() {
    const de = partida()
    if (!de || !receita || !caminhos.length) return []
    const agora = await git('rev-parse', 'HEAD').catch(() => '')
    if (!agora || agora === de || agora === desistiDe) return []
    const nomes = await git('diff', '--name-only', de, agora, '--', ...caminhos).catch(() => '')
    return nomes.split('\n').filter(Boolean)
  }

  function subir(comando, args, env) {
    let fd
    try {
      mkdirSync(dirname(receita.saida), { recursive: true })
      fd = openSync(receita.saida, 'a')
      const filho = spawn(comando, args, { cwd: receita.cwd, env, detached: true, stdio: ['ignore', fd, fd] })
      filho.unref?.()
      return filho
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
  }

  const matar = (filho) => {
    for (const alvo of [-filho.pid, filho.pid]) {
      try {
        process.kill(alvo, 'SIGKILL')
        return
      } catch {
        /* o grupo pode não existir; tenta o processo */
      }
    }
  }

  async function renovar(nomes) {
    renovando = true
    const agora = await git('rev-parse', 'HEAD').catch(() => '?')
    anotar(`[fenix] meu código mudou (${nomes.slice(0, 4).join(', ')}${nomes.length > 4 ? '...' : ''}); renascendo no código novo`)
    await encerrar()
    const [comando, ...args] = receita.comando
    let nova
    try {
      nova = subir(comando, args, { ...receita.env, FENIX_RENOVADA: '1' })
    } catch (err) {
      anotar(`[fenix] não consegui subir a Fênix nova: ${err.message}`)
      return falhou(null, agora)
    }
    const limite = Date.now() + prazoMs
    while (Date.now() < limite) {
      await dormir(intervaloMs)
      if (await respondeu().catch(() => false)) {
        anotar(`[fenix] a Fênix nova está de pé (processo ${nova.pid}); saio do caminho`)
        sair()
        return true
      }
    }
    anotar(`[fenix] a Fênix nova não ficou de pé em ${Math.round(prazoMs / 1000)} s`)
    matar(nova)
    return falhou(nova, agora)
  }

  async function falhou(_nova, sha) {
    if (ultimoRecurso?.length && existe(ultimoRecurso[0])) {
      const [comando, ...args] = ultimoRecurso
      try {
        subir(comando, [...args, '--origem', 'fenix', '--motivo', 'a Fênix nova não ficou de pé'], receita.env)
        anotar(`[fenix] chamei o último recurso: ${ultimoRecurso.join(' ')}`)
        avisar('A Fênix nova não ficou de pé, e eu chamei a âncora para pôr a versão segura no ar.')
        sair()
        return false
      } catch (err) {
        anotar(`[fenix] o último recurso não subiu: ${err.message}`)
      }
    }
    desistiDe = sha
    await retomar()
    renovando = false
    anotar('[fenix] retomei o posto com o meu código de antes; a versão no ar continua a mesma')
    avisar('A Fênix nova não ficou de pé. Continuo com a Fênix de antes; a versão no ar continua a mesma.')
    return false
  }

  return {
    renovando: () => renovando,
    mudancas,
    /** Se o código dela mudou e nada está em andamento, renasce. Nunca rejeita. */
    async talvez() {
      if (renovando || ocupado()) return false
      try {
        const nomes = await mudancas()
        if (!nomes.length || renovando || ocupado()) return false
        return await renovar(nomes)
      } catch (err) {
        renovando = false
        anotar(`[fenix] a renovação falhou: ${err.message}`)
        return false
      }
    },
  }
}
