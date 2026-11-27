# ADR 0041 — Protocolo Â.N.C.O.R.A., e a Fênix que renasce no código novo

- **Status:** proposta
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

O A.P.O.L.O., o autodev, o modo noturno e qualquer agente rodam como o usuário
do Ricardo. Por isso, três coisas pertencem ao `root`, com permissão `755`:

- o script (`/usr/local/bin/ancora`);
- a cópia congelada;
- a configuração (`/usr/local/ancora/ancora.conf`).

Nenhum deles consegue alterá-los. Instalar e trocar a âncora pedem `sudo`, ou
seja, a senha dele:

```bash
sudo scripts/ancora/instalar.command        # uma vez: instala o script e o vigia
sudo ancora --atualizar <commit>            # congela uma nova âncora
```

`--atualizar` faz quatro coisas:

1. confere que o commit está na `main` do GitHub;
2. clona e instala as dependências;
3. gera o manifesto;
4. guarda a âncora anterior (`N-1`), para voltar a ela se a nova falhar.

No repositório, `scripts/ancora/` é a fonte do que se instala, e é sensível
(`bridge/autodev/politica.mjs`). Mudar o arquivo do repositório não muda o que
está instalado: só um novo `sudo` o faz.

### `ancora`, o pânico

O pânico não pergunta nada à Fênix nem à ponte. Pode ser justamente uma delas que
quebrou.

1. **Desligar tudo.**
   - Encerra, pelas portas configuradas e pelos processos que rodam das pastas do
     A.P.O.L.O. (o repositório, `~/.apolo/autodev`, a cópia ativa da âncora): a
     Fênix, a ponte, a interface, o H.E.R.M.E.S., a A.U.R.O.R.A. e as extensões.
   - Fecha o Chrome do perfil `~/.apolo/chrome` e o `caffeinate` da noite.
   - Primeiro pede com `SIGTERM`; depois de 5 s, força com `SIGKILL`.
2. **Guardar e limpar, sem apagar o trabalho.**
   - O que estava sem commit no repositório vai para uma branch
     `panico/<data-hora>`.
   - A worktree do autodev, a transição pela metade da Fênix e o teste em aberto
     são arquivados em `~/.apolo/ancora/arquivo/<data-hora>/`.
   - Nada é apagado de vez.
3. **Subir da âncora, sempre.**
   - O script confere o manifesto da cópia congelada. Se não bater, usa a âncora
     anterior e diz isso.
   - Copia a âncora para `~/.apolo/ancora/ativa/`: a cópia congelada nunca roda
     direto, porque o Vite e a Fênix escrevem na pasta.
   - Sobe a Fênix de lá, em **modo âncora**: um sistema completo, com troca de
     versão, autodev e extensões (decisão do Ricardo). Só o modo noturno fica de
     fora enquanto a âncora estiver no ar.
4. **Fresh start conferido.**
   - Confere o `/saude` de cada serviço e a interface conectada.
   - Mostra no terminal uma lista com ✔ ou ✖.
   - Avisa o iPhone "a âncora está no ar" ou "a âncora não subiu", sem detalhe
     técnico (ADR 0027).

O pânico sempre leva à âncora, decisão do Ricardo: num pânico não se sabe o que
quebrou, e a `main` pode ser o problema.

**Trocar de versão a partir da âncora é sair dela.** A cópia ativa nunca muda de
branch: pedir a `main` ou uma `fase-x.y` (voz, `npm run trocar`, `ancora --sair`)
desliga a cópia da âncora e sobe a Fênix do repositório na versão pedida, com a
prévia e o sim de sempre (ADR 0038). Se essa versão não ficar de pé, a volta é
para a âncora, e não para a `main`.

**O autodev a partir da âncora** trabalha no repositório, numa worktree no commit
da âncora, como na ADR 0031. Pôr a alteração em teste é a mesma saída: a Fênix do
repositório sobe a branch de teste, e descartar ou quebrar volta à âncora.

**As extensões** (ADR 0033) carregam de `extensoes/` do repositório, como sempre.
Uma extensão quebrada já não derruba a ponte, porque ela não executa nada delas.

### Como acionar

- **No terminal:** `ancora`.
- **Na Área de Trabalho:** dois cliques em `Âncora.command`.
- **Pela voz:** "protocolo âncora", confirmado pela transcrição.
- **Pelo iPhone, num canal que não passa pelo A.P.O.L.O.:**
  - Um vigia (`launchd`, do `root`, instalado junto) escuta o tópico do ntfy
    `<tópico>-ancora`.
  - Ele só aciona com a palavra-senha do Ricardo. A palavra fica com hash em
    `ancora.conf`, e o tópico sozinho não basta.
  - Uma vez a cada 10 minutos, no máximo; cada pedido, aceito ou recusado, vai ao
    registro (`/usr/local/ancora/registro.log`).
  - Um Atalho do iPhone ("Âncora") manda a mensagem.
  - O vigia avisa no tópico do Ricardo quando começa e quando termina.
  - Ele fala direto com o ntfy, porque o H.E.R.M.E.S. pode estar desligado.

O pior que um tópico vazado faz, sem a palavra, é encher o registro. Com a palavra,
é pôr o sistema na versão segura, nada mais.

### A Fênix renasce de propósito (revisão do pacto)

- **Troca que muda `fenix/`.** A Fênix sobe uma Fênix nova no código novo,
  entrega a ela os serviços (que ela já adota, ADR 0029) e sai.
- **A nova não fica de pé.** Se ela não responder em 2 minutos, ou se cair 3 vezes
  em 10 minutos, a ponte não a revive mais com o código da branch: chama
  `ancora`.
- **Fênix morta fora de uma troca.** O pacto de hoje segue valendo: a ponte a
  revive, e depois de 3 vezes chama `ancora` em vez de só desistir.

Com isso, uma alteração em `fenix/` vai ao ar como as outras, inclusive de
madrugada.

## Consequências

- Existe um caminho de volta que não depende de nenhum código mutável. Ele é tão
  bom quanto a última âncora: atualizar a âncora de tempos em tempos é tarefa do
  Ricardo, e o bom dia pode lembrar quando ela ficar velha.
- **O `.env.local` é copiado do repositório para a cópia ativa a cada pânico.** É
  a única coisa que a âncora lê de fora dela. Se o `.env.local` estiver ruim, a
  lista ✔/✖ mostra.
- **Fica mais difícil:** a instalação pede `sudo` uma vez, e a cópia congelada
  ocupa o tamanho do projeto com `node_modules` (cada âncora mais a anterior).
- **Testes:**
  - `scripts/ancora.test.mjs` roda o pânico numa pasta temporária, sem `root`:
    desligar, guardar, manifesto que não bate, subir e a lista.
  - O vigia é testado com a palavra certa, a errada e o limite de 10 minutos.
  - `test:resiliencia` ganha a Fênix nova que não sobe e a ponte que chama a âncora.
- O que não está aqui fica para depois: outra máquina com a âncora, e a âncora
  como servidor (RNF de "servidor amanhã").
