# ADR 0015 — Ciclo de teste do autodesenvolvimento

- **Status:** aceita
- **Data:** 2026-11-06

## Contexto
O autodesenvolvimento da ADR 0011 não entregava o que o Ricardo pediu: codificar,
reiniciar no código novo para testar, voltar à versão segura se algo der errado ou
se ele não gostar e, se der certo, guardar numa branch `fase-x.x/nome`.

A reprodução real (ponte, Vite, supervisor e Chrome, com agente falso) mostrou que
a troca de versão funcionava e que o problema estava em volta dela:

- Depois de perder a ponte, a página tentava reconectar uma vez só. Se a ponte
  demorasse mais de 500 ms, ficava desconectada, o supervisor desfazia uma alteração
  boa e o aviso do rollback não chegava a ninguém.
- 6 de 8 alterações tocavam arquivos sensíveis e não podiam entrar no ar. Uma delas
  só por atualizar o `AGENTS.md`, como a regra de documentação manda.
- Passados os 60 s de observação, uma alteração virava definitiva: uma queda depois
  disso derrubava tudo, e o `npm start` seguinte subia a versão quebrada de novo.
- Rollback voltava uma versão, não à versão segura; as `autodev/*` se acumulavam.
- A voz chegou a mandar "confirmo" como pedido, e o agente, sem instrução, escolheu
  sozinho o próximo item do roadmap.
- Os logs se perdiam a cada partida, sem registro do motivo de um rollback.

## Decisão
1. **A `main` é a versão segura.** Todo trabalho parte dela. O pedido é recusado se
   a cópia em execução estiver em outra branch, tiver alterações não commitadas ou
   se a `main` local estiver atrás do GitHub. Substitui o item 7 da ADR 0011.
2. **Em teste, sem prazo.** Depois das checagens, o supervisor troca a versão e
   confere a subida por até 30 s. Então a alteração fica em teste até o Ricardo
   decidir, com `transicao.json` em disco. Substitui o item 6 da ADR 0011.
3. **Três saídas, e nada de `autodev/*` depois delas.**
   - Aprovar: a branch vira `fase-x.x/nome`, com o commit titulado pelo agente, e o
     A.P.O.L.O. volta à `main`. A feature só volta ao ar depois do merge. Aprovar por
     voz exige a fala do Ricardo, conferida como a confirmação.
   - Descartar: volta à `main` e apaga a branch.
   - Queda ou saúde falhando três vezes seguidas: o mesmo, sozinho e a qualquer
     momento do teste. Com o sistema parado, vale na partida seguinte.
4. **O commit descartado é recuperável.** O sha fica em `eventos.log`, que guarda
   também o motivo de cada rollback.
5. **Arquivos sensíveis.** Substitui em parte o item 4 da ADR 0011:
   - os `.md` de regras saem da lista: são texto, não executam no teste;
   - o gate vai para `bridge/gate.mjs`, sensível, e `bridge/server.mjs` deixa de ser;
   - `gateIntacto()` confere, na ponte e no supervisor, que `server.mjs` continua
     usando o gate. É uma conferência contra engano, não contra má-fé;
   - uma alteração sensível vai direto para `fase-x.x/nome`, sem rodar.
6. **VS Code opcional e desligado por padrão.** Com `APOLO_AUTODEV_VSCODE=1`, abre
   uma instância com perfil próprio, encerrada ao fim do trabalho sem tocar nas
   outras janelas. Substitui o item 8 da ADR 0011.
7. **A voz não propõe confirmações.** `propor` recusa textos como "confirmo" e não
   sobrescreve uma proposta pendente.
8. **Prova de ponta a ponta no repositório.** `npm run test:autodev:e2e` roda o ciclo
   real num clone, com o Chrome mudo. Só o agente é falso, trocado no clone: nada em
   produção conhece esse teste.

## Consequências
- Uma alteração confirmada pelo Ricardo em `bridge/server.mjs` roda com acesso às
  chaves antes de alguém ler o código. É o preço aceito por ele para que as features
  possam ser testadas; a confirmação e a revisão no pull request seguem como defesa.
- Interromper um teste, inclusive com Ctrl-C, descarta a alteração na partida
  seguinte. O agente trabalhou, mas o commit só se recupera pelo sha do `eventos.log`.
- Após aprovar, a feature sai do ar até o merge, e um trabalho seguinte não a enxerga.
  É o que impede o empilhamento de branches.
- Ainda não há "ajuste isto" durante o teste: ajustar é descartar e pedir de novo.
- O push e o pull request continuam sendo pedidos à parte, pelas ferramentas da ADR
  0014.
- Depois de um merge, é preciso atualizar a `main` e reiniciar antes do próximo pedido.
