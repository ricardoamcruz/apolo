# Â.N.C.O.R.A. — Agora Nós Conheceremos O Retrocesso Automático

O pânico do A.P.O.L.O. (docs/adr/0041). Desliga tudo, guarda o que estava sem
commit numa branch `panico/<data-hora>`, põe no ar a versão de segurança (a
âncora) e confere que tudo subiu. Não importa nada do projeto: roda mesmo com o
repositório, a Fênix e a `main` quebrados.

## A palavra-senha: como funciona

Qualquer pessoa que souber o nome do tópico pode publicar nele, porque o ntfy.sh é
público. A palavra-senha garante que só o seu iPhone consegue acionar a âncora por
lá.

- **Ela é sua e nova.** Você a inventa na instalação, com pelo menos 8 caracteres.
  Ela não é a senha do Mac e não deve ser uma senha que você usa em outro lugar.
- **Ela fica guardada em só dois lugares:**
  - no Mac, em `/usr/local/ancora/ancora.conf`, que só o root altera;
  - dentro do Atalho, no seu iPhone.
- **Ela nunca passa pela internet.** A cada minuto, o Atalho junta a palavra com a
  hora e calcula um código, que é um hash SHA-256 dos dois. O Atalho manda só o
  código.
- **O vigia confere o código.** O vigia é um programa no Mac que escuta o tópico. Ele
  faz a mesma conta com a palavra guardada e só aciona o pânico se o código bater.

```
iPhone:  SHA256("minhapalavra:202611272315")  →  "9f2c…e41a"  →  ntfy  →  Mac
Mac:     SHA256("minhapalavra:202611272315")  =  "9f2c…e41a" ?  →  pânico
```

**Por que alguém que lê o tópico não consegue repetir o pedido:**
- o código vale só por uns minutos: o minuto atual, os dois anteriores e o seguinte,
  porque os relógios do iPhone e do Mac nunca batem certinho;
- cada código só é aceito uma vez;
- o vigia aceita no máximo um pânico a cada 10 minutos;
- um código errado avisa você, no máximo uma vez por hora, e não faz nada.

**No Mac, o seu usuário consegue ler a palavra.** O vigia roda como você e precisa
dela. Isso não abre brecha: no Mac, quem já é você pode rodar `ancora` direto. A
palavra protege só o caminho pela internet.

**Para trocar a palavra,** rode a instalação de novo (passo 3 abaixo). As âncoras
congeladas continuam; só a palavra muda. Depois, atualize o texto no Atalho.

## Instalar (uma vez, depois do merge)

1. **Pegue a `main` com o merge:**
   ```bash
   cd ~/Projetos/apolo
   git switch main && git pull
   ```
2. **Confira o `.env.local`.** Ele precisa ter `APOLO_NTFY_TOPICO`, o mesmo tópico
   dos avisos. A âncora escuta `<esse tópico>-ancora`. Sem ele, o Atalho do iPhone
   não aciona nada; o resto funciona.
3. **Rode o instalador.** Dê dois cliques em `scripts/ancora/instalar.command` ou
   rode:
   ```bash
   bash scripts/ancora/instalar.command
   ```
   Ele confere antes de mudar qualquer coisa: o Node, se você está na `main` e se
   ela está igual à do GitHub. Se algo não bater, ele para e diz o que fazer.
   Depois, pede duas coisas:
   - **a senha do Mac** (sudo), porque a âncora fica com o root e nenhum programa
     seu consegue mudá-la;
   - **a palavra-senha do Atalho**, nova, como explicado acima. Anote-a, porque você
     vai precisar dela no passo 4.

   Em seguida, ele congela a âncora 1 a partir da `main` do GitHub, o que leva
   alguns minutos (clone, `npm ci` e o manifesto), e mostra `ancora --estado`.

   Se o macOS perguntar se o Terminal pode acessar a Mesa (Área de Trabalho),
   permita. É lá que fica o `Âncora.command`.
4. **Crie o Atalho do iPhone** (próxima seção) e confira o código.

O que fica instalado, tudo do `root`:

| Onde | O quê |
|---|---|
| `/usr/local/bin/ancora` | o comando |
| `/usr/local/ancora/bin/ancora.mjs` | o programa (este arquivo, na versão da âncora) |
| `/usr/local/ancora/ancora.conf` | portas, saúde dos serviços, tópico do ntfy, palavra-senha |
| `/usr/local/ancora/<N>/` | a âncora congelada, com `ANCORA.json` e `MANIFESTO` |
| `/Library/LaunchAgents/com.apolo.ancora.vigia.plist` | o vigia do iPhone (sobe sozinho a cada login) |
| `~/Desktop/Âncora.command` | dois cliques para o pânico |

O que é seu, em `~/.apolo/ancora/`:
- `registro.log` e `vigia.log`;
- `no-ar.json`;
- a cópia ativa (`ativa/`);
- o arquivo do que o pânico guardou (`arquivo/`).

## O Atalho do iPhone

No app **Atalhos**, toque em **+**, dê o nome **Âncora** e adicione estas ações,
nesta ordem:

| # | Ação | Como preencher |
|---|---|---|
| 1 | **Data Atual** | nada a mudar |
| 2 | **Formatar Data** | Formato da Data: **Personalizado**; Formato: `yyyyMMddHHmm`. O `HH` é maiúsculo, para as 24 horas. |
| 3 | **Texto** | a sua palavra-senha, depois `:`, depois a variável **Data Formatada**, tudo sem espaços. Exemplo: `minhapalavra:`**Data Formatada** |
| 4 | **Gerar Hash** | Tipo: **SHA256**; entrada: o **Texto** do passo 3 |
| 5 | **Obter Conteúdo do URL** | URL: `https://ntfy.sh/<seu tópico>-ancora`, com o mesmo valor de `APOLO_NTFY_TOPICO` e `-ancora` no fim. Toque em **Mostrar Mais**: Método **POST**; Corpo da Solicitação **Arquivo**; Arquivo: a variável **Hash** |

Opcional, mas recomendado: ponha uma ação **Pedir Confirmação** antes do passo 5,
para um toque sem querer não acionar o pânico. Com o nome "Âncora", também dá para
pedir à Siri: "E aí Siri, Âncora".

**Confira antes de usar de verdade.** Assim você não aciona o pânico de teste:
1. No Atalho, desligue temporariamente o passo 5 (ou tire-o) e ponha uma ação
   **Mostrar Resultado** com a variável **Hash** no lugar.
2. Rode o Atalho e, no mesmo minuto, rode `ancora --testar-atalho` no Mac.
3. Os dois códigos têm de ser iguais. Se forem, volte o passo 5 e tire o
   **Mostrar Resultado**.

**Se os códigos não baterem,** o problema costuma ser um destes:
- espaço sobrando no **Texto**;
- `hh` minúsculo no formato;
- o fuso do iPhone diferente do fuso do Mac;
- a palavra digitada diferente da que você deu na instalação. Nesse caso, reinstale
  com a palavra certa.

## Usar

```bash
ancora                  # o pânico
ancora --estado         # qual âncora está instalada e se está no ar
ancora --sair           # desliga a âncora e sobe a main do repositório
ancora --testar-atalho  # o código que o Atalho do iPhone deve mandar agora
ancora --ajuda          # estes comandos
```

Os comandos também valem sem `--`, como `ancora estado`. Um argumento que o
programa não conhece é recusado e nada acontece: só `ancora` sozinho aciona o
pânico.

Antes de desligar qualquer coisa, o pânico confere a âncora. Se nenhuma conferir,
ele não desliga nada e diz por quê. Por exemplo: "não consigo ler a âncora 2
(permissão)", com o comando que conserta.

Também dá para acionar:
- pela voz, no PC e no app do iPhone: "protocolo âncora", e o sim conferido no
  microfone;
- com dois cliques em `Âncora.command`, na Mesa;
- pelo Atalho do iPhone.

Tudo vai para `~/.apolo/ancora/registro.log`.

## Atualizar a âncora

Mudar `scripts/ancora/` no repositório não muda o que está instalado. Só este
comando troca a âncora e o próprio programa pelos daquele commit:

```bash
sudo ancora --atualizar main        # ou um commit que já esteja na main do GitHub
```

A anterior fica de reserva, para o caso de a nova estar adulterada. O bom dia lembra
quando a âncora passa de 30 dias.

## Testes

`npm run test:ancora` roda o pânico inteiro numa pasta temporária, sem `root` e
sem tocar no A.P.O.L.O. que está no ar.
