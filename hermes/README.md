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

## Notificações (docs/adr/0027)

- Serviços conectam em `wss://127.0.0.1:8792/notificacoes` com `Authorization: Bearer
  <APOLO_NOTIFICAR_TOKEN>` e mandam `{ type: 'notificar', id, titulo, texto,
  prioridade: 'baixa'|'normal'|'alta', botoes: [{ rotulo, acao }] }`. Recebem
  `notificar:resposta` e, se ele tocar num botão, `{ type: 'notificacao:acao',
  notificacao, acao }`.
- Entrega na central do macOS e no tópico do ntfy. Cada botão é
  `<HERMES_URL_PUBLICA>/acao/<token>`, de uso único, com prazo de 1 h.
- O que for publicado em `<tópico>-mac` no ntfy aparece na central do macOS.

## Sozinho (docs/adr/0029)

- `npm run hermes` sobe sem a F.Ê.N.I.X. e lê o `.env.local`; os padrões abaixo são
  dele. `GET /saude` na porta local dos serviços (8792) responde sem token, mesmo sem
  notificações configuradas: é por ali que a Fênix e a ponte sabem se ele está de pé.
- Se quem o subiu morre, ele continua atendendo e passa a escrever a saída em
  `HERMES_PASTA/hermes.log`, com uma linha dizendo o que houve. Quando a Fênix volta,
  ela o adota em vez de reiniciá-lo.

## Ambiente

| Variável | Padrão | Para quê |
|---|---|---|
| `HERMES_TOKEN` | `APOLO_GATEWAY_TOKEN` | token do celular; sem ele, sai com código 0 |
| `HERMES_PORTA`, `HERMES_HOST` | 8788, 127.0.0.1 | onde ouvir (o Tailscale entrega aqui) |
| `HERMES_TLS_CERT`, `HERMES_TLS_KEY` | `APOLO_TLS_*`, ou `~/.apolo/tls` se existir | com eles, só HTTPS |
| `HERMES_APOLO_URL` | `wss://localhost:<JARVIS_BRIDGE_PORT ou 8787>` | o assistente |
| `HERMES_APOLO_TOKEN` | derivado | o token que o assistente espera |
| `HERMES_APOLO_CA` | o próprio certificado | a autoridade do certificado do assistente |
| `HERMES_NOTIFICAR_TOKEN` | `APOLO_NOTIFICAR_TOKEN` | quem pode pedir notificações |
| `HERMES_NOTIFICAR_PORTA` | `APOLO_NOTIFICAR_PORTA`, 8792 | a porta local dos serviços e da saúde |
| `HERMES_PASTA` | `~/.apolo/hermes` | o registro quando ninguém lê a saída |
| `HERMES_NTFY_TOPICO` | `APOLO_NTFY_TOPICO` | o tópico do ntfy (segredo); entrada em `<tópico>-mac` |
| `HERMES_NTFY_URL` | `https://ntfy.sh` | o servidor do ntfy |
| `HERMES_URL_PUBLICA` | `APOLO_HERMES_URL_PUBLICA` | o endereço do H.E.R.M.E.S. no Tailscale, para os botões |
