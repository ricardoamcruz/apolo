# ADR 0013 — Identidade visual do A.P.O.L.O. na interface

- **Status:** proposta
- **Data:** 2026-11-05

## Contexto

A interface web (RF-08, Fase 1) é o fork do HUD do JARVIS. O nome, a persona e
os textos já estão em pt-BR, e a abertura já perdeu o reator e o esquema da
armadura (03/11/2026), mas o visual ainda é o do projeto-base: cromo de enfeite
herdado, tipografia escrita à mão em onze regras de CSS, uma marca violeta em
`public/favicon.svg` que não é do A.P.O.L.O. — e que nem estava ligada no
`index.html` — e o identificador `__jarvis` no console.

Falta decidir o que é "a cara dele" e, antes disso, onde essa cara mora. Sem
isso, cada mudança visual é uma caça a valores repetidos pela folha de estilo, e
é assim que uma interface fica com duas fontes e três cianos.

Duas restrições pesam na decisão:

- **Nada de taxa de quadros a troco de enfeite.** O HUD fica sobre uma cena 3D
  com bloom; qualquer elemento que re-renderize a cada quadro de áudio compete
  com o que o Ricardo realmente olha.
- **RNF-02 e RNF-03 (privacidade e portabilidade).** As duas famílias
  tipográficas vêm do Google Fonts por `@import`, ou seja, toda carga da página
  conta a um servidor de terceiros que esta máquina ligou o assistente.

## Decisão

1. **A identidade mora em tokens**, no `:root` de `src/index.css`:
   `--interface` (o ciano), `--bg`, `--font-ui` e `--font-mono`. O resto da
   folha só consome. A cor **por fase** continua em `phaseColor`, em
   `src/store.ts`, e não vira token de CSS: a cena 3D e o HUD precisam da mesma
   resposta, e só o TypeScript atravessa a borda do canvas — `accentFor()` é a
   única fonte da verdade para "de que cor é a interface agora".
2. **Cromo que não informa, sai.** O primeiro a sair é a barra lateral direita
   ("SINAL"), um medidor do nível do microfone: não dizia nada que o anel
   central já não diga e era a única coisa do HUD assinada em `level`, então o
   HUD inteiro re-renderizava sessenta vezes por segundo por causa dela. O nível
   continua no store e continua pulsando o reator.
3. **A barra da esquerda ("SISTEMAS") fica**, e as regras `.rail` seguem
   genéricas: o painel de status da Fase 1 (RF-12 — módulos, provedor, consumo)
   nasce ali, e aí a lateral volta a ser informação em vez de enfeite.
4. **A marca é o anel.** O mesmo anel da abertura, reduzido ao que se lê a 16
   pixels (anel aberto, anel interno, núcleo), desenhado à mão em SVG no ciano
   da interface. Substitui o raio violeta herdado e passa a estar ligado no
   `index.html`. Sem binário e sem dependência: escala sozinho.
5. **Uma só família monoespaçada.** As leituras de instrumento e o painel de
   diagnóstico usavam a mono do sistema, o resto usava a do projeto; agora todas
   usam `--font-mono`, cuja pilha de reserva é a mono do sistema.
6. **O nome vale também no console.** `window.__jarvis` passa a `window.__apolo`
   (só no servidor de desenvolvimento).

## Consequências

Fica mais fácil: trocar a fonte, o ciano ou o fundo passa a ser uma linha;
decidir se um elemento do HUD fica é uma pergunta com critério ("informa algo
que o resto não informa?"); e o HUD deixa de re-renderizar no ritmo do
microfone.

Fica mais difícil: quem adicionar CSS agora tem de usar os tokens, e isso só se
sustenta por revisão — não há regra de lint que cobre isso hoje.

Pendente, nesta ordem:

- **Trazer as fontes para dentro do repositório** e remover o `@import` do
  Google Fonts, fechando `style-src`/`font-src` no `index.html`. Depende de
  baixar os arquivos (`Chakra Petch` e `JetBrains Mono`, ambas de licença
  livre), o que o ambiente de agente não faz — é tarefa para o Mac do Ricardo.
- **Paleta própria.** Hoje a paleta por fase é a herdada (ciano, âmbar,
  violeta, verde). Decidir com o Ricardo se o A.P.O.L.O. fica no ciano ou vai
  para a paleta de *Horizon* (âmbar sobre azul profundo); é escolha dele, não do
  agente, e entra como revisão desta ADR.
- **O núcleo 3D.** O reator ainda é o do JARVIS. Trocar a geometria é o maior
  item visual que resta e precisa de uma decisão antes do código.
- **Painel de status (RF-12)** na barra lateral.
- **Variáveis `JARVIS_*`** do ambiente, que não são visuais mas são a mesma
  dívida de nome.

## Revisão de 12/11/2026: paleta, núcleo e ícones escolhidos

O Ricardo escolheu, a partir da comparação do item 2.1 do roadmap (três paletas,
quatro núcleos e três ícones por módulo, com contraste e distância entre as cores
de estado medidos):

- **Paleta: ciano.** Fica a de hoje (`--interface: #00e5ff` sobre `#01060c`), e as
  cores de estado da ADR 0021 não mudam. A paleta de *Horizon* (âmbar sobre azul
  profundo) foi descartada: com a marca em âmbar, o amarelo de "processando" e o
  vermelho de "código" ficariam perto demais dela.
- **Núcleo: o Enxame.** Uma esfera de pontos (a esfera de Fibonacci) em oito
  faixas de latitude que giram em sentidos alternados, com um miolo menor em
  contrarrotação. As faixas se separam e aceleram quando ele trabalha, a esfera
  respira com a voz, acende de dentro para fora na partida e encolhe em espera.
  O shader (`enxameVertex`, `src/scene/shaders.ts`) é o mesmo no HUD
  (`src/scene/Enxame.tsx`) e no app do iPhone (`apps/mobile/src/Cena.tsx`). No HUD,
  é o novo estilo padrão do núcleo (`enxame`); o anel, a esfera e o arame
  continuam como estilos que o agente pode pedir (`bridge/ui.mjs`), desenhados
  pelo `Core.tsx` de antes. Com o Enxame, a poeira em volta recua para 45% do
  brilho, para não disputar com ele.
- **Marca: a Lira**, o instrumento de Apolo, no lugar do anel: no HUD e no
  favicon.
- **Ícones dos módulos** na aba SISTEMAS: Processador (C.O.R.E.), Asas
  (F.Ê.N.I.X.), Asa (H.E.R.M.E.S.) e Sol nascente (A.U.R.O.R.A.), todos em
  `src/ui/icones.tsx`, em traço na cor do estado. Um conector novo sem ícone fica
  com o losango de antes.

Pendente: os ícones no app do iPhone, que ainda não tem uma biblioteca de SVG
(`react-native-svg` exige um prebuild e um pod install), e trazer as fontes para
o repositório (item 2.3).

## Revisão de 13/11/2026: a Lira sai do cabeçalho

Com a marca ao lado do nome, o canto superior esquerdo ficava com dois sinais
dizendo a mesma coisa — e o critério desta ADR é justamente "informa algo que o
resto não informa?". O cabeçalho fica só com **A.P.O.L.O.**; a Lira continua
sendo a marca no favicon e segue desenhada em `src/ui/icones.tsx`, com o estilo
`.brand-icone` preservado, para voltar em outro ponto da interface quando houver
um lugar em que ela informe algo. O Enxame, a paleta e os ícones dos sistemas não
mudam.
