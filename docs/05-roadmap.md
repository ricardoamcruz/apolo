# 05 — Roadmap

Marque `[x]` ao concluir e atualize o status em `01-requisitos.md`.

## Próxima versão — backlog (registrado em 03/11/2026)
Os 6 pontos que o Ricardo definiu para a próxima versão. Eles têm prioridade
sobre a ordem das fases abaixo.

- [x] **1. Limpar a tela (RF-16):** "limpe a bagunça", "tira isso da tela" e "fecha esses popups" fecham os painéis e os artigos abertos sem apagar a conversa; "apague o histórico" e "limpe tudo" são os outros escopos, e ele informa o que saiu ou que a tela já estava limpa (03/11/2026). Falta validar por voz no navegador
- [ ] **2. Sub-módulo git (RF-17):** o A.P.O.L.O. faz commits e gera pull requests para a própria `main`
- [ ] **3. Contexto compartilhado (RF-18):** avaliar salvar informações importantes em uma branch local ou em um arquivo de contexto compartilhado, para uso futuro
- [ ] **4. Gerar código para si próprio (RF-15):** integrar-se ao VS Code e ao Claude para isso — a base está nesta versão; falta validar o fluxo completo com o agente real
  - [ ] **4.a** Essa habilidade funciona em conjunto com a de se auto-reiniciar
  - [ ] **4.b** Se algo der errado, o rollback automático entra em ação
- [ ] **5. Navegador (RF-19):** detectar em qual navegador e sistema está rodando, abrir novas abas e transformar uma popup aberta em aba — **em andamento**: ferramentas `browser_*` implementadas (ADR 0012, 04/11/2026); falta validar no navegador do Mac, liberar pop-ups para o endereço da interface e decidir se vale criar aba pela extensão do Claude quando o bloqueador recusar
- [ ] **6. Comandos por voz (RF-20):** tudo o que hoje tem atalho de teclado também pode ser acionado por voz
  - [ ] **6.a** Em espera: "Apolo, em espera", ou entrar em espera sozinho ao fim de uma conversa, da forma mais natural possível e sem se intrometer quando o Ricardo falar com outra pessoa ao lado
  - [ ] **6.b** Popups: alternar por voz (hoje `[` e `]`), além de tela cheia (`E`) e fechar (`X`)
  - [ ] **6.c** Modo mãos: ativar e desativar por voz (hoje `G`)
  - [ ] **6.d** Demais comandos, com ativação e desativação por voz: diagnóstico (`D`), interromper a fala e acordar (`Espaço`), cancelar tarefa (`Esc`)
  - [ ] **6.e** Se o Ricardo esquecer um comando, o A.P.O.L.O. explica e lembra quais existem

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
- [ ] Memória em SQLite
- [ ] Agendador e barramento de eventos
- [ ] Gateway com token de acesso (logo depois: chat por texto no app iPhone conectado a ele, antes da voz no celular)
- [ ] Persona A.P.O.L.O em pt-BR; identidade visual básica — **em andamento**: nome, persona e textos da interface em pt-BR feitos (01/11/2026); voz em tempo real speech-to-speech em pt-BR (ADR 0009/0010, 03/11/2026); abertura reduzida à barra de status e aos anéis com o nome, sem o reator e o esquema da armadura herdados do JARVIS (03/11/2026); faltam identidade visual e variáveis `JARVIS_*`
- [ ] Painel de status (módulos, provedor, consumo)

## Fase 2 — Voz e celular
- [ ] Autodesenvolvimento por voz e chat, com rollback automático (ADR 0011, RF-15) — **em andamento**: implementado e testado; o `.env.local` passou a ser lido antes de qualquer módulo que leia configuração (`bridge/env.mjs`), então `APOLO_AUTODEV_*` e `JARVIS_MODEL` valem nesse arquivo, e não só no terminal (03/11/2026); falta validar por voz no navegador e aprovar a ADR
- [x] Voz pt-BR gratuita em tempo real — speech-to-speech pelo Gemini Live, OpenAI como opção (ADR 0009 e 0010, 03/11/2026)
- [ ] Palavra de ativação "Apolo" (hoje: Espaço ou palmas acordam)
- [ ] Voz no app de celular usando o mesmo `POST /realtime/sessao` da ponte
- [ ] Protocolo de canal versionado (RNF-11)
- [ ] App nativo React Native + Expo (MVP: texto, voz, notificações, confirmações), iPhone primeiro — ADR 0006

## Fase 3 — Primeiros módulos
- [ ] E-mail (Gmail + Outlook) · [ ] Agenda (Google + Outlook) · [ ] Briefing diário

## Fase 4 — Expansão
- [ ] Finanças · [ ] Automação residencial
- [ ] Deploy em servidor/nuvem (Docker) e modelo híbrido
