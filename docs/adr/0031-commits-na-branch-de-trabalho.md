# ADR 0031 — Autodesenvolvimento a partir da versão no ar, um commit por alteração

- **Status:** proposta
- **Data:** 2026-11-12
- **Revisa:** ADR 0015, item 1 ("a `main` é a versão segura; todo trabalho parte dela")

## Contexto

Com a ADR 0015, o autodesenvolvimento só começava com a cópia em execução na
`main`, e aprovar guardava a alteração numa `fase-x.y/nome` nova e voltava à
`main`. Na prática, isso travava o trabalho do dia a dia: com o sistema rodando
numa branch de fase ainda sem merge (a `fase-2.9/asas-proprias`, com o A.U.R.O.R.A.,
o pacto e o Enxame), o Apolo respondia que precisava "voltar à versão principal"
para trocar o ícone do cabeçalho. Voltar à `main` tiraria do ar tudo o que ainda
não entrou nela, e o único caminho seria mesclar código em andamento na `main`
para depois corrigi-lo.

O Ricardo, em 12/11/2026: a trava não faz sentido. O certo é trabalhar em commits
pequenos e variados: terminou um ajuste, testou, funcionou, commita; precisou de
outro, pede, e vira outro commit. Não um commit único no fim de tudo.

## Decisão

1. **O trabalho parte da versão no ar**, se ela for a `main` ou uma branch de fase
   (`fase-x.y/nome`), sem alterações rastreadas pendentes e, se a branch existir no
   GitHub, não atrás dela. Um commit solto, uma `autodev/<id>` em teste ou outra
   branch qualquer recusam, cada um com o motivo.
2. **Uma alteração aprovada é um commit da branch de trabalho, que segue no ar.**
   Partindo de uma branch de fase, ela avança até o commit. Partindo da `main`, nasce
   a `fase-x.y/nome` (ADR 0016), e é ela que fica no ar. Como os arquivos já são os
   do commit aprovado, a Fênix não derruba nem religa nada ao aprovar.
3. **O próximo pedido parte dali** e vira outro commit na mesma branch.
4. **A `main` continua sem commit direto.** A Fênix recusa aprovar para ela, e o
   caminho até ela é o pull request, revisado pelo Ricardo. O pull request de uma
   branch que já tem um só recebe os commits novos com o push.
5. **Descartar, uma queda ou uma partida sem aprovação voltam à versão de onde a
   alteração partiu** (já era assim na Fênix, ADR 0029), e não necessariamente à
   `main`. A Fênix continua atualizando só a `main` (`atualizar`).

O que não muda: a conferência de arquivos protegidos e de invariantes, as
checagens antes do teste, a confirmação falada, o teste sem prazo e o rollback
automático. Alteração em arquivo sensível continua parando numa branch própria,
sem ir ao ar, porque precisa de leitura antes de rodar.

## Consequências

- Ajustes e correções numa feature em andamento saem como commits pequenos, na
  própria branch e no próprio PR, sem passar pela `main`.
- A branch no ar acumula trabalho até o merge. Depois do merge, voltar à `main`
  (e atualizar) é um passo do Ricardo, como antes.
- A regra de Git do AGENTS.md ("toda branch nova parte da `main` atualizada")
  continua valendo para branch nova; o autodesenvolvimento numa branch de fase
  não cria branch, soma commits nela.
- `fenix/src/versoes.mjs` (`aprovar`), `bridge/autodev/index.mjs` (`impedimento`,
  `aprovar`) e `bridge/git.mjs` (PR já existente) mudaram; testes em
  `fenix/test/versoes.test.mjs`, `scripts/autodev.test.mjs`, `scripts/git.test.mjs`
  e o e2e (`scripts/e2e/autodev.mjs`).
