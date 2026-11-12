# ADR 0028 — O pacto entre A.P.O.L.O. e F.Ê.N.I.X.: cada um revive o outro

- **Status:** proposta
- **Data:** 2026-11-12

## Contexto

Desde a ADR 0025, a Fênix guarda o A.P.O.L.O.: põe no ar a versão que o
autodesenvolvimento gerou, percebe quando ela quebra e volta à `main`. O
caminho contrário não existia: se a Fênix morresse (um `kill -9`, uma exceção
dela, o terminal fechado de mau jeito), os serviços ficavam órfãos, sem ninguém
para trocar versão, rodar rotinas ou levantar quem caísse. E a ponte, sem o
terminal, morria no primeiro `console.log` (EPIPE).

O pedido do Ricardo, em 12/11/2026: o A.P.O.L.O. com poder para fazer qualquer
ação no sistema, por ele mesmo ou pela Fênix, respeitando a autonomia de cada
um; alterar o próprio código numa branch organizada, a partir do backlog, como
ele faz pelo chat do Claude (commit, PR, testes locais, versão de teste no ar);
resistir a uma branch com código mal escrito; e uma parceria 1:1, em que a Fênix
salva o A.P.O.L.O. de uma branch que o mata e o A.P.O.L.O. ressuscita a Fênix.

## Decisão

**Quem faz o quê.** O A.P.O.L.O. conversa, mostra, pesquisa, usa o navegador e
muda o próprio código (`desenvolvimento`); a Fênix cuida da máquina e de manter
o A.P.O.L.O. no ar (`fenix`): testes, lint, build, reinício, atualização,
diagnóstico, rotinas e scripts bash. Um não faz o trabalho do outro, e quem troca
a versão do A.P.O.L.O. é sempre a Fênix. As instruções da voz dizem isso numa
seção própria ("QUEM FAZ O QUÊ").

**Backlog pelo número.** `desenvolvimento` ganha a ação `backlog`, que lista os
itens abertos de "Pendências em etapas" (`docs/05-roadmap.md`) com número
`etapa.posição` — a posição conta os itens feitos, para marcar um não renumerar os
outros (`bridge/desenvolvimento.mjs`). `propor` aceita `tarefa: "1.3"` no lugar do
pedido: a ponte monta o pedido com o item inteiro e o jeito de trabalhar do chat
(AGENTS.md, testes, lint e build, roadmap, requisitos e ADR no mesmo commit). O
resto é o ciclo da ADR 0015: worktree a partir da `main`, checagens com `npm
test`, versão de teste no ar pela Fênix, `fase-x.y/nome` ao aprovar e o PR só com
o sim falado e `--writes`.

**A Fênix deixa a receita.** Ao subir um serviço, ela passa `FENIX_PID` (o
processo dela) e `FENIX_RENASCER`, um JSON com o comando que a sobe de novo (o
mesmo programa, a mesma configuração, as mesmas opções, como `--writes`), a pasta,
o arquivo de saída (`fenix.log`), o registro (`renascimentos.log`) e as variáveis
que são dela, e não do terminal. Só dados: a ponte continua sem importar nada da
Fênix (ADR 0025).

**A ponte revive** (`bridge/renascer.mjs`). Quando a conexão com a Fênix cai, ela
pergunta ao sistema, a cada segundo, se o processo da Fênix existe. Vivo, só caiu
o canal, e o cliente reconecta. Sumido em duas checagens seguidas, ela morreu: a
ponte a sobe de novo, solta (`detached`), com `FENIX_RENASCIDA=1` e a saída no
arquivo, e sai do caminho em menos de um segundo. A Fênix nova faz a partida de
sempre: encerra as cópias antigas nas portas, volta à `main` se havia uma versão
sem aprovação no ar e sobe tudo, inclusive uma ponte fresca. Ela registra e avisa
pelo H.E.R.M.E.S. que renasceu. Três renascimentos em dez minutos é um laço: a
ponte desiste e fica de pé sozinha, como no `npm run bridge`.

**Ctrl-C não ressuscita.** O sinal vai para o grupo inteiro e a ponte morre junto;
um encerramento normal da Fênix derruba os serviços antes de fechar o canal.

**Prazos no config.** `fenix.config.json` aceita `tempos.servicos` e
`tempos.versoes` (só números positivos), para um projeto mais lento ou para os
testes de resiliência.

## Consequências

- `scripts/resiliencia.test.mjs` (dentro do `npm test`, uns 15 s, também em `npm
  run test:resiliencia`) roda o pacto com processos de verdade: a Fênix real, um
  repositório Git e uma ponte mínima que usa o mesmo cliente e o mesmo renascimento
  da ponte real. Cobre a branch que derruba a ponte depois de subir, a que nem
  sobe (sintaxe), a Fênix morta por `SIGKILL` e revivida, e a renascida ainda
  voltando à `main` uma branch que trava.
- `bridge/renascer.mjs` é sensível (sobe processos com o ambiente do terminal):
  entra em `SENSIVEIS` e na proteção do `fenix.config.json`.
- Depois de renascer, a saída da Fênix fica em `~/.apolo/fenix/fenix.log`: o
  terminal morreu com a anterior.
- Se o A.P.O.L.O. e a Fênix morrem juntos, ninguém revive ninguém; o `npm start`
  continua sendo o recomeço. Uma Fênix viva mas travada também não é revivida: o
  processo existe. Ficam para depois.
- Em outra máquina, `FENIX_PID` não diz nada; a Fênix só deixa a receita para quem
  ela mesma sobe, nesta máquina.
