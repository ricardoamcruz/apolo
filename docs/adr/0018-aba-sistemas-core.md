# ADR 0018 — Aba SISTEMAS, C.O.R.E. e cor de alerta

- **Status:** aceita
- **Data:** 2026-11-06

## Contexto
A aba SISTEMAS ficava sempre na tela e listava cada servidor MCP, herança do
JARVIS. Só que `apolo`, `apolo_ui`, `apolo_git` e os demais são partes de um
assistente só. Falhas sumiam: a ponte filtrava os servidores com problema, então
nada avisava que algo havia quebrado. E a interface muda de cor, então um vermelho
fixo desapareceria justamente quando ela estivesse vermelha.

## Decisão
1. **C.O.R.E. (Centro Operacional da Rede)** é uma linha só, que reúne tudo o que o
   A.P.O.L.O. usa para rodar: ponte, voz e servidores. Se uma parte falha, ele fica
   degradado e o motivo aparece embaixo. O `core/` da Fase 1 é outro assunto: um é
   como o sistema se apresenta, o outro é como o código se organiza.
2. **O que for plugável tem linha própria,** com tipo (`conector`, `skill`,
   `extensao`, `api`), em `src/lib/sistemas.ts`. Hoje só o REA está nesse grupo.
3. **A ponte envia o estado de todos os servidores,** inclusive dos que falharam.
4. **A aba só aparece quando pedida:** tecla D, com a janela de voz, ou voz, pela
   ferramenta `diagnostico`, que devolve o estado para o modelo narrar. A verdade
   vem do código; o modelo só fala.
5. **A cor de alerta é calculada** por `contrastante()`: o matiz oposto ao da
   interface, clareado até ser legível sobre o fundo escuro. Cor quase cinza não tem
   oposto e cai no âmbar. Nenhuma cor de alerta é fixa no CSS.
6. **Popups minimizam ao entrar em espera,** em quadradinhos à direita. Eles não
   voltam sozinhos ao acordar e sobrevivem à limpeza automática de cada tarefa; só
   saem se forem abertos ou fechados de vez. Minimizado não fica montado: vídeo
   para, e um artigo volta ao topo.
7. **Ponte e chat ficam ocultos até serem pedidos** por voz ("exibir ponte", "exibir
   chat", "exibir ponte e chat", "habilitar modo detalhado"). A escolha fica em
   `~/.apolo/preferencias.json`, na ponte, até existir a memória da Fase 1. A ponte
   oculta volta sozinha enquanto houver proposta ou teste em aberto, porque
   esconder o botão Confirmar recriaria o bug do "confirmo".

## Consequências
Todo módulo novo precisa declarar como aparece na aba (RF-56). A janela de
diagnóstico (D) segue com suas cores próprias de erro; só a aba usa `--alerta`.
Um servidor externo sem autorização degrada o C.O.R.E. até ser reclassificado como
plugável, o que é preferível a esconder uma falha.
