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
- **Rotinas.** As do config (sem shell, parâmetros por formato) e três próprias:
  `reiniciar`, `atualizar` (pull, reinstala se preciso, sobe, volta se quebrar) e
  `diagnostico`.
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

Pedido com `id` recebe `{ type: '<pedido>:resposta', resposta: id, ... }`. Avisos:
`versao:resultado` (`tipo`: `em_teste`, `aprovado`, `revertido`, `recusado`,
`falhou`, com `versao` junto) e `estado` (a cada mudança de serviço; o primeiro de
cada conexão traz `inicial: true`). Aviso sem ninguém conectado espera o próximo.

## O config

Toda string aceita `${VAR}` e `${VAR:-padrão}`; caminho com `~/` vai para a pasta
do usuário; os `arquivosDeAmbiente` valem para as variáveis e para os serviços.

| Campo | Para quê |
|---|---|
| `repositorio`, `versaoSegura`, `pasta` | onde está o projeto, a branch segura, onde guardar o estado |
| `escuta`, `tls` | host e porta do canal (`FENIX_HOST`, `FENIX_PORTA`), certificado |
| `preparar` | comandos antes dos serviços |
| `servicos[]` | `nome`, `comando`, `portas`, `ambiente`, `opcional`, `versionado`, `saude { urls, ca, clientes, prazoMs }` |
| `flags` | opções aceitas na linha de comando: `ambiente` para os serviços, `comandosLivres` |
| `protecao` | `revisao` (padrões que barram a troca), `liberados`, `invariantes`, `branch` |
| `instalar` | comando de dependências e quando rodar numa atualização |
| `rotinas[]` | `nome`, `descricao`, `comando`, `parametros { formato, descricao, padrao }`, `prazoMs` |
| `comandos` | `prazoMs` e `validadeMs` dos comandos livres |
