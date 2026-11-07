# ADR 0022 — Ponto de extensão entre dispositivos

- **Status:** proposta
- **Data:** 2026-11-07

## Contexto
O Ricardo quer pedir ao A.P.O.L.O. que processe um comando em outro lugar: do celular
no servidor ou na web do PC, e vice-versa. A extensão será feita depois; agora só o
ponto em que ela vai se encaixar.

## Decisão
`bridge/extensoes.mjs` cria uma central que conhece os dispositivos conectados e leva
mensagens `{ type: 'extensao', extensao, dados }` à extensão registrada. Web
(`ouvirExtensao`, `enviarExtensao`) e app (`aoExtensao`, `enviarExtensao`) já falam
esse formato. Sem extensão registrada, tudo é descartado, e nenhuma está registrada.

Uma extensão recebe só `dispositivos()` e `enviar(destino, dados)`, com limite de
64 KB por mensagem. A central transporta, não autoriza: toda ação vinda de um
dispositivo passa pelo gate, como qualquer outra.

## Consequências
- A extensão se liga sem mudar o gateway nem os clientes.
- Ainda falta decidir como ela será carregada: pelo módulo MCP de `docs/03-modulos.md`
  ou por `central.registrar` na ponte.
- A extensão precisará definir confirmação no aparelho de origem, porque um comando
  remoto é a forma mais fácil de contornar quem está olhando a tela.
