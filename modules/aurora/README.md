# A.U.R.O.R.A.

**Agenda, Últimas notícias, Recados, Obrigações, Rock e Alvorada.**

O bom dia do A.P.O.L.O.: um trecho de rock das playlists do YouTube do Ricardo,
baixinho, e o resumo do dia (agenda, notícias por tema, GitHub). Serviço à parte,
só Node (≥ 20), sem dependências. Decisão e limites em
`docs/adr/0026-aurora-bom-dia.md`.

```bash
npm run aurora:autorizar   # uma vez: autoriza a leitura das playlists do YouTube
npm run aurora:resumo      # mostra o texto do bom dia de hoje
npm run aurora             # serve o bom dia (a Fênix já sobe)
npm run test:aurora
```

## API

- `GET /saude` → `{ ok, servico: 'aurora', youtube }`, sem token. É o contrato de quem a
  vigia: a Fênix e a ponte, cada uma por conta própria (docs/adr/0029).
- `GET /bom-dia` com `Authorization: Bearer <token>` →
  `{ ok, texto, musica: { id, titulo, canal, inicio, trechoSegundos, volume } | null, avisoDaMusica, pendencias }`.
- `GET /noticias` com token → `{ ok, temas, porTema, padrao }`: os temas que valem
  agora, que podem não ser os do arquivo (docs/adr/0039).
- `POST /noticias` com token → uma edição por vez, que ele pede por voz:
  `{ tirar }` (parte do nome do tema), `{ incluir: { nome, busca } }`, `{ porTema }`
  (1 a 5) ou `{ restaurar: true }`. Responde `{ ok, mensagem, temas, porTema }`. A
  escolha fica em `AURORA_PASTA/noticias.json`, nunca no `aurora.config.json`.

## Configuração (`aurora.config.json`)

É o **padrão**: o que ele muda por voz fica fora daqui (docs/adr/0039), e
"volta aos temas de sempre" apaga a escolha e faz este arquivo valer de novo.

| Campo | Para quê |
|---|---|
| `noticias.temas[]` | `nome` e `busca` (sintaxe do Google Notícias, aceita `OR`) |
| `noticias.porTema` | quantas manchetes por tema |
| `musica.playlists` | ids de playlists; vazio usa as que têm `filtroDePlaylist` no nome |
| `musica.filtroDePlaylist` | padrão `rock`; sem nenhuma, usa as músicas curtidas |
| `musica.trechoSegundos`, `musica.volume` | duração do trecho e volume (0 a 100) |
| `tarefas.github` | repositório `dono/nome` lido pelo `gh` |

## Ambiente

`AURORA_*` ou `APOLO_*`: `TOKEN` (`APOLO_AURORA_TOKEN`), `PORTA` (8791), `HOST`,
`TLS_CERT`, `TLS_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AGENDA_ICS`,
`PASTA` (`~/.apolo/aurora`) e `CONFIG`. Sem `TLS_*`, usa `~/.apolo/tls` se existir;
a porta também aceita `APOLO_AURORA_PORTA`.

Para avisar o Ricardo pela central de notificações (docs/adr/0027 e 0039):
`NOTIFICAR_TOKEN` (o `APOLO_NOTIFICAR_TOKEN` serve), `NOTIFICAR_URL`
(`https://localhost:8792/notificar`), `NOTIFICAR_PORTA` e `NOTIFICAR_CA`. Sem token,
nenhum aviso sai e o bom dia segue igual.

`npm run aurora` sobe sem a F.Ê.N.I.X. e lê o `.env.local`. Se quem a subiu morre, ela
continua servindo e escreve a saída em `PASTA/aurora.log`; a Fênix, ao voltar, a adota.
