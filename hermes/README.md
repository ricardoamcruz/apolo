# H.E.R.M.E.S.

**Hub de Enlace Remoto Móvel, Escuta e Sincronia.**

A porta do celular. Confere o token do app e repassa cada conversa, quadro a
quadro, para o assistente; a mídia dos popups vai pelo mesmo caminho. Não entende
a conversa: o que o celular pode pedir é decidido do outro lado. Depende só do
Node (≥ 20) e do `ws`. Decisão e contexto em
`docs/adr/0025-fenix-hermes-servicos-independentes.md` e `docs/adr/0019`.

```bash
node hermes/hermes.mjs
npm test   # dentro desta pasta: node --test test/
```

## Do lado do celular

- `GET wss://<host>:8788/canal` com `Authorization: Bearer <token do celular>`. Ao
  abrir, manda `{ type: 'midia', chave }`. `{"type":"ping"}` recebe
  `{"type":"pong"}` só se o assistente estiver de pé.
- `GET /m/<chave>/(img|media|file|page)?...`: a mídia dos popups. A chave é um HMAC
  do token: vazá-la dá acesso a esses GETs, nunca à conversa.

## Do lado do assistente

- `wss://<assistente>/hermes` com `Authorization: Bearer <token do H.E.R.M.E.S.>`,
  uma conexão por celular.
- `GET /hermes/midia/<rota>?...` com o mesmo token e `x-hermes-base`, o endereço
  público da mídia, para o assistente reescrever links.
- Sem `HERMES_APOLO_TOKEN`, o token é `HMAC-SHA256(token do celular, "hermes.apolo")`
  em base64url, que os dois lados calculam.

## Ambiente

| Variável | Padrão | Para quê |
|---|---|---|
| `HERMES_TOKEN` | `APOLO_GATEWAY_TOKEN` | token do celular; sem ele, sai com código 0 |
| `HERMES_PORTA`, `HERMES_HOST` | 8788, 127.0.0.1 | onde ouvir (o Tailscale entrega aqui) |
| `HERMES_TLS_CERT`, `HERMES_TLS_KEY` | — | com eles, só HTTPS |
| `HERMES_APOLO_URL` | `wss://localhost:8787` | o assistente |
| `HERMES_APOLO_TOKEN` | derivado | o token que o assistente espera |
| `HERMES_APOLO_CA` | — | a autoridade do certificado do assistente |
