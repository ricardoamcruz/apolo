# ADR 0005 — Módulos como servidores MCP + manifesto

- **Status:** aceita (02/11/2026)
- **Data:** 2026-11-01

## Contexto
O A.P.O.L.O deve crescer por módulos plugáveis, em várias linguagens, locais ou remotos.

## Decisão
Cada módulo é um servidor MCP descrito por `apolo.module.json` (`03-modulos.md`).

## Consequências
Padrão aberto, compatível com todos os provedores e com servidores MCP prontos.
O core precisa implementar o host de módulos e o gate baseado no manifesto.
