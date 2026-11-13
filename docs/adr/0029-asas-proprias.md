# ADR 0029 — Asas próprias: troca de versão conferida e serviços que não caem com a Fênix

- **Status:** proposta
- **Data:** 2026-11-12

## Contexto

O relatório de bugs de 12/11/2026 (Ricardo Cruz) trouxe dois problemas ligados.

**Bug 1 — a rotina de atualização e a troca de branch da F.Ê.N.I.X.** O que se
via: a rotina era disparada e a cópia não mudava, ou mudava pela metade, sem
aviso claro. As causas encontradas em `fenix/src/versoes.mjs`:

- qualquer arquivo não rastreado (o `.claude/settings.local.json` do Claude
  Code, por exemplo) contava como "alteração não commitada" e barrava toda troca
  e toda atualização, sem dizer qual arquivo;
- o Git rodava sem prazo e podendo perguntar senha no terminal: um `git pull`
  preso deixava a Fênix "ocupada" para sempre, e toda rotina seguinte respondia
  "há uma troca em andamento";
- `git pull` dependia da upstream configurada e misturava busca e merge; um
  remoto inexistente, uma branch sumida ou uma `main` divergente viravam o
  "Command failed" do Node, com a saída inteira;
- se a reinstalação ou o `git reset` falhassem depois de desligar a ponte, os
  serviços ficavam desligados;
- ninguém conferia, depois da troca, se HEAD estava mesmo na branch e no commit
  pedidos; uma troca falha cujo rollback também falhava chegava como "voltei à
  versão segura";
- merge ou rebase pela metade, `index.lock`, submódulos e a pasta errada no
  `fenix.config.json` não eram verificados.

**Bug 2 — o H.E.R.M.E.S. e a A.U.R.O.R.A. dependiam da Fênix.** Nenhum importa
código dela (ADR 0025 já cobrava isso), mas o acoplamento estava em outros
lugares:

- *configuração*: certificado, portas e o endereço da ponte só existiam no
  `fenix.config.json`; `npm run hermes` nem lia o `.env.local` e saía com "nada
  a fazer"; a Aurora sozinha subia sem TLS e a ponte não a alcançava;
- *ciclo de vida*: os dois eram filhos da Fênix e liam a saída por um cano.
  Se ela morria, o cano quebrava (EPIPE) e, quando voltava, `liberarPortas`
  derrubava as cópias que tinham sobrevivido;
- *estado*: a ponte só sabia deles pelo relato da Fênix. Com ela fora do ar,
  os dois sumiam da aba SISTEMAS (`canais.hermes = canais.aurora = null`).

Não há dependência circular: a Fênix é cliente do H.E.R.M.E.S. (notificações), e
a ponte é cliente da Aurora e da Fênix.

## Decisão

**Bug 1.** Toda troca (aplicar, voltar, recuperar, rollback manual) e toda
atualização passam por `conferirCopia`, que devolve o motivo exato ou nada:
repositório e pasta certos, nenhuma operação do Git pela metade, nenhum
`index.lock`, nenhuma alteração rastreada (com os nomes) e nenhum arquivo não
rastreado que o alvo sobrescreveria. Não rastreados que não colidem não barram
mais nada. O Git roda com prazo (30 s; 2 min para rede), `GIT_TERMINAL_PROMPT=0`
e erro em uma linha (`erroDoGit`). A atualização vira etapas em sequência:
`fetch` explícito do remoto da `main`, conferência de que dá para avançar sem
merge (local à frente ou divergente é recusado com o motivo), `merge --ff-only`
no commit buscado, submódulos, conferência de HEAD, reinstalação, subida e
observação. Qualquer falha depois de mexer volta ao commit de antes; nenhum
caminho deixa os serviços desligados. `trocarPara` confere a branch (e o commit,
ao aplicar) no fim, cria a branch local a partir do remoto quando só existe lá, e
diz quando não existe em lugar nenhum. Troca e rollback que falham juntos chegam
como `falhou`, com os dois motivos.

A linha de comando ganha `fenix rotina <nome>` (`npm run atualizar`) e `fenix
avisar <título> <texto>` (`npm run avisar`), que falam com a Fênix no ar pelo
canal e saem com 0 ou 1. São clientes avulsos: não levam os avisos guardados para
a ponte. `avisar` devolve o que a central de notificações respondeu.

**Bug 2.** O contrato entre os serviços é a rede: `GET /saude` em cada um (a
porta local de serviços do H.E.R.M.E.S., 8792, abre sempre para isso; a Aurora já
tinha) e os WSS com token que já existiam. Sobre isso:

- *padrões próprios*: cada um lê `APOLO_*` e cai em `~/.apolo/tls` quando o
  certificado existe; `npm run hermes` e `npm run aurora` leem o `.env.local`
  (`--env-file-if-exists`);
- *de pé sem quem os subiu* (`src/saidas.mjs` em cada módulo, sem código
  comum): cano quebrado ou pai trocado viram um registro em
  `~/.apolo/<módulo>/<módulo>.log`, com a linha dizendo o que houve;
- *adoção*: no `fenix.config.json`, `"independente": true`. A Fênix que volta
  encontra a cópia de pé (mesmo programa, mesma pasta, saúde respondendo) e a
  adota em vez de derrubá-la; se a adotada some ou trava, sobe uma nova. Ctrl-C
  continua encerrando tudo;
- *a ponte mede sozinha* (`bridge/sondas.mjs`): a saúde dos dois vale mais que o
  relato da Fênix, e continua valendo quando ela sai.

## Consequências

- Com a Fênix fora do ar, o celular, as notificações e o bom dia seguem; a aba
  SISTEMAS mostra a Fênix caída e os outros dois de pé. Sem a Fênix, ninguém
  levanta o H.E.R.M.E.S. ou a Aurora se *eles* caírem: isso continua sendo o
  trabalho dela, quando voltar.
- `hermes/test/independencia.test.mjs` e `modules/aurora/test/independencia.test.mjs`
  sobem cada um num ambiente sem nada da Fênix, matam o pai e cobram que nada
  dentro deles importe código de fora ou leia `FENIX_*`.
  `fenix/test/atualizar.test.mjs` e `fenix/test/adocao.test.mjs` cobrem o Bug 1
  e a adoção, com Git e processos de verdade.
- O `.claude/settings.local.json` entra no `.gitignore`.
- Ficam para depois: um contrato de saúde versionado (RNF-08) e o mesmo cuidado
  com a interface (Vite), que continua filha comum da Fênix.
