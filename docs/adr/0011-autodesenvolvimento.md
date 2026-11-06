# ADR 0011 — Autodesenvolvimento com rollback automático

- **Status:** aceita em parte; itens 4, 6, 7 e 8 substituídos pela ADR 0015
- **Data:** 2026-11-03

## Contexto
O Ricardo quer pedir mudanças ao A.P.O.L.O. por voz ou chat, inclusive os
próximos itens do roadmap, e que ele altere o próprio código com o Claude Code,
se reinicie e volte sozinho à versão anterior se a alteração o quebrar.

Isso esbarra em regras do projeto: tudo com efeito passa por um gate negado por
padrão, ninguém commita na `main` e todo trabalho é revisado em pull request.
Além disso, um processo não sobrevive à própria troca, e uma diretiva de
segurança que o agente pudesse editar não protegeria nada.

## Decisão
1. **Desligado por padrão.** Só existe com `npm start -- --autodev`
   (`APOLO_AUTODEV=1`).
2. **Confirmação humana de verdade.** Todo pedido vira uma proposta. A falada é
   conferida contra a transcrição do microfone, feita depois da proposta, e não
   contra o que o modelo de voz diz; na tela, um clique. Assim, um texto malicioso
   recebido por uma ferramenta não aprova nada. O agente de tarefas, que lê a web,
   não tem como iniciar o autodesenvolvimento.
3. **Trabalho isolado.** O Claude Agent SDK roda numa worktree em
   `~/.apolo/autodev`, a partir da versão em execução, sem servidores MCP, sem
   internet, sem as configurações do usuário e com comandos no sandbox do sistema.
   Ele não commita nem instala dependências.
4. **Três níveis de arquivo** (`bridge/autodev/politica.mjs`): proibidos (segredos,
   `.git`) descartam a alteração; sensíveis (gate, supervisor, dependências, regras
   dos agentes) ficam numa branch, sem rodar, para revisão; o resto segue.
5. **Checagens antes da troca:** lint, tipos, build e uma partida da ponte sem
   segredos, em porta própria.
6. **Supervisor fora da ponte** (`scripts/supervisor.mjs`, dentro do `npm start`).
   Ele confere de novo a alteração, registra a transição em disco, troca a branch,
   reinicia a ponte e observa por 60 s. A ponte precisa responder, o Vite precisa
   transformar a interface e, se havia uma página aberta, ela precisa reconectar.
   Qualquer falha dispara o rollback. Uma transição interrompida volta na partida
   seguinte. O Vite não reinicia: a página continua aberta e a sessão de voz, que é
   direta com o provedor, não cai.
7. **A `main` não muda.** A alteração fica em `autodev/<id>` e entra na `main` por
   pull request, como qualquer outra. A cópia em execução fica nessa branch, e a
   alteração seguinte parte dela: é a única exceção à regra de partir da `main`,
   porque ela precisa da versão que está no ar.
8. **VS Code:** a cópia de trabalho abre numa janela nova, para acompanhar. É
   opcional; sem o VS Code, nada muda.

## Consequências
- Pedidos que tocam `bridge/server.mjs` — como migrar a ponte para `core/` — não
  entram no ar sozinhos: ficam na branch para revisão. É o preço de o gate não
  poder ser alterado por quem ele controla.
- A observação cobre quedas e falhas de compilação, não erros de lógica ou um
  defeito visual com a página conectada. Para isso: "volte à versão anterior" por
  voz ou `npm run rollback`.
- A cópia em execução precisa estar sem alterações não commitadas; do contrário, o
  pedido é recusado, para nunca passar por cima do trabalho do Ricardo.
- `src/App.tsx`, onde a confirmação falada é exigida, não é sensível, senão quase
  toda mudança de interface pararia em revisão. Uma alteração confirmada poderia
  afrouxar essa checagem; a revisão no pull request cobre esse caso.
- O agente usa a assinatura Claude. Migrar para `core/providers/` depende só de
  `bridge/autodev/agente.mjs`.
