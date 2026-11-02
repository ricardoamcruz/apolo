# 04 — Código-base herdado (fork do JARVIS)

Origem: projeto JARVIS open source (MIT) divulgado por @maxcarrau.ia.
Fork em `github.com/ricardoamcruz/apolo`. Analisado em 01/11/2026.

## Como funciona hoje

Dois processos:
- **Rosto** (`src/`, React + Vite + Three.js): HUD holográfico, palavra de
  ativação, detecção de voz (VAD), STT/TTS, câmera e gestos.
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
| `src/lib/bridge.ts`, `brain.ts` | cliente do cérebro no navegador | manter, apontando para o gateway novo |
| `src/lib/voice.ts`, `vad.ts`, `tts.ts`, `kokoro.ts` | voz | manter; trocar idioma e voz para pt-BR |
| `src/lib/anthropic.ts` | modo "direto" (navegador chama a API) | **remover**: expõe chave no navegador |
| `src/lib/hands.ts`, `camera.ts`, `clap.ts` | gestos, câmera, palmas | manter como recursos opcionais do rosto |
| `src/ui/*`, `src/scene/*` | HUD, boot, reator | manter; trocar identidade visual e textos para A.P.O.L.O |
| `public/audio/*` | trilhas e apresentação falada | **atenção a direitos autorais**: a fala do filme em `boot-music.mp3` foi removida (02/11/2026); a origem de `ambient.mp3` não está confirmada — ver `CREDITS.md` |

## Já adaptado (01/11/2026)

- Nome A.P.O.L.O. na interface, no título e nas mensagens; servidores internos
  renomeados para `apolo`, `apolo_ui`, `apolo_navegador` e `apolo_visao`.
- Persona reescrita em pt-BR (`SYSTEM_PROMPT`), sem "sir"/"senhor".
- Ativação por "Apolo" (reconhecimento do navegador em `pt-BR`).
- Voz provisória: a melhor voz masculina pt-BR do sistema (Reed, Eddy, Rocko).
  O `kokoro-js` instalado só tem vozes em inglês.
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
- Palavra de ativação usa Porcupine (Picovoice), que pede chave de acesso.
