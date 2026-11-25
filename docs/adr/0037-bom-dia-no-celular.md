# ADR 0037 — O bom dia também no celular, sem a música

- **Status:** proposta
- **Data:** 2026-11-25

## Contexto

O bom dia (RF-55, ADR 0026) só existia no PC: a ferramenta `bom_dia` não era
oferecida à voz do celular, e a ponte recusava a mensagem `aurora` de quem viesse
pelo H.E.R.M.E.S. (`MENSAGENS_DO_CELULAR`, ADR 0030 — "preferências e o bom dia
continuam só no PC"). Pelo app, "bom dia" era só um cumprimento: nem agenda, nem
notícias, nem GitHub.

O item 3.4 do backlog pede o bom dia no celular. Duas partes dele não são iguais
nos dois lados:

- **A música.** O trecho de rock toca no player oficial do YouTube, visível em
  200×200 (ADR 0026: esconder o player ou baixar o áudio fere os termos). Onde
  esse quadrado fica na tela do iPhone, que já é o círculo mais os popups, é
  decisão visual do Ricardo (protótipo antes do código), e o alto-falante do
  aparelho toca a um palmo do microfone aberto da sessão de voz — risco que só se
  mede no aparelho.
- **Os botões.** No celular não há tocador nem teclado: "pausa a música" e
  "abre no YouTube Music" não têm onde acontecer.

## Decisão

O celular ganha o bom dia inteiro, menos a música.

- **Ponte.** `MENSAGENS_DO_CELULAR` passa a aceitar `aurora`, e o tratador em
  `bridge/server.mjs` deixa de ser só do PC. É leitura: o único efeito é um GET à
  A.U.R.O.R.A. (`bridge/aurora.mjs`). Para o celular, a resposta passa por
  `semAMusica`: sai a faixa, sai a linha "Tocando: ..." do texto narrado e sai o
  `avisoDaMusica` — lá o silêncio é o esperado, e relatá-lo seria anunciar uma
  falha que não existe.
- **Voz do celular** (`src/lib/voz/celular.ts`). `bom_dia` pede ao core como o
  `desenvolvimento` e a `fenix` (`pedirAoCore`, tipo `aurora`), abre os mesmos
  popups em diagonal (`popupsDoBomDia`), segura a conversa aberta por até 3
  minutos enquanto ele lê, minimiza os popups quando o assunto muda e fecha tudo
  no "obrigado", entrando em espera depois da despedida — as mesmas regras de
  `src/App.tsx`. `musica` responde que o tocador é só do computador.
- **Uma narração só.** O texto que a voz recebe sai de `instrucaoDoBomDia`
  (`src/lib/bomDia.ts`), compartilhado pelos dois lados, com `'pc'` ou
  `'celular'` mudando apenas o que se diz da música. Antes ele estava escrito
  dentro de `src/App.tsx`, fora do alcance dos testes.
- **App** (`apps/mobile`). Só repassa, como na ADR 0030: `aurora` entra em
  `TIPOS_DO_CORE`, e a resposta volta à página por `aoCore` → `doCore`.
- **A música fica para o Ricardo.** Levá-la ao celular depende de onde o player
  de 200×200 entra na tela e de ouvir, no aparelho, se ela atrapalha o microfone.
  Enquanto isso, a voz diz que o rock fica no computador.

## Consequências

- Pelo app, "bom dia" traz agenda, notícias por tema, GitHub e as pendências do
  roadmap, narrados e nos três popups, com o "obrigado" fechando tudo.
- O celular passa a poder pedir o bom dia, e `bridge/hermes.mjs` é arquivo
  sensível: esta alteração entra por revisão humana (ADR 0011).
- O resumo do celular não tem título de música nenhum: o que o modelo não recebe,
  ele não promete.
- Mudar `src/lib/voz/celular.ts`, `src/popups.tsx` ou o app exige recompilar os
  popups (`npm run popups`) e instalar o app no iPhone (rotina `app_iphone`).
- Falta validar no aparelho (voz, popups e o "obrigado"), como todo o resto do
  app, e decidir a música.
