# 05 — Roadmap

Marque `[x]` ao concluir e atualize o status em `01-requisitos.md`.

## Fase 0 — Fundação (atual)
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
- [ ] Persona A.P.O.L.O em pt-BR; identidade visual básica — **em andamento**: nome, persona e textos da interface em pt-BR feitos (01/11/2026); voz em tempo real speech-to-speech em pt-BR (ADR 0009/0010, 03/11/2026); faltam identidade visual e variáveis `JARVIS_*`
- [ ] Painel de status (módulos, provedor, consumo)

## Fase 2 — Voz e celular
- [ ] Autodesenvolvimento por voz e chat, com rollback automático (ADR 0011, RF-15) — **em andamento**: implementado e testado; falta validar por voz no navegador e aprovar a ADR
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
