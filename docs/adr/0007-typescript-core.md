# ADR 0007 — TypeScript como linguagem do core

- **Status:** aceita
- **Data:** 2026-11-01

## Contexto
A base do JARVIS é Node/TypeScript; o app nativo será React Native.

## Decisão
Core, interface web e app em **TypeScript**. Módulos podem usar outras
linguagens, pois falam com o core por MCP.

## Consequências
Tipos compartilhados (ex.: o protocolo de canal) entre core, web e app num só
pacote. Arquivos `.mjs` herdados em `bridge/` são migrados para `.ts` ao irem para `core/`.
