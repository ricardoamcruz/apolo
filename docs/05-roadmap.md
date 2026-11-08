# 05 — Roadmap

Marque `[x]` ao concluir e atualize o status em `01-requisitos.md`.

## Próxima versão — backlog (registrado em 03/11/2026)
Os 6 pontos que o Ricardo definiu para a próxima versão. Eles têm prioridade
sobre a ordem das fases abaixo.

- [x] **1. Limpar a tela (RF-16):** "limpe a bagunça", "tira isso da tela" e "fecha esses popups" fecham os painéis e os artigos abertos sem apagar a conversa; "apague o histórico" e "limpe tudo" são os outros escopos, e ele informa o que saiu ou que a tela já estava limpa (03/11/2026). Falta validar por voz no navegador
- [ ] **2. Sub-módulo git (RF-17):** o A.P.O.L.O. faz commits e gera pull requests para a própria `main` — **em andamento**: ferramentas `git_*` implementadas (ADR 0014, 05/11/2026), com commit só fora da `main`, conferência de segredos, sem merge e sem `--force`, testes offline em `npm run test:git`; falta validar na máquina do Ricardo o push no `origin` e o `gh pr create`
- [ ] **3. Contexto compartilhado (RF-18):** avaliar salvar informações importantes em uma branch local ou em um arquivo de contexto compartilhado, para uso futuro
- [ ] **4. Gerar código para si próprio (RF-15):** ciclo de teste com aprovação (ADR 0015, 06/11/2026), verificado de ponta a ponta com agente falso em `npm run test:autodev:e2e`; confirmar sem proposta ativa agora é recusado com a causa real, sem pedir de novo um botão que não existe (06/11/2026); falta validar por voz com o agente real
  - [ ] **4.a** Essa habilidade funciona em conjunto com a de se auto-reiniciar — **em andamento**: quem reinicia agora é a F.Ê.N.I.X., um serviço à parte que sobe a versão nova, guarda os serviços e roda as rotinas (RF-64, ADR 0025, 08/11/2026); verificado em `npm run test:autodev:e2e`; falta validar por voz
  - [ ] **4.b** Se algo der errado, o rollback automático entra em ação — **em andamento**: a F.Ê.N.I.X. volta à `main` numa queda, na saúde falhando ou numa atualização que não sobe (ADR 0025); falta validar por voz
- [ ] **5. Navegador (RF-19):** detectar em qual navegador e sistema está rodando, abrir novas abas e transformar uma popup aberta em aba — **em andamento**: ferramentas `browser_*` implementadas (ADR 0012, 04/11/2026); falta validar no navegador do Mac, liberar pop-ups para o endereço da interface e decidir se vale criar aba pela extensão do Claude quando o bloqueador recusar
- [ ] **6. Comandos por voz (RF-20):** tudo o que hoje tem atalho de teclado também pode ser acionado por voz — **em andamento**: 6.b a 6.e feitos e validados por voz (ADR 0023, 07/11/2026), com uma lista só de comandos em `bridge/comandos.mjs` e testes em `scripts/comandos.test.mjs`; falta validar o 6.a com a conversa contínua (ADR 0024)
  - [ ] **6.a** Em espera: "Apolo, em espera", ou entrar em espera sozinho ao fim de uma conversa, da forma mais natural possível e sem se intrometer quando o Ricardo falar com outra pessoa ao lado — **em andamento**: `dormir` cobre "em espera", "já volto" e "boa noite" de despedida; em espera só o nome acorda por voz, com visual próprio; fim de fala mais paciente e `ignorar_fala` (ADR 0017, 06/11/2026); o nome sozinho acorda sem esperar o Chrome fechar a frase (07/11/2026); conversa contínua por 20 s depois do nome, sem a TV segurar a conversa aberta, e o nome também acorda no celular (ADR 0024, 07/11/2026). Falta validar por voz
  - [x] **6.b** Popups: alternar por voz (hoje `[` e `]`), além de tela cheia (`E`) e fechar (`X`) — implementado na web e no celular, com as teclas pela mesma função; `]` e `[` passaram a percorrer todos os popups, e não só dois. validado por voz (07/11/2026)
  - [x] **6.c** Modo mãos: ativar e desativar por voz (hoje `G`) — implementado; ligar confere na transcrição que ele pediu a câmera; validado por voz (07/11/2026)
  - [x] **6.d** Demais comandos, com ativação e desativação por voz: diagnóstico (`D`), interromper a fala e acordar (`Espaço`), cancelar tarefa (`Esc`) — implementado; cancelar sai da transcrição, porque o Gemini espera a tarefa acabar; validado por voz (07/11/2026)
  - [x] **6.e** Se o Ricardo esquecer um comando, o A.P.O.L.O. explica e lembra quais existem — implementado pela lista nas instruções da voz; validado por voz (07/11/2026)

### Depois da próxima versão
- [ ] **F.Ê.N.I.X. (RF-64):** guardiã, versões, atualizar, rotinas e scripts confirmados — **em andamento** (ADR 0025, 08/11/2026); falta validar o celular pelo H.E.R.M.E.S. no aparelho, um script por voz e a rotina `app_iphone`
- [ ] **Avisos pelo WhatsApp (RF-65):** P.O.C. com o CallMeBot (`docs/poc/0001-callmebot-whatsapp.md`)

## Fase 0 — Fundação
- [x] Analisar o código-base do JARVIS (`04-base-jarvis.md`)
- [x] Levantar requisitos iniciais (`01-requisitos.md`)
- [x] Propor arquitetura e contrato de módulos (`02`, `03`)
- [x] Responder as perguntas principais (base, celular, e-mail, Grok, linguagem)
- [x] Aprovar as ADRs 0002, 0004 (revisada) e 0005 — 02/11/2026
- [x] Rodar o JARVIS original neste Mac (linha de base funcionando) — 01/11/2026
- [x] Preparar ambiente mobile (`docs/06-ambiente-mobile.md`) e validar um app "olá" no iPhone (01/11/2026, iPhone 14 Pro Max, build Release assinado com Personal Team)
- [ ] Validar o mesmo app "olá" no Android (adiado por decisão do Ricardo em 01/11/2026)

## Fase 1 — Core
- [ ] Estrutura `core/` em TypeScript; `bridge/` passa a delegar para ele
- [ ] Interface `Provider` + adaptador Claude (Agent SDK) + Gemini
- [ ] Roteador com fallback e registro de consumo
- [ ] Host de módulos com manifesto v1 + `modules/_exemplo`
- [ ] Gate de permissões por manifesto + confirmação na interface + auditoria
- [ ] Memória em SQLite (hoje só as preferências de exibição persistem, em arquivo: RF-57; migrar para cá)
- [ ] Agendador e barramento de eventos
- [ ] Gateway com token de acesso — **em andamento**: `bridge/gateway.mjs`, porta própria só com o canal, publicada pelo Tailscale (ADR 0019, 06/11/2026). Falta validar fora de casa
- [ ] Persona A.P.O.L.O em pt-BR; identidade visual básica — **em andamento**: nome, persona e textos da interface em pt-BR feitos (01/11/2026); voz em tempo real speech-to-speech em pt-BR (ADR 0009/0010, 03/11/2026); abertura reduzida à barra de status e aos anéis com o nome, sem o reator e o esquema da armadura herdados do JARVIS (03/11/2026), e depois removida: a página liga sozinha, direto no círculo, como no app (07/11/2026); identidade visual começada (ADR 0013, 05/11/2026): barra lateral direita "SINAL" removida, tipografia e cor em tokens no `:root`, marca própria no favicon, `__jarvis` → `__apolo` no console. Faltam as fontes locais (sem o Google Fonts), a decisão da paleta, a geometria do núcleo 3D, o painel de status (RF-12) e as variáveis `JARVIS_*`
- [ ] Painel de status (módulos, provedor, consumo) — **em andamento**: aba SISTEMAS sob demanda, com o C.O.R.E. e a cor de alerta contrastante (ADR 0018, RF-56, 06/11/2026). Falta validar o pedido por voz e somar provedor e consumo

## Fase 2 — Voz e celular
- [ ] Autodesenvolvimento por voz e chat, com teste, aprovação e rollback para a `main` (ADR 0011, ADR 0015, RF-15) — **em andamento**: implementado e testado; o `.env.local` passou a ser lido antes de qualquer módulo que leia configuração (`bridge/env.mjs`), então `APOLO_AUTODEV_*` e `JARVIS_MODEL` valem nesse arquivo, e não só no terminal (03/11/2026); falta validar por voz no navegador
- [x] Voz pt-BR gratuita em tempo real — speech-to-speech pelo Gemini Live, OpenAI como opção (ADR 0009 e 0010, 03/11/2026)
- [ ] Palavra de ativação "Apolo" — **em andamento**: no PC, pela Web Speech API do navegador, só em espera (ADR 0017, 06/11/2026). Falta validar por voz e levar ao celular
- [x] Voz no app de celular com a mesma credencial da ponte, pelo canal autenticado — sessão aberta com o Google a partir da WebView (ADR 0019, 06/11/2026); validada no iPhone pelo Ricardo (07/11/2026)
- [ ] Protocolo de canal versionado (RNF-11)
- [ ] App nativo React Native + Expo (MVP: texto, voz, notificações, confirmações), iPhone primeiro — ADR 0006 — **em andamento**: voz, círculo e partículas da web e os mesmos popups, sem conversa na tela, pelo gateway (ADR 0019, 06/11/2026), validados no iPhone (07/11/2026). Faltam notificações, confirmações e manter a sessão quando o iOS suspende o app
- [x] Sinal de escuta, palavras ouvidas e partículas compostas para a tela do celular (RF-58) — validado no iPhone (07/11/2026)
- [x] Telemetria do celular em `~/.apolo/logs` (RF-59, ADR 0020) — validada no iPhone (07/11/2026)
- [ ] Uso dirigindo (RF-60, ADR 0020) — **em andamento**: voz só com o app aberto (sem segundo plano desde 07/11/2026), por validar no carro; CarPlay nativo depende de conta paga e aprovação da Apple
- [x] Padrão de cores na web e no app, e fechar popups por voz no celular (RF-61, ADR 0021) — validado no iPhone (07/11/2026)
- [x] HTTPS em toda conexão (RF-62, ADR 0021) — validado com o app operando (07/11/2026)
- [ ] Comandos entre dispositivos (RF-63, ADR 0022) — ponto de extensão pronto; a extensão vem depois

## Em todas as fases seguintes
- [ ] **Tudo o que for plugável aparece na aba SISTEMAS (RF-56):** cada skill, sub-sistema plugável, extensão, API e conector novo entra como uma linha própria, com estado e a cor de alerta quando degradado. Faz parte de concluir o item, não é um extra

## Fase 3 — Primeiros módulos
- [ ] E-mail (Gmail + Outlook) · [ ] Agenda (Google + Outlook) · [ ] Briefing diário

## Fase 4 — Expansão
- [ ] Finanças · [ ] Automação residencial
- [ ] Deploy em servidor/nuvem (Docker) e modelo híbrido
