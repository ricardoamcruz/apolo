/**
 * Carrega o `.env.local` antes de todo o resto.
 *
 * Em ESM, os módulos importados são avaliados antes do corpo de quem importa.
 * Enquanto a leitura do arquivo ficava dentro de `bridge/server.mjs`, todos os
 * módulos importados por ele — `autodev/politica.mjs`, `autodev/index.mjs`,
 * `autodev/agente.mjs` — já tinham lido `process.env` quando a leitura
 * acontecia. Variáveis como `APOLO_AUTODEV_MODELO`, `APOLO_AUTODEV_PASTA` ou
 * `JARVIS_MODEL` definidas no `.env.local` simplesmente não tinham efeito: só
 * valiam se vindas do terminal.
 *
 * Por isso isto é um módulo à parte, e tem de ser o **primeiro import** de todo
 * ponto de entrada que leia configuração: `bridge/server.mjs`,
 * `scripts/start.mjs` e `scripts/rollback.mjs`.
 *
 * O caminho sai da localização deste arquivo, e não do diretório de trabalho,
 * para valer igual quando a cópia em execução é uma worktree do
 * autodesenvolvimento. Variáveis já definidas no terminal continuam tendo
 * prioridade sobre o arquivo — é assim que `npm start -- --autodev` liga o
 * autodesenvolvimento só para aquela execução.
 */

import { fileURLToPath } from 'node:url'

try {
  process.loadEnvFile(fileURLToPath(new URL('../.env.local', import.meta.url)))
} catch {
  /* sem `.env.local`, ou sem permissão de leitura: tudo bem */
}
