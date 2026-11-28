# ADR 0041 — Protocolo Â.N.C.O.R.A., e a Fênix que renasce no código novo

- **Status:** aceita
- **Data:** 2026-11-27
- **Revisa:** ADR 0028 (o pacto)

## Contexto

O pacto da ADR 0028 tem uma lacuna. Se a Fênix morre, a ponte a revive, mas com o
código que estiver no disco. Numa troca de branch com a Fênix viva, ela troca a
ponte, a interface e o H.E.R.M.E.S., mas continua rodando no código de quando
subiu: uma mudança em `fenix/` só vale depois de um reinício manual. E se o código
novo da Fênix for ruim, a ponte a revive três vezes com o mesmo código quebrado e
desiste.

O modo noturno (ADR 0040) põe no ar, de madrugada, código que ninguém revisou.
O Ricardo pediu, em 27/11/2026, uma saída que não dependa de nada que possa ter
quebrado: nem da Fênix, nem da `main`, nem do repositório. Ela deve fazer três
coisas:

1. desligar o A.P.O.L.O. e todo o ambiente;
2. voltar a uma versão de segurança fixa, que só ele pode mudar;
3. subir tudo de novo, do zero, conferindo que está como deveria.

O nome é dele: **Â.N.C.O.R.A.** — *Agora Nós Conheceremos O Retrocesso Automático*.

## Decisão

### A âncora

A versão de segurança é um commit escolhido pelo Ricardo, guardado de duas formas:

- **A tag `ancora-N` no Git**, para saber de onde ela veio.
- **Uma cópia congelada fora do repositório**, em `/usr/local/ancora/<N>/`. É um
  clone naquele commit, com as dependências já instaladas e um `MANIFESTO` com o
  SHA-256 de cada arquivo.
  - Ela roda mesmo se a `main`, a branch no ar ou o próprio `.git` estiverem
    estragados.
  - Pertence ao `root` e não aceita escrita de mais ninguém.

**A primeira âncora** é o primeiro commit da `main` depois do merge desta branch.
Assim, ela já inclui o próprio protocolo.

### "Só o Ricardo muda" — a garantia técnica

O A.P.O.L.O., o autodev, o modo noturno e qualquer agente rodam como o usuário do
Ricardo. Por isso, três coisas pertencem ao `root`:

- o script (`/usr/local/bin/ancora` e `/usr/local/ancora/bin/ancora.mjs`);
- as cópias congeladas;
- a configuração (`/usr/local/ancora/ancora.conf`).

Nenhum deles consegue alterá-los. Instalar e trocar a âncora pedem `sudo`, ou
seja, a senha dele:

```bash
sudo node scripts/ancora/ancora.mjs instalar   # uma vez (ou scripts/ancora/instalar.command)
sudo ancora --atualizar <commit>               # congela uma nova âncora
```

`--atualizar` faz cinco coisas:

1. confere que o commit está na `main` do GitHub;
2. clona e instala as dependências, como o usuário do Ricardo, numa pasta
   temporária;
3. passa a pasta para o `root`, legível por todos, e gera o manifesto;
4. troca o script instalado pelo daquele commit;
5. guarda a âncora anterior (`N-1`), para voltar a ela se a nova não conferir.

No repositório, `scripts/ancora/` é a fonte do que se instala, e é sensível
(`bridge/autodev/politica.mjs`) e uma das travas da noite (ADR 0040). Mudar o
arquivo do repositório não muda o que está instalado: só um novo `sudo` o faz.

### `ancora`, o pânico

O pânico não pergunta nada à Fênix nem à ponte. Pode ser justamente uma delas que
quebrou.

0. **Conferir a âncora antes de tudo** (revisão de 27/11/2026, depois do primeiro
   pânico real). O script lê a âncora atual e, se ela não conferir, a anterior. Sem
   nenhuma que confira, ele **não desliga nada**: sem para onde voltar, derrubar o
   que está no ar só deixaria o Mac sem A.P.O.L.O. Ele avisa e para. As pastas das
   âncoras são do `root`, mas legíveis por todos (`go+rX`), porque o pânico roda
   como o usuário. A linha de comando só aciona o pânico sem argumento, com
   `panico` ou só com `--origem`/`--motivo`; qualquer argumento desconhecido é
   recusado (`ancora estado`, sem `--`, chegou a acionar o pânico).
1. **Desligar tudo.**
   - Encerra o que escuta nas portas do A.P.O.L.O., os processos dos serviços
     (Fênix, ponte, interface, H.E.R.M.E.S., A.U.R.O.R.A.) que rodam das pastas do
     A.P.O.L.O. (o repositório, a cópia ativa da âncora) e tudo o que eles
     abriram (o agente do autodev, o `caffeinate` da noite).
   - Fecha o Chrome do perfil `~/.apolo/chrome`.
   - Primeiro pede com `SIGTERM`; depois de 5 s, força com `SIGKILL`.
   - Nunca mata outros programas que só estejam na pasta do repositório (o VS
     Code, um terminal).
2. **Guardar e limpar, sem apagar o trabalho.**
   - O que estava sem commit no repositório vai para uma branch
     `panico/<data-hora>`.
   - A worktree do autodev, a transição pela metade da Fênix, o teste e a noite em
     aberto são movidos para `~/.apolo/ancora/arquivo/<data-hora>/`.
   - Nada é apagado de vez.
3. **Subir da âncora, sempre** (decisão do Ricardo: num pânico não se sabe o que
   quebrou, e a `main` pode ser o problema).
   - A âncora usada é a que conferiu no passo 0.
   - **Modo repositório** (o normal): põe o repositório no commit da âncora
     (`git switch --detach <sha>`, pelo sha do manifesto, nunca pela tag, que
     alguém pode mover), confere que a cópia ficou limpa nesse commit e copia as
     dependências da cópia congelada. Sobe a Fênix do repositório, com as mesmas
     opções que ela tinha (`--writes`, `--autodev`).
   - **Modo cópia** (o repositório não está utilizável: Git quebrado, commit
     sumido, ou o modo repositório não ficou de pé): copia a âncora para
     `~/.apolo/ancora/ativa/`, com o `.env.local` do repositório, e sobe a Fênix
     de lá. A cópia congelada nunca roda direto, porque o Vite e a Fênix escrevem
     na pasta.
4. **Fresh start conferido.**
   - Confere a saúde de cada serviço e a interface conectada.
   - Mostra no terminal uma lista com ✔ ou ✖.
   - Avisa o iPhone e o Mac, direto pelo ntfy e pelo macOS, porque o H.E.R.M.E.S.
     pode estar desligado: "a âncora está no ar" ou "a âncora não subiu", sem
     detalhe técnico (ADR 0027). O detalhe fica em `~/.apolo/ancora/registro.log`.

### O modo âncora

Com a âncora no ar, o A.P.O.L.O. é um sistema completo, decisão do Ricardo:

- **Troca de versão:** pedir a `main` ou uma `fase-x.y` (voz, `npm run trocar`) é
  a troca de sempre, com a prévia e o sim (ADR 0038). Se a versão pedida não ficar
  de pé, a volta é para a âncora, que é a versão de onde a troca partiu.
- **Autodev:** parte do commit da âncora, como de qualquer versão no ar (ADR 0031).
- **Extensões:** carregam de `extensoes/`, como sempre (ADR 0033).
- **Modo noturno:** bloqueado enquanto a âncora estiver no ar. Se um pânico
  aconteceu, a noite não começa em cima dele.

No modo cópia não há repositório para trocar: a Fênix recusa troca, atualização e
autodev (`FENIX_VERSAO_FIXA=1`) e diz que é preciso consertar o repositório e
rodar `ancora --sair`. `ancora --sair` desliga tudo e faz um `npm start` normal
do repositório, na `main`.

A âncora fica marcada em `~/.apolo/ancora/no-ar.json` enquanto o commit no ar for
o dela.

### Como acionar

- **No terminal:** `ancora`.
- **Na Área de Trabalho:** dois cliques em `Âncora.command`.
- **Pela voz, no PC e no app do iPhone:** "protocolo âncora". A ferramenta `ancora`
  explica o que vai acontecer e pergunta; o sim é conferido na transcrição do
  microfone (do PC ou do celular), como na troca de branch (`src/lib/ancora.ts`).
  A ponte chama `ancora` e sai do caminho junto com todo o resto.
- **Pelo Atalho do iPhone, num canal que não passa pelo A.P.O.L.O.:**
  - Um vigia (`/Library/LaunchAgents`, do `root`, rodando como o usuário dele)
    escuta o tópico do ntfy `<tópico>-ancora`.
  - O tópico sozinho não basta, e a palavra-senha nunca passa pelo ntfy. O Atalho
    manda um código que vale um minuto: o SHA-256 de `<palavra>:<AAAAMMDDhhmm>`. A
    palavra fica em `ancora.conf`, que só o `root` altera. Um código já usado não
    vale de novo.
  - Uma vez a cada 10 minutos, no máximo. Cada pedido, aceito ou recusado, vai ao
    registro.
  - O vigia avisa no tópico do Ricardo quando começa, e o pânico, quando termina.

O pior que um tópico vazado faz, sem a palavra, é encher o registro. Com a palavra,
é pôr o sistema na versão segura, nada mais. Quem já roda como o usuário do
Ricardo pode chamar `ancora` direto: é o mesmo efeito, por isso não é uma ameaça
nova.

### A Fênix renasce de propósito (revisão do pacto)

- **Troca que muda o código da Fênix.** Depois de uma troca, aprovação ou
  atualização concluída que muda `fenix/` ou o `fenix.config.json`, ela derruba os
  serviços e o canal, sobe uma Fênix nova no código novo e espera até 2 minutos
  que ela responda com os serviços de pé.
  - De pé: a antiga sai.
  - Não ficou de pé: a antiga mata a nova e chama a âncora. Sem âncora instalada,
    a antiga retoma o posto, com o código dela, e avisa.
- **Fênix morta fora de uma troca.** O pacto de hoje segue valendo: a ponte a
  revive. Depois de 3 vezes em 10 minutos, chama a âncora em vez de só desistir.

O caminho da âncora vem do `fenix.config.json` (`ultimoRecurso`): a Fênix
continua sem saber nada do A.P.O.L.O. (ADR 0025), e a ponte o recebe na receita
do renascimento. Com isso, uma alteração em `fenix/` vai ao ar como as outras,
inclusive de madrugada.

## Consequências

- Existe um caminho de volta que não depende de nenhum código mutável. Ele é tão
  bom quanto a última âncora: o bom dia lembra quando ela passa de 30 dias.
- O `.env.local` é a única coisa que o modo cópia lê de fora da âncora. Se ele
  estiver ruim, a lista ✔/✖ mostra.
- Fica mais difícil: a instalação pede `sudo` uma vez, e cada âncora (mais a
  anterior) ocupa o tamanho do projeto com `node_modules`.
- Testes: `scripts/ancora.test.mjs` cobre o manifesto, a escolha do que matar, o
  guardar, os códigos do vigia e um pânico inteiro numa pasta temporária, sem
  `root`. `fenix/test/renovar.test.mjs` cobre a Fênix que renasce e a que não
  sobe, e `scripts/renascer.test.mjs`, a ponte que chama a âncora.
- Fica para depois: a âncora em outra máquina, ou como servidor.
