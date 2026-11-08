/**
 * O que está aberto no GitHub do projeto, pelo `gh` já logado no Mac.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export async function tarefasDoGithub(repo, { rodar = (args) => exec('gh', args, { timeout: 15_000 }) } = {}) {
  if (!repo) return { disponivel: false, motivo: 'nenhum repositório configurado' }
  try {
    const listar = async (tipo) =>
      JSON.parse((await rodar([tipo, 'list', '--repo', repo, '--state', 'open', '--limit', '10', '--json', 'number,title'])).stdout)
    // Repositório com issues desligadas não é falha: só não há issues.
    const [prs, issues] = await Promise.all([
      listar('pr'),
      listar('issue').catch((err) => (/disabled issues/i.test(err.message) ? [] : Promise.reject(err))),
    ])
    return { disponivel: true, prs, issues }
  } catch (err) {
    return { disponivel: false, motivo: `o gh falhou: ${String(err.message).split('\n')[0]}` }
  }
}
