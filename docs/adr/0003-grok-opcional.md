# ADR 0003 — Grok como provedor opcional

- **Status:** aceita
- **Data:** 2026-11-01

## Contexto
A API da xAI é pré-paga; os US$ 25/mês gratuitos acabaram com o beta (dez/2024).
O Grok gratuito só existe no app e no site, sem API.

## Decisão
Implementar o adaptador xAI, mas desligado por padrão. Ativar só com chave e créditos.

## Consequências
O sistema funciona sem custo extra; o Grok entra quando fizer sentido pagar.
