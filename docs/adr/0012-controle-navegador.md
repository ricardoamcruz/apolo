# ADR 0012 — Controle do navegador pela própria interface

- **Status:** proposta
- **Data:** 2026-11-04

## Contexto
O RF-19 pede três coisas: saber em que navegador e em que sistema o A.P.O.L.O.
está rodando, abrir abas novas e transformar uma popup aberta em aba.

O projeto já controla navegador por outro caminho: `bridge/chrome.mjs` fala com
a extensão do Claude por um socket local e consegue ler e clicar dentro das
páginas do Chrome. Esse caminho não resolve o requisito.

- Ele não sabe onde a interface está. A extensão responde sobre as abas do
  Chrome; se o Ricardo abrir a interface no Safari, no Firefox ou num Chromium
  sem a extensão, não existe resposta nenhuma — e a pergunta do requisito é
  justamente essa.
- Ele depende de um protocolo privado da extensão, descoberto por tentativa.
  Criar aba com endereço por ali é palpite, e palpite não testado não entra.
- Ele não distingue uma popup de uma aba, nem move uma para a outra.

Quem sabe responder tudo isso é a página: `navigator`, `window.open` e a
referência da janela aberta. A interface já tem um canal de pedido e resposta
com a ponte — o mesmo que a câmera usa (`bridge/vision.mjs`), com `id` para
casar a resposta com a pergunta.

## Decisão
1. **Um módulo novo, não uma extensão do antigo.** `bridge/navegador.mjs` expõe
   as ferramentas `browser_*` e pergunta à interface; `src/lib/navegador.ts`
   responde. `bridge/chrome.mjs` continua sendo a mão dentro das páginas. A
   divisão é de alcance: `chrome_*` age DENTRO de uma página, `browser_*` diz
   ONDE o A.P.O.L.O. está e cuida das janelas que ele abriu.
2. **Detecção na página, sem palpite.** Navegador, motor e sistema vêm de
   `navigator.userAgentData` e do User-Agent, lidos do mais específico para o
   mais genérico (Edge, Opera, Vivaldi e Brave antes do Chrome; Chrome antes do
   Safari). O que o navegador não conta de verdade volta como `null`: a versão
   do macOS vem congelada em `10.15.7` desde 2021 e o Windows 11 se declara
   `NT 10.0`, então os dois são relatados como "não informado" e "10 ou 11".
   O sistema do núcleo vem do próprio processo da ponte e é relatado separado —
   um dia a ponte roda em servidor e a interface no celular.
3. **Toda janela nasce em `about:blank`, perde o `opener` e só então navega.**
   É o que impede uma página aberta a partir de um endereço que o modelo leu na
   web de navegar esta interface pelo `window.opener`. Em `about:blank` aberta
   por nós a origem é a nossa, então desligar o `opener` funciona — num destino
   de outra origem o navegador recusaria a escrita. Só `http` e `https` abrem:
   `javascript:` rodaria código de terceiro nesta origem e `file:` leria o disco.
4. **O bloqueio de popup é relatado, não contornado.** Um pedido por voz chega
   pelo WebSocket, sem clique por trás, e é exatamente o caso que o bloqueador
   recusa — `window.open` devolve `null`. A resposta diz isso em uma frase, com
   a solução: liberar pop-ups para o endereço da interface, uma vez, nas
   configurações do site. Não há como a página contornar isso, e esconder a
   recusa seria afirmar uma aba que não existe.
5. **Popup em aba, nessa ordem:** abre a aba primeiro e só depois fecha a popup,
   para uma aba bloqueada nunca custar a janela que a pessoa já tinha. O
   resultado diz se a popup fechou de fato — o navegador recusa `close()` numa
   janela onde a pessoa navegou. Para popups que o A.P.O.L.O. não abriu, o
   endereço tem que ser informado: a página não alcança janelas que não abriu.
6. **Sem gate de escrita.** `apolo_ambiente` é permitido em modo somente
   leitura, pelo mesmo critério de `apolo_navegador`: abrir uma aba é tão
   visível e tão reversível quanto navegar numa — o que o gate já permite — e
   nada aqui escreve em disco, envia nada nem preenche formulário. Agir dentro
   da página continua passando pelo gate de `chrome_*`.
7. **A persona segura a mão.** A aba não é superfície de exibição: o que é para
   ver vai para um painel. `browser_open_tab` só quando o Ricardo pedir aba ou
   janela.

## Consequências
- A pergunta "em que navegador você está?" passa a ter resposta de verdade, em
  qualquer navegador, sem extensão nenhuma.
- A primeira aba de uma sessão provavelmente chega bloqueada, até o Ricardo
  liberar pop-ups para o endereço da interface. É um ajuste do navegador, de uma
  vez, e a mensagem explica onde. A alternativa seria criar a aba pela extensão
  do Claude, por um protocolo privado que não dá para testar aqui — fica para
  quando houver como validar no Chrome real.
- Uma popup aberta pelo A.P.O.L.O. é rastreada pelo endereço com que foi aberta.
  Se a pessoa navegar dentro dela, a conversão reabre o endereço antigo; o jeito
  certo nesse caso é passar o endereço atual, que as ferramentas `chrome_*`
  sabem ler.
- `bridge/server.mjs` mudou (registro do servidor MCP, gate e persona), e ele é
  sensível para o autodesenvolvimento: esta alteração não entra no ar sozinha,
  fica para revisão do Ricardo (ADR 0011, item 4).
- Quando o core existir, isto vira o módulo `navegador` junto com
  `chrome.mjs`/`page.mjs` (ver `docs/04-base-jarvis.md`), e a detecção de
  ambiente é o que o app do celular vai precisar responder também.
