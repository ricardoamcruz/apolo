# ADR 0025 — F.Ê.N.I.X., H.E.R.M.E.S. e A.P.O.L.O. como serviços independentes

- **Status:** proposta
- **Data:** 2026-11-08

## Contexto

O Ricardo quer três peças que possam, no futuro, ir cada uma para o seu
repositório e rodar em máquinas diferentes:

- o **A.P.O.L.O.**: voz, interface e agente;
- a **F.Ê.N.I.X.**: a guardiã que mantém o A.P.O.L.O. no ar e cuida da máquina;
- o **H.E.R.M.E.S.**: o canal do celular (ADR 0019).

Até aqui, a guarda e a troca de versão moravam em `scripts/start.mjs` e
`scripts/supervisor.mjs`, falando com a ponte por IPC do Node, e o gateway do
celular era um módulo dentro da ponte (`bridge/gateway.mjs`). Se a ponte caísse
fora de uma troca de versão, o `npm start` desligava tudo. Nada disso sai da
máquina: IPC só existe entre pai e filho.

O pedido, nas palavras dele: "No fim do dia eu quero que o apolo consiga criar
novos códigos e pedir a fenix para subir ele novamente. Se algo quebrar a própria
fenix derruba e volta ele pra versão estável. Se eu pedir para rodar alguma ação
que precise de um script bash, a fenix irá cuidar disso. Atualizações, testes e
diagnósticos mais complexos também."

## Decisão

**Três pastas, nenhum import entre elas.** `fenix/` e `hermes/` têm `package.json`
próprio e dependem só do Node e do `ws`. Testes nas três cobram que ninguém
importa código do outro (`fenix/test`, `hermes/test`, `scripts/fenix.test.mjs`).
Separar em repositórios é mover a pasta.

**Eles conversam só pela rede**, por WebSocket com TLS e token `Bearer`, com o
mesmo formato: JSON com `type`; um pedido com `id` recebe a resposta com
`resposta: id`. Nada assume `localhost`: cada endereço vem de uma variável.

```
 iPhone ──WSS /canal──▶ H.E.R.M.E.S. ──WSS /hermes──▶ A.P.O.L.O. (ponte) ──WSS /fenix──▶ F.Ê.N.I.X.
        token do celular             token do H.E.R.M.E.S.             token da Fênix
```

### F.Ê.N.I.X. — Fiadora da Estabilidade, do Nascimento, da Integridade e da eXecução

`node fenix/fenix.mjs` (o `npm start`) lê o `fenix.config.json` do projeto. É a
única coisa que ela sabe do A.P.O.L.O.: que serviços subir (ponte, interface e
H.E.R.M.E.S.), como saber se estão de pé, o que exige revisão humana, as rotinas
e as opções de linha de comando (`--writes`, `--autodev`).

1. **Guardiã.** Um serviço que cai volta sozinho, com espera crescente (1 s a
   1 min); um que trava (três checagens de saúde sem resposta) é derrubado e sobe
   de novo. Antes, uma queda desligava tudo.
2. **Versões.** O antigo supervisor virou `fenix/src/versoes.mjs`, com as mesmas
   regras das ADRs 0011 e 0015: a ponte pede `versao:aplicar`, a Fênix confere de
   novo o que exige revisão, troca, observa e deixa em teste; uma queda, a saúde
   falhando ou um `npm start` sem aprovação voltam à `main`. As regras vêm do
   config, lido na partida; `scripts/fenix.test.mjs` cobra que batam com
   `bridge/autodev/politica.mjs`.
3. **Atualizar.** A rotina `atualizar` faz `git pull --ff-only` na `main`,
   reinstala as dependências se `package.json` mudou, sobe e observa; se a versão
   nova não ficar de pé, volta ao commit de antes.
4. **Rotinas.** Uma lista fixa no config, sem shell: testes, lint, build,
   conferir o ambiente, popups, instalar o app no iPhone, medições do celular,
   volume e mudo, além de `reiniciar`, `atualizar` e `diagnostico`, que são da
   própria Fênix. Parâmetro só entra se casar com o formato declarado.
5. **Comandos livres.** Um script bash qualquer nunca roda na hora. Vira uma
   proposta, que aparece na tela, e só roda com a confirmação do Ricardo, pela
   fala conferida na transcrição ou pelo botão, dentro de 5 minutos e com o texto
   exato proposto. Exige `--writes`, como todo efeito no mundo (regra 3 do
   AGENTS.md). Fica bloqueado enquanto houver uma versão sem revisão no ar, porque
   seria ela pedindo. Nenhuma variável com cara de segredo chega ao script.
   O registro (`~/.apolo/fenix/comandos.log`) guarda o script e o código de
   saída, não a saída.

O token da Fênix vem de `FENIX_TOKEN` ou é gerado em `~/.apolo/fenix/token`
(0600), e ela o passa, com `FENIX_URL`, aos serviços que sobe. Avisos que chegam
sem ninguém conectado esperam numa fila: o resultado de uma troca nasce
justamente com a ponte reiniciando.

### H.E.R.M.E.S. — Hub de Enlace Remoto Móvel, Escuta e Sincronia

`node hermes/hermes.mjs` guarda a porta do celular (8788, publicada pelo
Tailscale) e repassa cada conversa para a ponte em `/hermes`, quadro a quadro,
sem entendê-la. A mídia dos popups vai pelo mesmo caminho
(`/hermes/midia/...`). O que o celular pode pedir continua decidido na ponte
(`bridge/hermes.mjs`), e não no relé.

O token entre H.E.R.M.E.S. e ponte é `APOLO_HERMES_TOKEN`; sem ele, os dois lados
derivam o mesmo do token do celular, e o pareamento atual continua valendo sem
passo novo. O ping do app só tem resposta se a ponte estiver de pé.

### A.P.O.L.O.

A ponte é cliente da Fênix (`bridge/fenix.mjs`) quando recebe `FENIX_URL` e
`FENIX_TOKEN`. Sem eles (`npm run bridge`), roda sozinha, sem troca de versão nem
rotinas. A voz ganhou a ferramenta `fenix` (só no PC), e a tela, o cartão de
confirmação dos scripts (`src/ui/Fenix.tsx`). A aba SISTEMAS mostra F.Ê.N.I.X. e
H.E.R.M.E.S. como linhas próprias.

## Consequências

- O A.P.O.L.O. consegue pedir à Fênix para subir a versão nova, e quem derruba e
  volta é ela, de fora do processo que muda.
- Cada peça pode ir para outra máquina trocando endereços: `FENIX_URL`,
  `HERMES_APOLO_URL` e as portas. Em outra máquina, o certificado tem de valer
  para o nome usado (o local só vale para `localhost`); `FENIX_CA` e
  `HERMES_APOLO_CA` apontam a autoridade.
- `npm start` agora é a Fênix. `npm run rollback` é `fenix rollback`. A transição
  e os eventos mudaram para `~/.apolo/fenix/`.
- A Fênix não se atualiza sozinha: código novo em `fenix/` vale na próxima partida
  manual. É de propósito: quem vigia não muda por quem é vigiado. `fenix/`,
  `hermes/` e `fenix.config.json` são sensíveis.
- Fica mais difícil manter duas listas de proteção (política e config). O teste
  que as compara é o que impede que divirjam.
- Falta: validar o celular pelo relé no aparelho, um comando livre por voz e a
  rotina `app_iphone` no Mac; e decidir, quando houver segunda máquina, como
  distribuir certificados (Tailscale emite para o nome `*.ts.net`).
