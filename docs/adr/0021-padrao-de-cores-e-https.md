# ADR 0021 — Padrão de cores e HTTPS em toda conexão

- **Status:** proposta
- **Data:** 2026-11-07
- **Revisa:** ADR 0013 quanto à cor por fase; a cor da marca segue em aberto

## Contexto
A cor mudava com a fase, mas não dizia o que ele estava fazendo, e no celular a fala
apagava o estado de processamento durante uma tarefa. A ponte e a interface falavam
`http`/`ws` em localhost.

## Decisão
**Cores.** `src/lib/estados.ts` é a fonte única, usada pela web e pelo app:

| Estado | Cor |
|---|---|
| Ouvindo | verde |
| Pesquisando, processando, calculando | amarelo |
| Executando script | lilás |
| Codificando, reconfigurando | vermelho |
| Pausa, espera, escuta passiva | azul claro (o ciano de sempre) |
| Respondendo | quase branco |

A categoria vem do nome da ferramenta (`atividadeDaFerramenta`). Com tarefa em
andamento, a cor é dela, mesmo enquanto ele fala. O autodesenvolvimento em curso é
vermelho em qualquer fase. Uma cor pedida por voz continua tendo prioridade.

**HTTPS.** Ponte, interface e gateway só aceitam TLS, e a ponte só aceita origens
`https`. Em desenvolvimento, `bridge/tls.mjs` gera em `~/.apolo/tls` um certificado
próprio, `CA:FALSE`, válido só para localhost e loopback. Um certificado que não pode
assinar outros é mais seguro de confiar que uma autoridade local. `npm run https` o
marca como confiável e faz o Tailscale falar HTTPS com o gateway
(`https+insecure://`, por ser loopback). Num servidor, `APOLO_TLS_CERT` e
`APOLO_TLS_KEY` apontam para um certificado real.

## Consequências
- `npm run https` é obrigatório uma vez, com confirmação do macOS, antes de o navegador
  conectar à ponte. O `npm start` avisa se faltar.
- `http://localhost:5173` deixa de existir; o endereço é `https://localhost:5173`.
- Certificado renovado (825 dias) precisa de novo `npm run https`.
- A escolha de quase branco para "respondendo" é provisória: o verde passou a ser de
  "ouvindo". As cores dos painéis decorativos (`.panel-*`) não mudaram.
