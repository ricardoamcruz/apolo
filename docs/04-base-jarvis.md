# 04 — Código-base herdado (fork do JARVIS)

Origem: projeto JARVIS open source (MIT) divulgado por @maxcarrau.ia.
Fork em `github.com/ricardoamcruz/apolo`. Analisado em 01/11/2026.

## Como funciona hoje

Dois processos:
- **Rosto** (`src/`, React + Vite + Three.js): HUD holográfico, câmera e
  gestos. No JARVIS original também fazia ativação, VAD, STT e TTS; no
  A.P.O.L.O isso foi substituído pela voz speech-to-speech (ADR 0009 e 0010).
- **Cérebro** (`bridge/server.mjs`, Node): roda o **Claude Agent SDK** (Claude
  Code sem interface), autenticado pelo login do Claude Code. Conversa com o
  rosto por WebSocket em `ws://localhost:8787`.

## Mapa do que reaproveitar

| Arquivo/pasta | O que faz | Destino no A.P.O.L.O |
|---|---|---|
| `bridge/server.mjs` (1.463 linhas) | WebSocket, HTTP, gate `decideTool`, persona, sessão do Agent SDK | desmontar em `core/gateway`, `core/orchestrator`, `core/permissions`, `core/providers/claude-agent` |
| `bridge/panels.mjs` | ferramenta `display`: o modelo desenha painéis do HUD | manter; vira serviço do core para módulos |
| `bridge/ui.mjs` | ferramentas `ui_*` (tema, reator, efeitos) | manter |
| `bridge/chrome.mjs`, `page.mjs`, `net.mjs` | controla o Chrome e busca páginas com proteção SSRF | virar **módulo** `navegador` |
| `bridge/vision.mjs` | câmera | virar **módulo** `visao` |
| `src/lib/bridge.ts` | cliente do agente de tarefas no navegador | manter, apontando para o gateway novo (`brain.ts` removido em 03/11/2026) |
| `src/lib/voice.ts`, `vad.ts`, `tts.ts`, `kokoro.ts` | voz | **removidos** (03/11/2026): substituídos por `src/lib/realtime.ts` e `src/lib/voz/` |
| `src/lib/anthropic.ts` | modo "direto" (navegador chama a API) | **removido** (03/11/2026): expunha chave no navegador |
| `src/lib/hands.ts`, `camera.ts`, `clap.ts` | gestos, câmera, palmas | manter como recursos opcionais do rosto |
| `src/ui/*`, `src/scene/*` | HUD, boot, reator | manter; trocar identidade visual e textos para A.P.O.L.O |
| `public/audio/*` | trilhas e apresentação falada | **atenção a direitos autorais**: a fala do filme em `boot-music.mp3` foi removida (02/11/2026); a origem de `ambient.mp3` não está confirmada — ver `CREDITS.md` |

## Já adaptado (01/11/2026)

- Nome A.P.O.L.O. na interface, no título e nas mensagens; servidores internos
  renomeados para `apolo`, `apolo_ui`, `apolo_navegador` e `apolo_visao`.
- Persona reescrita em pt-BR (`SYSTEM_PROMPT`), sem "sir"/"senhor".
- Voz (03/11/2026): speech-to-speech pelo Gemini Live (padrão) ou OpenAI
  Realtime; o Claude virou o agente de tarefas chamado pela voz. Sem palavra de
  ativação por enquanto. Interface, diagnóstico e mensagens 100% em pt-BR.
- `npm start` encerra sozinho um A.P.O.L.O. antigo que esteja segurando as portas.
- Pendente: variáveis de ambiente ainda se chamam `JARVIS_*`.

## Pontos de atenção

- **Acoplado a um provedor**: só Claude via Agent SDK → introduzir `Provider`.
- **Só `localhost`**: origens fixas em dev, sem autenticação → o gateway precisa
  de token antes de abrir para o celular.
- **Gate por regex de verbos**: bom ponto de partida, mas as permissões devem
  vir do manifesto do módulo (`03-modulos.md`).
- **Servidores MCP lidos de `~/.claude.json`**: mistura as ferramentas pessoais
  do Claude Code com as do assistente → o A.P.O.L.O passa a carregar só os
  módulos dele.
- **`settingSources: []`** (bom): impede que configurações globais do Claude
  Code afrouxem o gate. Manter.
- A ativação por Porcupine (Picovoice) foi removida junto com o pipeline antigo.
