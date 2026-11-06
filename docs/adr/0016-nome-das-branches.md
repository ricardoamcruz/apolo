# ADR 0016 — Numeração e nome das branches

- **Status:** aceita
- **Data:** 2026-11-06

## Contexto
O Ricardo definiu um padrão para as branches, válido para todos os agentes. O
autodesenvolvimento usava `fase-x.x/nome-curto`, com a fase escolhida pelo agente
a partir do roadmap, e o agente roda sem enxergar todas as branches com segurança.

## Decisão
1. Toda branch nova é `fase-x.y/<nome-criativo>`, partindo da `main` atualizada.
2. Cada branch nova soma 0.1 à maior já usada: depois de `fase-2.3` vem `fase-2.4`.
   A conta é de inteiros: depois de `fase-2.9` vem `fase-2.10`.
3. Ao mudar de fase, a numeração recomeça em `fase-x/<nome>`, com x = fase anterior
   + 1, e segue em `fase-x.1/<nome>`. Mudar de fase é decisão do Ricardo: no
   código, isso é `APOLO_AUTODEV_FASE=x`.
4. O nome é criativo e amplo: evoca a entrega inteira, porque a branch pode receber
   mais coisas antes do merge.
5. No autodesenvolvimento, o agente escolhe só o nome, e `bridge/branches.mjs` dá o
   número. A conta usa as branches locais, as do `origin` e as mensagens de merge
   da `main`, para que apagar uma branch integrada não faça o número voltar.

## Consequências
`git_status` informa o número da próxima branch, e o agente de tarefas só precisa
do nome. Merges feitos sem a mensagem padrão não entram na conta depois que a
branch for apagada; o pior caso é repetir um número, sem colisão de nome graças
ao sufixo de `nomeLivre`. Agentes externos seguem a regra pelo `AGENTS.md`.
