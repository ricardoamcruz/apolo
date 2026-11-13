# 05 — Roadmap

Marque `[x]` ao concluir e atualize o status em `01-requisitos.md`.

## Pendências em etapas (organizadas em 08/11/2026)
O que ficou aberto depois da `fase-2.7/alvorada`, na ordem sugerida. Cada etapa
vira uma branch nova a partir da `main` (ADR 0016).

### Etapa 1 — Validar o que já está pronto (sem código novo, só ajustes)
- [x] **Bom dia por voz (RF-55):** dizer "bom dia" no PC; ajustar volume e duração do trecho em `modules/aurora/aurora.config.json`. Em 09/11/2026: popups de notícias, compromissos e desenvolvimento em diagonal, "obrigado" fecha tudo e põe em espera, outro assunto minimiza; o tocador agora percebe quando o Chrome segura o autoplay e pede um clique; a confirmação do autodev recusada (fora da `main`) não trava mais o botão; com os popups na tela a conversa fica aberta até 3 min; o visual de espera só aparece quando ela é pedida (voz ou Esc), e a espera automática deixa a tela igual
- [x] **App do iPhone pelo H.E.R.M.E.S.:** conversar normalmente pelo relé (ADR 0025)
- [x] **Fênix por voz:** um script bash com confirmação (`--writes`) e uma rotina respondendo depois de rodar (correção do id da resposta)
- [x] **Notificações (RF-66):** o sentido iPhone → Mac pelo tópico `<tópico>-mac`; o botão **Descartar** numa versão em teste
- [x] **Autodesenvolvimento com o agente real (RF-15):** pedido por voz, conferência com `npm test`, teste ao vivo, aprovar e abrir o PR. Desde 12/11/2026 também pelo número do backlog ("Apolo, faz o item 1.3"; ADR 0028)
- [x] **Pacto com a Fênix (RF-67, ADR 0028):** no Mac, `kill -9` na Fênix com tudo no ar e ver o A.P.O.L.O. revivê-la (a interface reconecta e chega o aviso "a Fênix renasceu"); e um pedido de autodev que quebre a ponte, voltando à `main` sozinho. Os dois já passam em `npm run test:resiliencia`
- [x] **Asas próprias (ADR 0029):** no Mac, `kill -9` na Fênix com tudo no ar e ver o celular, as notificações e o bom dia seguirem (SISTEMAS mostra a Fênix caída e os outros de pé); quando ela voltar, o H.E.R.M.E.S. e a Aurora são adotados, sem reiniciar. Na `main`, `npm run atualizar` com um commit novo no GitHub
- [ ] **Autonomia no iPhone (ADR 0030):** pelo app, "qual o backlog?", um item do backlog pelo número até aprovar, uma rotina da Fênix e um script bash confirmado falando (com `npm start -- --writes --autodev`)
- [x] **Git (RF-17):** push e `gh pr create` no Mac do Ricardo
- [x] **Navegador (RF-19):** abrir abas com os pop-ups liberados
- [x] **Espera natural (6.a):** conversa contínua com a TV ligada e alguém conversando ao lado
- [x] Revogar a senha de app da Microsoft, que não funciona, e apagar `APOLO_OUTLOOK_SENHA_APP` do `.env.local` (12/11/2026: revogada pelo Ricardo e apagada)

### Etapa 2 — Identidade visual inspirada em Horizon (ADR 0013)
- [x] Página de comparação com 2 ou 3 paletas (ciano atual × âmbar sobre azul profundo) e propostas de núcleo 3D original; **a escolha é do Ricardo** (12/11/2026: ciano, núcleo Enxame, marca Lira e ícones dos módulos; ADR 0013 revisada)
- [x] Implementar a paleta e o núcleo escolhidos (12/11/2026; os ícones no app do iPhone esperam uma biblioteca de SVG)
- [ ] Trazer as fontes para o repositório e fechar o CSP de fontes
- [x] Reator na densidade real da tela, sem ampliação do navegador (13/11/2026, ADR 0032): o canvas lê `window.devicePixelRatio` por `src/lib/densidade.ts`, com teto 3. Falta ver no iPhone

### Etapa 3 — Contexto e comunicação
- [ ] **Contexto compartilhado (RF-18):** decidir entre branch local e arquivo de contexto (ADR nova); é o único item do backlog que não começou
- [ ] O A.P.O.L.O. e a A.U.R.O.R.A. pedindo notificações ao H.E.R.M.E.S. (hoje só a Fênix pede)
- [ ] Aviso ditado por voz no app do iPhone indo para a central do Mac
- [ ] Bom dia também no celular
- [ ] Temas de notícia editáveis por voz ("tira games do bom dia")
- [ ] Servidor ntfy próprio, para o texto das notificações não passar por terceiros

### Etapa 4 — Bloqueada por decisão do Ricardo
- [ ] **E-mails e Microsoft To Do no bom dia:** exigem app registrado na Microsoft, que exige diretório no Azure com cartão (ADR 0026)
- [ ] **Push nativo no app e CarPlay:** exigem a conta paga da Apple (ADR 0020 e 0027)
- [ ] **Avisos pelo WhatsApp (RF-65):** P.O.C. do CallMeBot; o ntfy já cobre os avisos, então só se ele ainda quiser o WhatsApp
- [ ] **Voz própria:** ferramenta a definir

### Etapa 5 — Fase 1 — Core
- [ ] Ver a seção "Fase 1 — Core" abaixo: `core/` em TypeScript, `Provider`, host de módulos (com a fachada MCP da A.U.R.O.R.A.)

### Etapa 6 — Bugs para corrigir
- [ ] **Entra em espera no meio da conversa (13/11/2026):** às vezes o Ricardo fala com o Apolo, ele não responde e entra em espera; ao apertar espaço, ele volta e responde o que foi dito. Suspeitas: a janela de conversa (`criarJanela`, 20 s sem nada dirigido a ele) fecha o microfone enquanto ele ainda está ouvindo ou pensando; o filtro da espera natural (6.a) julga a fala como conversa ao lado; ou a resposta chega com o microfone já fechado e só sai quando ele acorda. Os logs da voz (`[apolo] voz: …` no Terminal) ajudam a ver o momento em que ele entrou em espera
- [ ] **Popup aberta que ele não reconhece (13/11/2026):** o Apolo abriu uma popup e, depois, não conseguiu identificar que ela estava aberta
- [ ] **Não registra bug no backlog (13/11/2026):** pedido por voz para relatar um bug no backlog, o Apolo não conseguiu incluir

## Próxima versão — backlog (registrado em 03/11/2026)
Os 6 pontos que o Ricardo definiu para a próxima versão. Eles têm prioridade
sobre a ordem das fases abaixo.

- [x] **1. Limpar a tela (RF-16):** "limpe a bagunça", "tira isso da tela" e "fecha esses popups" fecham os painéis e os artigos abertos sem apagar a conversa; "apague o histórico" e "limpe tudo" são os outros escopos, e ele informa o que saiu ou que a tela já estava limpa (03/11/2026). Falta validar por voz no navegador
- [ ] **2. Sub-módulo git (RF-17):** o A.P.O.L.O. faz commits e gera pull requests para a própria `main` — **em andamento**: ferramentas `git_*` implementadas (ADR 0014, 05/11/2026), com commit só fora da `main`, conferência de segredos, sem merge e sem `--force`, testes offline em `npm run test:git`; falta validar na máquina do Ricardo o push no `origin` e o `gh pr create`
- [ ] **3. Contexto compartilhado (RF-18):** avaliar salvar informações importantes em uma branch local ou em um arquivo de contexto compartilhado, para uso futuro
- [ ] **4. Gerar código para si próprio (RF-15):** ciclo de teste com aprovação (ADR 0015, 06/11/2026), verificado de ponta a ponta com agente falso em `npm run test:autodev:e2e`; confirmar sem proposta ativa agora é recusado com a causa real, sem pedir de novo um botão que não existe (06/11/2026); conferência com `npm test` e PR oferecido ao aprovar (08/11/2026); falta validar por voz com o agente real
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
- [ ] **Pacto A.P.O.L.O. ↔ F.Ê.N.I.X. (RF-67):** quem faz o quê nas instruções da voz, backlog pelo número no autodev, a Fênix deixa a receita do renascimento e a ponte a revive quando ela morre, com limite de 3 em 10 min — **em andamento** (ADR 0028, 12/11/2026); testado com processos de verdade em `scripts/resiliencia.test.mjs`; falta validar no Mac. Depois: reviver também quando os dois morrem juntos (um vigia no `launchd`) e uma Fênix viva mas travada
- [ ] **Bom dia com rock (RF-55):** A.U.R.O.R.A. com trecho do YouTube Music, agenda (.ics), notícias por tema e GitHub — **em andamento** (ADR 0026, 08/11/2026); falta e-mail e To Do (exigem app na Microsoft) e validar por voz
- [ ] **Notificações push (RF-66):** central no H.E.R.M.E.S. (Mac e ntfy), botões de resposta e avisos da F.Ê.N.I.X. — **em andamento** (ADR 0027, 08/11/2026); falta validar no iPhone
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
