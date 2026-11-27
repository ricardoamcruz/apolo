# ADR 0038 — A troca de branch é da Fênix, nos dois sentidos

- **Status:** aceita
- **Data:** 2026-11-26

## Contexto

Em 25/11/2026, o autodesenvolvimento fez o item 3.4 do backlog a partir da `main`
e, como a mudança tocava arquivos sensíveis, guardou-a na `fase-3.4/aurora-no-bolso`
sem pô-la no ar (ADR 0015). O Ricardo pediu, por voz, para testar essa branch. Não
havia como: a Fênix só sabia pôr no ar uma alteração recém-feita (`versao:aplicar`)
e voltar para a `main` (`atualizar`, ADR 0029). Às 10:46, a voz recorreu a
`executar_tarefa`, e o agente de tarefas fez um `git checkout` direto na cópia em
execução, pelo Bash, por baixo da Fênix: a versão mudou sem observação nem volta, a
voz ficou surda e a Fênix teve de recarregar a página. Às 10:51, um "volta para a
main" pela rotina `atualizar` desfez a troca.

O que o Ricardo espera do autodesenvolvimento é ir e voltar entre a `main` e uma
`fase-x.y` com naturalidade: entrar na branch que acabou de nascer para testá-la,
e sair dela por insatisfação ou por falha, sempre. Na Fase 3.5 ele quer deixar o
A.P.O.L.O. coordenar sozinho uma branch inteira, e isso não se sustenta se a troca
de versão depender de mão humana ou de um atalho que derruba a voz.

## Decisão

1. **A Fênix troca de branch** (`fenix/src/versoes.mjs`, `previa` e `trocar`): põe
   no ar qualquer branch que já exista, a `main` ou uma `fase-x.y/nome`, local ou só
   no GitHub. Aceita o nome como ele é falado: "main", "3.4", "fase-3.4", o nome
   inteiro ou só a parte criativa. A troca é desligar, trocar, conferir o commit,
   reinstalar se `package.json` mudou, religar e **observar** como na ADR 0015;
   se a versão nova não ficar de pé (ou a interface que havia não voltar), ela
   **volta sozinha** para onde estava. Nenhuma branch é apagada: a de origem e a de
   destino ficam guardadas. A branch local atrás do remoto avança junto, só sem merge;
   pedir a mesma branch que está no ar traz a mais nova dela.
2. **Prévia antes, e o sim só para a branch de fase.** A primeira chamada da voz
   (`fenix`, acao `trocar`) devolve a prévia: quantos commits à frente da `main`, o
   último, os arquivos sensíveis que ninguém revisou e se não alcançou o GitHub. Ir
   para uma branch de fase exige o sim do Ricardo, conferido na transcrição do
   microfone depois da prévia (`src/lib/trocaDeVersao.ts`, igual no PC e no celular),
   e a troca acontece no commit que a prévia mostrou: se a branch andou, pede-se uma
   prévia nova. **Voltar à `main` não pergunta:** é a saída de emergência.
3. **A resposta sai na hora; o fim chega depois.** A ponte que pede reinicia no meio.
   O fim fica em `ultimaTroca`, no estado da Fênix, vai à ponte nova (`versao:troca`),
   é anunciado pela voz uma vez (mesmo com a página recarregada) e vai à central de
   notificações, só com frases (ADR 0027).
4. **Uma troca interrompida volta.** `transicao.json` com `troca: true` fica em disco
   durante a troca; a próxima partida (ou `npm run rollback`) volta para a origem e,
   ao contrário de uma alteração em teste, não apaga a branch de destino.
5. **Quedas seguidas numa branch de fase voltam à `main`.** Fora de qualquer troca,
   se a ponte cair 3 vezes em 5 minutos numa branch que não é a `main`, a voz está
   muda e ninguém consegue pedir a volta: a Fênix volta sozinha à `main`, avisa e
   deixa a branch guardada. Na `main` não há para onde voltar, e ela só reinicia.
6. **Ninguém troca a cópia por baixo da Fênix.** O gate (`bridge/gate.mjs`) nega ao
   agente de tarefas os comandos Git que mudam a branch, o commit ou os arquivos da
   cópia do A.P.O.L.O. (`checkout`, `switch`, `reset`, `merge`, `pull`...), com a
   instrução de usar a ação `trocar`; o Git de outros projetos segue livre. A voz é
   instruída a nunca trocar de branch por `executar_tarefa`, `git_*` ou script.
7. **Pelo terminal também:** `npm run trocar -- 3.4` (ou `main`) faz o mesmo pela
   Fênix no ar, mostra a prévia e espera o fim. Quem digita é o Ricardo: o comando
   é o sim.
8. **O autodesenvolvimento passa a conferir o que faz.** O agente pode rodar os testes
   (`npm test`, `npm run test:<nome>`, `node --test <arquivos>`) no mesmo sandbox, em
   vez de deixá-los só para a conferência da ponte; o ciclo de ponta a ponta, que abre
   o Chrome, fica de fora. Uma branch guardada para revisão diz como testá-la.

## Consequências

- Ir e voltar entre a `main` e uma branch de fase é uma frase ("põe a três ponto
  quatro no ar", "volta para a main"), com prévia, observação e volta automática. A
  branch que o autodesenvolvimento guardou para revisão passa a ser testável sem mão
  no terminal.
- Pôr no ar uma branch com arquivos sensíveis sem revisão passa a ser possível, com o
  sim falado do Ricardo depois de ouvir quais são. Isso não enfraquece a ADR 0015: o
  autodesenvolvimento continua sem pôr sozinho no ar o que é sensível, e a Fênix em
  execução não troca o próprio código até a próxima partida manual. Mas o
  renascimento (ADR 0028) sobe a Fênix da cópia no ar, então uma branch que mude
  `fenix/` vale para a Fênix se ela morrer durante o teste.
- `src/lib/trocaDeVersao.ts` é sensível, como `src/lib/autodev.ts`: é onde o sim é
  conferido.
- A trava do gate lê o texto do comando: é contra engano, não contra má-fé.
- Coberto em `fenix/test/trocar.test.mjs` (repositórios Git de verdade, com remoto),
  `fenix/test/fenix.test.mjs` (pelo canal) e `scripts/troca.test.mjs` (a voz, o sim e
  o gate).
- Fica para a Fase 3.5: o modo em que o A.P.O.L.O. faz vários itens seguidos na mesma
  branch, sem o Ricardo confirmar e aprovar cada um. Hoje cada alteração ainda pede o
  sim dele para começar e para ser aprovada (ADR 0011 e 0015), e tirar essa trava é uma
  decisão de segurança que precisa de ADR própria.

## Revisão (27/11/2026): a branch presa, o registro e a troca contada passo a passo

Pedida a `fase-3.5/aviso-e-escolha`, a troca não saía. Um registro de cópia de
trabalho do Git (`git worktree`), de uma pasta em `/private/tmp` já apagada, dizia ao
Git que a branch estava aberta lá, e o Git não abre a mesma branch em duas cópias. A
prévia não via isso, a troca desligava tudo, falhava e voltava, e a voz só disse que a
branch estava instável. Nenhuma prévia nem recusa ficava gravada, então o motivo teve de
ser reconstruído à mão.

1. **A Fênix esquece as cópias de trabalho sem pasta** (`git worktree prune`) antes de
   planejar e antes de trocar, e anota o que esqueceu. Uma cópia de verdade, com
   arquivos, nunca é apagada por ela.
2. **A prévia recusa a branch aberta em outra cópia de verdade**, sem desligar nada, e
   diz qual é e como fechá-la (`git worktree remove <pasta>`).
3. **Toda prévia e toda recusa vão ao `eventos.log`**, com a frase dita. O que parou na
   voz, sem chegar à Fênix (o sim que não apareceu na transcrição, a prévia vencida),
   também vai, por `versao:voz`, só como código conhecido: o log nunca recebe texto
   livre vindo de fora.
4. **A voz conta a troca passo a passo**, com uma frase exata para cada desfecho
   (`src/lib/trocaDeVersao.ts`): "Reiniciando o sistema na versão 3.5, aviso e
   escolha. Já volto."; "Reinicialização concluída: estou rodando a versão ...";
   "Erro de reinicialização: ... voltei automaticamente para a versão principal. Quer
   que eu analise os logs para entender o que deu errado?"; "Estou de volta à versão
   principal, como você pediu."; e ainda a volta sozinha depois de quedas seguidas, a
   troca que não chegou a mudar nada, a que não subiu nem voltou, e a mesma branch
   trazida para o commit mais novo. Com o sim para os logs, a voz pede a
   `executar_tarefa` que leia o `eventos.log` e explique em duas frases. Para isso, o
   fim da troca passa a levar `de` e `para`, e a volta sozinha fica marcada também no
   estado da Fênix, não só no aviso.
