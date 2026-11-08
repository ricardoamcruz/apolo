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

- `GET /saude` → `{ ok, youtube }`, sem token.
- `GET /bom-dia` com `Authorization: Bearer <token>` →
  `{ ok, texto, musica: { id, titulo, canal, inicio, trechoSegundos, volume } | null, avisoDaMusica, pendencias }`.

## Configuração (`aurora.config.json`)

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
`PASTA` (`~/.apolo/aurora`) e `CONFIG`.
