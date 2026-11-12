# F.Ê.N.I.X.

**Fiadora da Estabilidade, do Nascimento, da Integridade e da eXecução.**

Guardiã de um projeto: sobe os serviços dele, mantém todos vivos, troca de versão
com rollback automático e roda rotinas e scripts na máquina. Nasceu para o
A.P.O.L.O., mas não importa nada dele: tudo o que ela sabe do projeto está no
`fenix.config.json`. Depende só do Node (≥ 20) e do `ws`. Decisão e contexto em
`docs/adr/0025-fenix-hermes-servicos-independentes.md`.

```bash
node fenix/fenix.mjs [--config fenix.config.json] [opções do projeto]
node fenix/fenix.mjs rollback [--config fenix.config.json]
npm test   # dentro desta pasta: node --test test/
```

## O que ela faz

- **Guarda.** Serviço que cai volta sozinho (1 s, 2 s, 5 s... até 1 min; zera
  depois de 2 min de pé). Serviço com `saude` que trava (3 checagens sem resposta)
  é derrubado e sobe de novo. Opcional que sai com código 0 não é queda.
- **Versões.** `versao:aplicar` troca para um commit, observa e deixa em teste;
  `versao:aprovar` guarda numa branch e volta à versão segura; `versao:reverter`
  descarta. Queda, saúde falhando ou partida sem aprovação voltam à versão segura.
  Toda troca confere antes a cópia (pasta, operação do Git pela metade,
  `index.lock`, alterações e não rastreados que o alvo sobrescreveria) e, no fim,
  que HEAD está na branch e no commit pedidos (docs/adr/0029). O Git roda com
  prazo e sem pedir senha; a falha chega em uma linha, com o motivo.
- **Rotinas.** As do config (sem shell, parâmetros por formato) e três próprias:
  `reiniciar`, `atualizar` (`fetch` do remoto da versão segura, `merge --ff-only`
  conferido, reinstala se preciso, sobe, volta ao commit de antes se quebrar; local
  à frente ou divergente é recusado) e `diagnostico`.
- **Independentes.** Serviço com `"independente": true` sobrevive à Fênix: se ela
  morre e volta, encontra a cópia de pé (mesmo programa, mesma pasta, saúde
  respondendo) e a adota, sem derrubá-la; se a adotada some ou trava, sobe outra.
  Ctrl-C encerra todos, adotados também.
- **Renascimento.** A quem sobe, ela passa `FENIX_PID` e `FENIX_RENASCER`: como subi-la
  de novo, com as mesmas opções. O projeto pode usar isso para revivê-la se ela morrer
  (no A.P.O.L.O., `bridge/renascer.mjs`; docs/adr/0028). Renascida (`FENIX_RENASCIDA=1`),
  ela registra em `eventos.log`, avisa e escreve a saída em `fenix.log`.
- **Prazos.** `tempos.servicos` (`esperasMs`, `estavelMs`, `intervaloMs`, `subidaMs`),
  `tempos.versoes` (`subidaMs`, `estabilidadeMs`, `intervaloMs`, `vigiaMs`) e
  `tempos.rotinas.avisoMs` (a partir de quando uma rotina avisa ao terminar; 1 min) no config.
- **Avisos.** Só frases para gente: nada de exceção, código ou saída de comando. A saída
  de cada rotina fica em `<pasta>/rotinas/<nome>.log`; no aviso de falha vai a última
  linha da saída que começa com "✖" (a explicação que a rotina deixou) ou uma frase
  genérica, e `textoDoAviso` descarta o que parecer rastro de erro.
- **Comandos livres.** Script bash vira proposta; só roda confirmado, no prazo, com
  o texto exato, se uma opção com `comandosLivres` estiver ligada, e nunca com
  uma versão sem revisão no ar.

## O canal

WebSocket em `/fenix`, com `Authorization: Bearer <token>`. O token vem de
`FENIX_TOKEN` ou fica em `<pasta>/token` (0600); a Fênix passa `FENIX_URL` e
`FENIX_TOKEN` a cada serviço que sobe. Com `tls` no config, só WSS.

| Pedido (`type`) | Campos | Resposta |
|---|---|---|
| `estado` | — | serviços, versão, rotinas, propostas |
| `rotina` | `nome`, `parametros` | `ok`, `codigo`, `saida`, `mensagem` |
| `comando:propor` | `script`, `motivo` | `ok`, `proposta { id, script, motivo, expiraEm }` |
| `comando:confirmar` | `proposta` (id) | como `rotina` |
| `comando:cancelar` | `proposta` (id) | `ok` |
| `versao:aplicar` | `id`, `sha`, `branch`, `interfaces` | depois, aviso `versao:resultado` |
| `versao:aprovar` | `id`, `branch` | depois, aviso `versao:resultado` |
| `versao:reverter` | `id` | depois, aviso `versao:resultado` |
| `avisar` | `titulo`, `texto`, `prioridade` | `ok`, `mensagem`, `entrega` (o que a central respondeu) |

Pedido com `id` recebe `{ type: '<pedido>:resposta', resposta: id, ... }`. Avisos:
`versao:resultado` (`tipo`: `em_teste`, `aprovado`, `revertido`, `recusado`,
`falhou`, com `versao` junto) e `estado` (a cada mudança de serviço; o primeiro de
cada conexão traz `inicial: true`). Aviso sem ninguém conectado espera o próximo.
Um cliente com o cabeçalho `x-fenix-cliente: avulso` (a linha de comando) só faz
os próprios pedidos: não recebe a fila nem os avisos.

Da linha de comando, com a Fênix no ar: `node fenix/fenix.mjs rotina atualizar`
e `node fenix/fenix.mjs avisar "título" "texto" [--alta]`. Saem com 0 quando deu
certo e com 1, e o motivo, quando não.

## O config

Toda string aceita `${VAR}` e `${VAR:-padrão}`; caminho com `~/` vai para a pasta
do usuário; os `arquivosDeAmbiente` valem para as variáveis e para os serviços.

| Campo | Para quê |
|---|---|
| `repositorio`, `versaoSegura`, `pasta` | onde está o projeto, a branch segura, onde guardar o estado |
| `escuta`, `tls` | host e porta do canal (`FENIX_HOST`, `FENIX_PORTA`), certificado |
| `preparar` | comandos antes dos serviços |
| `servicos[]` | `nome`, `comando`, `portas`, `ambiente`, `opcional`, `versionado`, `independente`, `saude { urls, ca, clientes, prazoMs }` |
| `flags` | opções aceitas na linha de comando: `ambiente` para os serviços, `comandosLivres` |
| `protecao` | `revisao` (padrões que barram a troca), `liberados`, `invariantes`, `branch` |
| `instalar` | comando de dependências e quando rodar numa atualização |
| `rotinas[]` | `nome`, `descricao`, `comando`, `parametros { formato, descricao, padrao }`, `prazoMs` |
| `comandos` | `prazoMs` e `validadeMs` dos comandos livres |
