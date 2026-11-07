/**
 * O padrão de cores do A.P.O.L.O. (docs/adr/0021): uma cor para cada coisa que ele
 * pode estar fazendo, igual no PC e no celular. Sem dependências, porque o app do
 * iPhone carrega este arquivo por fora do projeto mobile.
 */
export const CORES_DE_ESTADO = {
  desconectado: '#0d4a4a',
  /** Em pausa, espera, escuta passiva. */
  repouso: '#19d8d2',
  ouvindo: '#3ef2a8',
  /** Pesquisando, processando, calculando. */
  processando: '#ffd23c',
  /** Rodando script. */
  executando: '#c9a2ff',
  /** Alterando código ou a própria configuração. */
  codificando: '#ff4d4d',
  respondendo: '#d8f6fa',
} as const

/** O que uma tarefa pode estar fazendo agora. */
export type Atividade = 'processando' | 'executando' | 'codificando'

const ALTERA_CODIGO = /(^|_)(edit|multiedit|notebookedit|write|autodev|desenvolvimento)($|_)|git_(commit|push|branch|pull_request|pr)/
const RODA_SCRIPT = /(^|_)(bash|shell|terminal|exec|script|powershell|zsh)($|_)/

/** Pelo nome cru da ferramenta. O que não for reconhecido só está processando. */
export function atividadeDaFerramenta(nome: string): Atividade {
  const n = nome.toLowerCase()
  if (ALTERA_CODIGO.test(n)) return 'codificando'
  if (RODA_SCRIPT.test(n)) return 'executando'
  return 'processando'
}

export const ROTULO_DE_ATIVIDADE: Record<Atividade, string> = {
  processando: 'PROCESSANDO',
  executando: 'EXECUTANDO',
  codificando: 'CODIFICANDO',
}
