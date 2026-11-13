# ADR 0030 — O app do iPhone com a autonomia do PC no core

- **Status:** proposta
- **Data:** 2026-11-12

## Contexto

Desde a ADR 0019, o app do iPhone conversa por voz pelo H.E.R.M.E.S., mas o que
mexe no próprio A.P.O.L.O. ficava só no PC: `bridge/hermes.mjs` deixava o
celular mandar apenas `ask`, `interrupt`, `voz_sessao`, `telemetria` e
`extensao`, e a voz do celular não tinha as ferramentas `desenvolvimento` e
`fenix` ("isto só funciona no computador").

O pedido do Ricardo, em 12/11/2026: pelo app, disparar scripts bash no core, fazer
desenvolvimento remoto, consultar o backlog e pedir que o A.P.O.L.O. do servidor
altere a si próprio, com a mesma autonomia do site no PC.

## Decisão

O celular ganha as duas ferramentas, com o mesmo caminho e as mesmas travas do PC:

- **Ponte.** `MENSAGENS_DO_CELULAR` passa a aceitar `autodev` e `fenix`, que caem
  em `acaoDoAutodev` e `pedirAFenix`, as mesmas funções do PC. O estado do
  autodesenvolvimento e as propostas da Fênix vão também aos celulares conectados
  (`avisarTodos`), ao conectar e a cada mudança. Preferências e o bom dia
  continuam só no PC.
- **Voz do celular** (`src/lib/voz/celular.ts`). `desenvolvimento` e `fenix`
  seguem as regras de `src/App.tsx`: confirmar e aprovar só na hora certa
  (`foraDeHora`), e confirmar, aprovar, rodar um script e abrir o PR só com o sim
  falado, conferido na transcrição do microfone do celular (`registrarFala`,
  `ouviuConfirmacao`), nunca no que o modelo afirma. Sem botões no celular, a voz
  pede que ele diga "confirmo" ou "aprovo".
- **App** (`apps/mobile`). Só repassa: o pedido da página vai ao canal
  (`pedirAoCore`, apenas `autodev` e `fenix`), e a resposta e o estado voltam para
  a página (`aoCore` → `doCore`).
- **Travas que não mudam.** Scripts bash só com `npm start -- --writes`;
  autodesenvolvimento só com `--autodev`; a Fênix recusa script com versão sem
  revisão no ar; arquivos sensíveis nunca entram em teste sem revisão; o PR só sai
  para a `main` com `--writes` e o sim falado.

## Consequências

- Pelo app, ele pede "Apolo, qual o backlog?", "faz o item 1.3", "roda os testes"
  ou um script, confirma falando, testa a versão nova e aprova ou descarta.
- Uma alteração em teste reinicia a ponte: o app reconecta sozinho, como já
  fazia, e o resultado chega pela voz quando a conversa voltar.
- O token do celular passa a valer o mesmo que a interface do PC no core. Ele
  continua só no app (cofre do iOS) e só trafega por WSS no Tailscale; perder o
  aparelho pede um novo pareamento (`npm run celular`).
- Mudar `src/lib/voz/celular.ts` e o app exige recompilar e instalar o app no
  iPhone (rotina `app_iphone` da Fênix).
