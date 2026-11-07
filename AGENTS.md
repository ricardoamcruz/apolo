# A.P.O.L.O. — guia para agentes de IA

> **A**ssistente **P**reditivo **O**peracional **L**ogístico e **O**timizado.
> Assistente pessoal do Ricardo, inspirado no JARVIS e na I.A. de *Horizon Zero Dawn*:
> um **core** pequeno e confiável que cresce por **módulos plugáveis**.

Este arquivo é lido automaticamente por Claude Code (via `CLAUDE.md`), Gemini CLI
(via `GEMINI.md`), GitHub Copilot e outros agentes. Ele é o ponto de entrada; o
detalhe está em `docs/`.

## Leia antes de qualquer tarefa

| Arquivo | Quando ler |
|---|---|
| `docs/00-visao.md` | Sempre, uma vez por sessão: o que é o A.P.O.L.O e seus princípios |
| `docs/01-requisitos.md` | Antes de implementar qualquer funcionalidade (IDs `RF-*`, `RNF-*`) |
| `docs/02-arquitetura.md` | Antes de mexer no core, em providers de IA, canais ou voz |
| `docs/03-modulos.md` | Antes de criar ou alterar um módulo plugável |
| `docs/04-base-jarvis.md` | Antes de alterar código herdado (`bridge/`, `src/`) |
| `docs/05-roadmap.md` | Para saber em que fase estamos e o que vem depois |
| `docs/06-ambiente-mobile.md` | Antes de mexer em `apps/mobile` ou no ambiente Xcode/Android |
| `docs/adr/` | Decisões tomadas (ADRs). Não contrarie uma ADR aceita sem criar outra |

## Estado atual

- **Fase 0 — Fundação: concluída** (02/11/2026), exceto o Android, adiado.
  Próxima: **Fase 1 — Core**. Ver `docs/05-roadmap.md`.
- **Próxima versão:** 6 pontos do backlog têm prioridade sobre a ordem das fases
  (seção "Próxima versão" de `docs/05-roadmap.md`, RF-15 a RF-20). O primeiro,
  limpar a tela por voz (RF-16), está feito desde 03/11/2026.
- **Sub-módulo git (ADR 0014):** `bridge/git.mjs` dá ao A.P.O.L.O. as ferramentas
  `git_*` sobre o próprio repositório — ler o estado, commitar numa branch e
  abrir pull request para a `main`. Commitar e propor merge exigem
  `npm start -- --writes`; merge, push na `main` e `--force` não existem.
- O código ainda é o fork do JARVIS (`bridge/`, `src/`), já renomeado para
  A.P.O.L.O. e em pt-BR (persona, ativação "Apolo", voz masculina do sistema).
  O core (`core/`) ainda não existe. Variáveis de ambiente seguem `JARVIS_*`.
- **Identidade visual (ADR 0013, 05/11/2026):** começada. Cor e tipografia são
  tokens no `:root` de `src/index.css` (`--interface`, `--bg`, `--font-ui`,
  `--font-mono`) — CSS novo usa os tokens, não valores escritos à mão. A cor por
  fase fica em `phaseColor`/`accentFor()` (`src/store.ts`), porque a cena 3D e o
  HUD precisam da mesma resposta. Faltam fontes locais, a paleta definitiva e a
  geometria do núcleo; a decisão da paleta é do Ricardo.
- **App mobile (ADR 0019):** `apps/mobile` (Expo SDK 58, RN 0.88, bundle
  `com.ricardocruz.apolo`, Personal Team `9F2MVYQ9SF`). Ele ouve e responde por
  voz, como o PC, sem conversa escrita, pelo gateway com token (`bridge/gateway.mjs`,
  porta própria só com o canal e a mídia dos popups, publicada pelo Tailscale). A
  voz (`src/lib/voz/celular.ts`) e os `Panels` e `Blades` da web são compilados por
  `npm run popups` e rodam numa WebView; os shaders ficam em `src/scene/shaders.ts`.
  Mudar esse código muda o app. Popup é só para conteúdo visual, nunca para a
  resposta. `ios/` e
  `popups.gerado.ts` são gerados: não edite. CocoaPods usa o
  Ruby portátil do Homebrew (`scripts/setup-mobile.command`); no Homebrew,
  Intel + macOS 26 compila LLVM por horas — sempre responder `n`.
- **Telemetria e direção (ADR 0020):** o app grava tempos no Mac por `telemetria`
  (`bridge/telemetria.mjs`, `npm run logs:celular`), nunca a fala. A voz segue em
  segundo plano (`UIBackgroundModes: audio`). CarPlay nativo exige conta paga e
  aprovação da Apple; o espelhamento não existe. No celular, as partículas usam
  `particlesOrbitVertex`, e o shader do PC fica como está.
- **Cores e HTTPS (ADR 0021):** a cor por atividade vem de `src/lib/estados.ts`, para
  web e app (ouvindo verde, processando amarelo, script lilás, código vermelho, pausa
  azul claro); não escreva cor de estado à mão. Toda conexão é HTTPS: a página fica em
  `https://localhost:5173`, a ponte só aceita origem `https`, e `npm run https` confia
  no certificado de `~/.apolo/tls`.
- **Extensão entre dispositivos (ADR 0022):** `bridge/extensoes.mjs` é só a tomada;
  nenhuma extensão está registrada. O que vier por ela passa pelo gate.
- **Em Espera (ADR 0017):** é a fase `dormant`, por Esc, ociosidade ou voz
  (`dormir`: "em espera", "já volto", "boa noite" de despedida). Nela, só o nome
  ou Espaço acordam: `src/lib/chamada.ts` usa a Web Speech API, com o microfone do
  modelo fechado. `ignorar_fala` é como ele fica calado quando a fala não é para ele.
- **Aba SISTEMAS (ADR 0018, RF-56):** só aparece pela tecla `D` ou por voz
  (`diagnostico`). Tudo o que o A.P.O.L.O. usa para rodar é uma linha só, C.O.R.E.;
  skills, extensões, APIs e conectores futuros entram como outras linhas em
  `src/lib/sistemas.ts`. Degradado usa `--alerta` (`contrastante()` em `src/lib/cor.ts`),
  nunca uma cor fixa. Popups viram quadradinhos ao entrar em espera (`BladeTray`).
- **Exibição (RF-57):** ponte e chat só aparecem se pedidos por voz; a escolha fica
  em `~/.apolo/preferencias.json` (`bridge/preferencias.mjs`). A ponte reaparece
  sozinha com proposta ou teste em aberto: nunca esconda o botão Confirmar.
- **Voz própria:** pendente; o usuário quer usar o "Voice Studio" (ferramenta a
  confirmar). ADR nova quando definida.
- **Autodesenvolvimento (ADR 0011 e 0015):** com `npm start -- --autodev`, o
  A.P.O.L.O. altera o próprio código por voz ou chat, com confirmação, numa
  worktree em `~/.apolo/autodev`, sempre a partir da `main`. Depois das checagens,
  reinicia no código novo e fica **em teste, sem prazo**: aprovar guarda em
  `fase-x.x/nome` e volta à `main`; descartar, uma queda ou um `npm start` sem
  aprovação voltam à `main` e apagam a branch. `autodev/<id>` só existe durante o
  teste. O VS Code é opcional (`APOLO_AUTODEV_VSCODE=1`) e fecha sozinho. Arquivos
  sensíveis (`bridge/autodev/politica.mjs`) nunca entram em teste sem revisão.
  Motivos de rollback ficam em `~/.apolo/autodev/eventos.log`.
- Escopo atual: **apenas o core e os pontos de extensão**. Módulos de domínio
  (e-mail, agenda, finanças, automação residencial) vêm depois.

## Regras para agentes

1. **Idioma:** documentação, mensagens de commit, comentários novos e a fala do
   assistente em **português do Brasil**. Identificadores de código em inglês.
2. **Core pequeno.** Se uma funcionalidade é de um domínio (e-mail, casa,
   finanças), ela é um **módulo**, não código no core. Na dúvida, módulo.
3. **Segurança primeiro.** Toda ferramenta com efeito no mundo (enviar, apagar,
   pagar, ligar/desligar dispositivo) passa pelo **gate de permissões** e é
   negada por padrão. Nunca enfraqueça o gate para "fazer funcionar".
4. **Segredos nunca no repositório.** Chaves e tokens só em `.env.local`
   (ignorado pelo Git) ou no cofre do sistema. Nunca logue segredos.
5. **Multi-IA de verdade.** Nenhum código fora de `core/providers/` pode
   depender de um provedor específico (Claude, Gemini, Grok...).
6. **Gratuito por padrão** para voz. Hoje a voz é speech-to-speech pelo Gemini
   Live, que tem plano gratuito (ADR 0010); a OpenAI Realtime, paga, é só
   opção. Provedores de voz ficam isolados em `src/lib/voz/` e
   `bridge/realtime.mjs`.
7. **Rodar local hoje, servidor amanhã.** Nada pode assumir `localhost` fixo,
   um único usuário conectado ou o sistema de arquivos do Mac.
8. **Mudanças pequenas e verificáveis.** Rode `npm run lint` e `npm run build`
   antes de considerar uma tarefa concluída.

## Git

- Toda branch nova parte da `main` atualizada (`git switch main && git pull`),
  nunca de outra branch — para evitar conflitos.
- Nada é commitado direto na `main`: o trabalho entra por pull request,
  revisado pelo Ricardo.
- Nome de branch (ADR 0016): `fase-x.y/<nome-criativo>`. Cada branch nova soma 0.1
  à maior já usada (`git branch -a`): depois de `fase-2.3/...` vem `fase-2.4/...`.
- Ao mudar de fase, recomeça em `fase-x/<nome>`, com x = fase anterior + 1: depois
  de `fase-2.N/...` vêm `fase-3/...` e `fase-3.1/...`. Só o Ricardo muda de fase.
- O nome é criativo e amplo: evoca a entrega inteira, sem amarrar a uma única
  alteração, porque a branch pode receber mais coisas antes do merge. Exemplo:
  `fase-2.3/voz-e-verniz`, e não `fase-2.3/confirmacao-autodev`.

## Mantenha esta documentação viva

Ao concluir uma tarefa, atualize **no mesmo commit**:
- `docs/01-requisitos.md` — status do requisito (`proposto → em andamento → feito`);
- `docs/05-roadmap.md` — marque o item da fase;
- `docs/adr/` — crie uma ADR nova (copie `docs/adr/0000-modelo.md`) para toda
  decisão de arquitetura, biblioteca ou provedor;
- este arquivo — se mudar comando, estrutura de pastas ou regra.

## Comandos

```bash
npm install          # dependências
npm start            # sobe bridge (cérebro) + interface juntos
npm run bridge       # só o cérebro, modo somente leitura
npm run dev          # só a interface (Vite, https://localhost:5173)
npm run lint         # oxlint
npm run build        # checagem de tipos + build
npm run setup        # confere Node, Claude Code e a chave da voz (Gemini ou OpenAI)
npm start -- --autodev  # permite o autodesenvolvimento (ADR 0011)
npm run https        # confia no certificado local e liga o HTTPS do Tailscale (uma vez)
npm run celular      # pareia o iPhone: token, Tailscale e código de pareamento
npm run logs:celular # resume as medições do app (-- 7 para sete dias, --eventos para quedas)
npm run popups       # compila os popups da web para o app do iPhone
npm run rollback     # descarta a alteração em teste e volta à main (com tudo parado)
npm run test:autodev # testes da política e do rollback
npm run test:autodev:e2e # ciclo real com Chrome headless mudo (leva minutos, fora do npm test)
npm run test:git     # testes do sub-módulo git (commit e pull request)
npm run test:gateway # testes do gateway do celular e do canal do app
npm test             # todos os testes de scripts/
```

## Ambiente

- Desenvolvimento: macOS (Intel x64), VS Code, Node.js ≥ 20, Chrome.
- Linguagem: **TypeScript** em core, web e app (`apps/mobile`, React Native + Expo).
- Modelos Whisper locais já existem em `~/.whisper-models/` (sem uso desde a
  voz speech-to-speech, ADR 0009).
- Chaves no `.env.local`: `GEMINI_API_KEY` (voz, padrão) e, opcional,
  `OPENAI_API_KEY`. A ponte lê esse arquivo; nada disso vai ao navegador.
- Testar a voz exige rodar no próprio Mac (`npm start`): a rede dos ambientes
  de agente não alcança o Google nem a OpenAI.
