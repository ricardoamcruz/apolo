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
- O código ainda é o fork do JARVIS (`bridge/`, `src/`), já renomeado para
  A.P.O.L.O. e em pt-BR (persona, ativação "Apolo", voz masculina do sistema).
  O core (`core/`) ainda não existe. Variáveis de ambiente seguem `JARVIS_*`.
- **App mobile:** `apps/mobile` (Expo SDK 58, RN 0.88), app "olá" validado no
  iPhone (bundle `com.ricardocruz.apolo`, Personal Team `9F2MVYQ9SF`). Ainda não
  conversa com o core: depende do gateway com token (Fase 1). CocoaPods usa o
  Ruby portátil do Homebrew (`scripts/setup-mobile.command`); no Homebrew,
  Intel + macOS 26 compila LLVM por horas — sempre responder `n`.
- **Voz própria:** pendente; o usuário quer usar o "Voice Studio" (ferramenta a
  confirmar). ADR nova quando definida.
- **Autodesenvolvimento (ADR 0011):** com `npm start -- --autodev`, o A.P.O.L.O.
  altera o próprio código por voz ou chat, com confirmação, numa worktree em
  `~/.apolo/autodev`, e reinicia com rollback automático. As branches ficam em
  `autodev/<id>`; a cópia em execução pode estar numa delas. Arquivos sensíveis
  (`bridge/autodev/politica.mjs`) nunca entram no ar sem revisão.
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
npm run dev          # só a interface (Vite, http://localhost:5173)
npm run lint         # oxlint
npm run build        # checagem de tipos + build
npm run setup        # confere Node, Claude Code e a chave da voz (Gemini ou OpenAI)
npm start -- --autodev  # permite o autodesenvolvimento (ADR 0011)
npm run rollback     # volta a última alteração do autodesenvolvimento (com tudo parado)
npm run test:autodev # testes da política e do rollback
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
