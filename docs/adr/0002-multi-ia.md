# ADR 0002 — Multi-IA por interface Provider + roteador

- **Status:** aceita (02/11/2026)
- **Data:** 2026-11-01

## Contexto
O usuário quer Claude (principal), Gemini e Grok. A base só fala com Claude.

## Decisão
Criar `core/providers` com uma interface comum e um roteador com política por
tarefa e fallback. Claude via Agent SDK (agêntico); os demais via biblioteca
unificada com loop de ferramentas no core.

## Consequências
Nenhum provedor vira ponto único de falha; custo controlado. Exige tratar
diferenças de capacidade (ferramentas, visão, streaming) entre provedores.
