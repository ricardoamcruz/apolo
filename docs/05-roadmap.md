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
- [ ] Persona A.P.O.L.O em pt-BR; identidade visual básica — **em andamento**: nome, persona, ativação "Apolo", STT/TTS e textos da interface em pt-BR feitos (01/11/2026); faltam identidade visual, variáveis `JARVIS_*` e a voz própria
- [ ] Painel de status (módulos, provedor, consumo)

## Fase 2 — Voz e celular
- [ ] Voz pt-BR gratuita (Kokoro `pm_alex` ou alternativa) + STT pt-BR
- [ ] Palavra de ativação "Apolo"
- [ ] Protocolo de canal versionado (RNF-11)
- [ ] App nativo React Native + Expo (MVP: texto, voz, notificações, confirmações), iPhone primeiro — ADR 0006

## Fase 3 — Primeiros módulos
- [ ] E-mail (Gmail + Outlook) · [ ] Agenda (Google + Outlook) · [ ] Briefing diário

## Fase 4 — Expansão
- [ ] Finanças · [ ] Automação residencial
- [ ] Deploy em servidor/nuvem (Docker) e modelo híbrido
