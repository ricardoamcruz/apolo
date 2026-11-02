# ADR 0001 — Evoluir o fork do JARVIS em vez de reescrever

- **Status:** aceita
- **Data:** 2026-11-01

## Contexto
O fork já tem interface holográfica, voz, streaming, gate de permissões e
integração com o Claude Agent SDK funcionando (~15 mil linhas).

## Decisão
Manter o projeto funcionando e migrar `bridge/` para `core/` em passos pequenos,
com o rosto (`src/`) reaproveitado.

## Consequências
Resultado visível desde o início e menos risco. Exige disciplina para não
acumular remendos: cada passo segue `02-arquitetura.md`.
