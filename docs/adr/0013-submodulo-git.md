# ADR 0013 — Sub-módulo git: commit e pull request do próprio código

- **Status:** proposta
- **Data:** 2026-11-05

## Contexto
O RF-17 pede que o A.P.O.L.O. faça commits e gere pull requests para a própria
`main`, passando pelo gate de permissões, com o merge continuando sob revisão do
Ricardo.

Parte disso já existe, mas por dentro: o autodesenvolvimento (ADR 0011) commita
o trabalho do agente numa branch `autodev/<id>` como etapa do seu ciclo, para
poder trocar a versão no ar e voltar atrás. Aquilo não é um sub-módulo git — é um
detalhe do rollback. O que falta é o gesto pedido aqui: a pessoa fala, e o
A.P.O.L.O. guarda o trabalho pendente da cópia em execução e pede revisão.

Faltava também responder o que o registro de ADRs deixou em aberto: onde mora a
credencial do GitHub, e como isso convive com o item 7 da ADR 0011 ("a `main` não
muda").

## Decisão
1. **Um servidor MCP na ponte, `bridge/git.mjs`, com quatro ferramentas.**
   `git_status` e `git_diff` leem; `git_commit` e `git_pull_request` agem. Enquanto
   o core não existe, ele fica em `bridge/` junto com os outros servidores em
   processo (`navegador.mjs`, `chrome.mjs`); quando o host de módulos existir
   (Fase 1), vira o módulo `git` com manifesto, sem mudança de contrato.
2. **O gate pelo mesmo caminho do navegador: construção.** `gitServer()` só cria
   `git_commit` e `git_pull_request` quando `JARVIS_ALLOW_WRITES=1`
   (`npm start -- --writes`). Sem isso as ferramentas não existem e não há o que
   pedir; ler o estado do repositório continua liberado, porque ler não muda nada.
   Decidir pelo nome, como o gate faz com os servidores MCP de terceiros, erraria
   nas duas pontas: `git_status` não começa com verbo de leitura e `git_commit`
   não contém nenhum verbo da lista de efeito.
3. **Dois gestos, e só dois.** Commitar numa branch e abrir pull request. Não
   existe merge, não existe push na `main`, não existe `--force`, não existe
   rebase nem `reset --hard` — não como regra de persona, mas como ausência de
   código. Um teste confere essa ausência, porque é a parte do requisito que
   protege o Ricardo de si mesmo num dia distraído.
4. **Nada é commitado na `main`.** Se a cópia em execução estiver nela (ou com a
   HEAD destacada), o commit é recusado até que uma branch nova seja nomeada. A
   branch tem de ser **nova**: trocar para uma que já existe mudaria os arquivos
   debaixo do processo que está no ar. Criar uma a partir do commit atual só move
   uma referência, e o disco fica igual.
5. **A conferência de segredos é a mesma do autodesenvolvimento.** O commit
   estaciona tudo, chama `classificar()` de `bridge/autodev/politica.mjs` e, se
   aparecer um proibido (`.env*`, chave, certificado), desfaz o índice e descarta
   o commit inteiro. Um segredo que entra no histórico continua lá depois de
   apagado. Arquivos sensíveis não bloqueiam — eles são relatados, e a revisão do
   pull request é justamente onde eles param.
6. **A credencial do GitHub não é do projeto.** A ponte não lê, não guarda e não
   registra nenhum token: ela invoca `git push` e `gh pr create`, que se
   autenticam sozinhos pelo chaveiro do macOS e pela configuração do `gh` em
   `~/.config`. Essa pasta já está na lista de leituras negadas ao agente do
   autodesenvolvimento (`politica.mjs`), então o agente que escreve código não
   alcança a credencial de quem envia. Sem `origin` ou sem `gh`, a resposta diz o
   que falta em uma frase; a branch fica pronta localmente de todo jeito.
7. **Convive com o item 7 da ADR 0011 porque não o contraria.** A `main` continua
   só recebendo pull request. O que muda é quem pode abrir o pull request: antes,
   só o Ricardo à mão; agora, também o A.P.O.L.O., a pedido dele e com a escrita
   liberada. O autodesenvolvimento não ganha nada com isso — o agente que escreve
   o código roda num sandbox sem rede e sem estas ferramentas, e continua parando
   na branch.
8. **`bridge/git.mjs` é sensível.** Entrou na lista de `politica.mjs`: quem pode
   editar o que commita e envia código pode mudar o que vai para a `main`. Então
   uma alteração do próprio autodesenvolvimento neste arquivo para na branch,
   sem rodar, à espera de revisão.
9. **Nada escreve durante uma troca de versão.** Commitar ou criar branch
   enquanto o supervisor compara shas mexeria no repositório debaixo dele, então
   as duas ferramentas de escrita são recusadas enquanto o autodesenvolvimento
   está trabalhando, verificando ou aplicando.

## Consequências
- O ciclo fecha por voz: "o que está pendente no código?", "commite isso na
  branch tal", "abra o pull request". O merge continua sendo um clique do
  Ricardo, no GitHub.
- As branches `autodev/*` que um trabalho deixou para trás passam a ter saída:
  `git_pull_request` aceita o nome delas e as propõe para revisão.
- O `gh` não está validado aqui: o ambiente de agente não tem rede nem como
  instalar nada, e o push de verdade só acontece na máquina do Ricardo. O que foi
  testado offline é tudo o que não depende de rede, inclusive um push para um
  repositório `--bare` em disco (`npm run test:git`).
- `bridge/server.mjs` mudou (registro do servidor, gate e persona) e é sensível:
  esta alteração não entra no ar sozinha, fica para revisão (ADR 0011, item 4).
- Um dia a ponte roda em servidor, e aí o repositório do A.P.O.L.O. não é mais o
  diretório de quem fala com ele. O caminho do repositório já vem por parâmetro
  (`REPO`), que é o que essa mudança vai precisar.
