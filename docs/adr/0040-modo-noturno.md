# ADR 0040 — O modo noturno

- **Status:** aceita
- **Data:** 2026-11-27

## Contexto

O autodesenvolvimento (ADR 0011, 0015 e 0031) faz uma alteração por vez e pede o
Ricardo em cada passo: o sim para começar, o teste na tela e a aprovação. Isso
segura a qualidade, mas prende o trabalho ao horário em que ele está acordado.
Desde 25/11/2026 ele quer que o A.P.O.L.O. trabalhe sozinho à noite: vários itens
numa branch só, e de manhã um relatório e um pull request para revisar.

Tirar as confirmações é uma decisão de segurança, por isso esta ADR. O desenho
saiu de um brainstorming com o Ricardo, em 27/11/2026. As escolhas dele:

- **Encomenda pela voz, com o backlog.** Ele dita os itens ou dá números de
  "Pendências em etapas" (`1.3`). O A.P.O.L.O. repete o plano e os limites, e um
  "confirmo" conferido na transcrição do microfone autoriza a noite inteira.
- **Ao ar, item por item.** Cada item sobe pela Fênix e é observado. Se ficar de
  pé, é aprovado sozinho. Ele prefere acordar com a última versão boa já no ar.
- **Arquivos sensíveis: faz e marca.** Um item pode mexer num arquivo sensível. O
  relatório e o PR destacam o que foi tocado.
- **De manhã: envia e abre PR rascunho.** A branch vai ao GitHub com um pull
  request em rascunho. O merge continua sendo só dele.

## Decisão

**O nome.** "Modo noturno" (a voz também aceita "modo autônomo"), sem nome
próprio, a pedido do Ricardo: não é um sistema plugável (ADR 0018), e sim um modo
do autodesenvolvimento.

**Começo.** Pela ferramenta `desenvolvimento`, com a ação `noite`, a voz recebe a
lista de itens e o modo de acompanhar:

- **"vou dormir":** a voz fica muda a noite toda. As frases da troca de branch
  (ADR 0038) e os avisos do H.E.R.M.E.S. (ADR 0039) vão só para o `eventos.log` e
  para o relatório da manhã. Só um alerta grave (a âncora acionada, ADR 0041)
  chega ao iPhone na hora.
- **"eu fico":** a mesma autonomia, mas a voz conta cada passo, como numa troca de
  branch. Dá para mudar no meio da noite ("pode falar", "silêncio").

O modo noturno não começa com a âncora no ar (ADR 0041): se houve um pânico, a
noite não começa em cima dele. Também exige `--writes` (o envio e o PR da manhã),
`--autodev` e a Fênix conectada.

O A.P.O.L.O. lê o plano em voz alta: os itens, a hora de parar e os limites. Só o
"confirmo" ouvido no microfone (`ouviuConfirmacao`) começa a noite. O que o modelo
diz não conta, como na troca de branch e no autodev.

**A branch da noite.** Ela parte da versão no ar, como na ADR 0031: a própria
branch de fase, ou uma `fase-x.y/<nome>` nova se a partida for a `main`. Cada item
é um commit dela.

**Cada item, em ordem:**

1. O agente trabalha na worktree do autodev (`~/.apolo/autodev`), com o mesmo
   pedido de `pedidoDaTarefa` e o mesmo teto de voltas (`APOLO_AUTODEV_TURNOS`, 80).
2. A conferência de hoje roda: lint, tipos, build e `npm test`.
3. A Fênix põe o item no ar e o observa por **3 minutos**, no lugar dos 30 s de
   hoje (`estabilidadeMs`). A ponte, a interface e a voz precisam responder.
4. De pé: o item vira um commit da branch da noite, que segue no ar. É a
   aprovação automática, no lugar do "aprovo" falado da ADR 0015.
5. Quebrou em qualquer passo: a Fênix volta ao último commit bom, o item é
   descartado inteiro com o motivo no relatório, e a noite segue para o próximo.
   Cada item tem até 3 tentativas.

**Alterações na Fênix.** Elas vão ao ar como as outras, porque a Fênix passa a
renascer no código novo, com a âncora como rede (ADR 0041).

**Limites, que o Ricardo pode mudar na encomenda:**

- parar às 6h30;
- no máximo 6 itens por noite;
- 3 tentativas por item;
- 80 voltas por tentativa.

O Mac fica acordado com `caffeinate` só enquanto a noite durar.

**O que nunca muda de madrugada.** Mesmo com "faz e marca", alguns arquivos ficam
fora do alcance da noite. Um item que precise deles para de pé e vai ao relatório
como "precisa de você":

- o gate de permissões;
- `bridge/autodev/politica.mjs`;
- a proteção do `fenix.config.json`;
- a conferência do sim (`src/lib/autodev.ts`, `src/lib/trocaDeVersao.ts`);
- esta ADR e a 0041;
- o protocolo Â.N.C.O.R.A.

Uma noite não pode afrouxar as próprias travas.

**Quando a noite para.** Ela para na hora marcada, nos limites, ou se a ponte cair
3 vezes em 5 minutos. Neste último caso, a volta à `main` da ADR 0038 continua
valendo, e a noite guarda o que já estava bom sem insistir. Também para pelo
"parar a noite" falado, pelo terminal (`npm run noite -- parar`) ou pela âncora
(ADR 0041).

**De manhã:**

- Uma conferência completa da branch.
- `git push` da branch da noite e um PR em rascunho para a `main`.
  - Não pede `--writes` falado de novo: o "confirmo" do começo valeu para isso.
  - A noite só começa com `--writes`.
- O corpo do PR é o relatório da noite:
  - o que entrou;
  - o que foi descartado e por quê;
  - os arquivos sensíveis tocados, em destaque;
  - o tempo de cada item.
- O bom dia (ADR 0026) narra o relatório em três frases, e o H.E.R.M.E.S. o avisa
  no iPhone ao terminar.

Se ele não gostar do que encontrar no ar, basta dizer "volta para a main".

## Consequências

- O Ricardo acorda com código que ninguém revisou no ar. A observação de 3
  minutos, a âncora e o PR em rascunho são o que torna isso aceitável. A revisão
  humana continua obrigatória antes da `main`.
- O custo de uma noite é de até 6 itens × 3 tentativas × 80 voltas do agente. O
  relatório mostra quanto foi usado.
- `bridge/autodev/` ganha a fila da noite e a aprovação automática. A Fênix ganha
  um prazo de observação por troca. A voz ganha `desenvolvimento` com a ação
  `noite`, e as teclas e comandos ganham as linhas novas (ADR 0023).
- Testes: a fila (item bom, item que quebra, limite de tentativas, hora de parar),
  a trava dos arquivos que nunca mudam de madrugada, o silêncio no "vou dormir" e o
  relatório. O ciclo real entra em `test:autodev:e2e`.
