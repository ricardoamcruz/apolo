# A.P.O.L.O. — guia para agentes de IA

> **A**ssistente **P**reditivo **O**peracional **L**ogístico e **O**timizado.
> Assistente pessoal do Ricardo, inspirado no JARVIS e na I.A. de *Horizon Zero Dawn*:
> um **core** pequeno e confiável que cresce por **módulos plugáveis**.

Este arquivo é lido automaticamente por Claude Code (via `CLAUDE.md`), Gemini CLI
(via `GEMINI.md`), GitHub Copilot e outros agentes. Ele é o ponto de entrada; o
detalhe está em `docs/`.

## Leia antes de qualquer tarefa

| Arquivo | Quando ler |
|---|---|
| `docs/00-visao.md` | Sempre, uma vez por sessão: o que é o A.P.O.L.O e seus princípios |
| `docs/01-requisitos.md` | Antes de implementar qualquer funcionalidade (IDs `RF-*`, `RNF-*`) |
| `docs/02-arquitetura.md` | Antes de mexer no core, em providers de IA, canais ou voz |
| `docs/03-modulos.md` | Antes de criar ou alterar um módulo plugável |
| `docs/04-base-jarvis.md` | Antes de alterar código herdado (`bridge/`, `src/`) |
| `docs/05-roadmap.md` | Para saber em que fase estamos e o que vem depois |
| `docs/06-ambiente-mobile.md` | Antes de mexer em `apps/mobile` ou no ambiente Xcode/Android |
| `docs/adr/` | Decisões tomadas (ADRs). Não contrarie uma ADR aceita sem criar outra |

## Estado atual

- **Fase 0 — Fundação: concluída** (02/11/2026), exceto o Android, adiado.
  Próxima: **Fase 1 — Core**. Ver `docs/05-roadmap.md`.
- **Pendências em etapas:** o que está aberto fica em "Pendências em etapas", no
  topo de `docs/05-roadmap.md` (08/11/2026): validar, Horizon, contexto e
  comunicação, o que está bloqueado e a Fase 1. Comece por lá.
- **Próxima versão:** 6 pontos do backlog têm prioridade sobre a ordem das fases
  (seção "Próxima versão" de `docs/05-roadmap.md`, RF-15 a RF-20). O primeiro,
  limpar a tela por voz (RF-16), está feito desde 03/11/2026.
- **Conversa contínua (ADR 0024):** o nome abre uma janela de 20 s
  (`src/lib/conversa.ts`), e só uma resposta ou tarefa a reabre. Ouvir alguém não
  reabre: não volte a zerar o prazo em `onSpeechStart`. No celular, em espera, a
  sessão fica muda (`silenciar`) até a frase trazer o nome.
- **Comandos por voz (ADR 0023, RF-20):** cada tecla da interface tem uma linha em
  `bridge/comandos.mjs`, que vira a lista que a voz explica; tecla nova entra lá, e
  `scripts/comandos.test.mjs` cobra. Teclas e voz usam a mesma função para popups
  (`src/lib/comandosDePopup.ts`). Cancelar sai da transcrição (`src/lib/comandos.ts`),
  e ligar a câmera confere a fala do Ricardo: nunca dependa só do modelo para isso.
- **Sub-módulo git (ADR 0014):** `bridge/git.mjs` dá ao A.P.O.L.O. as ferramentas
  `git_*` sobre o próprio repositório — ler o estado, commitar numa branch e
  abrir pull request para a `main`. Commitar e propor merge exigem
  `npm start -- --writes`; merge, push na `main` e `--force` não existem.
- O código ainda é o fork do JARVIS (`bridge/`, `src/`), já renomeado para
  A.P.O.L.O. e em pt-BR (persona, ativação "Apolo", voz masculina do sistema).
  O core (`core/`) ainda não existe. Variáveis de ambiente seguem `JARVIS_*`.
- **Identidade visual (ADR 0013, revisada em 12/11/2026):** paleta ciano (a de
  sempre), núcleo **Enxame** (esfera de pontos em faixas que giram em sentidos
  alternados, `src/scene/Enxame.tsx`, o mesmo `enxameVertex` no app do iPhone),
  marca **Lira** (só o favicon desde 13/11/2026: o cabeçalho ficou só com o nome,
  e o desenho segue em `src/ui/icones.tsx` para uso futuro) e um ícone por sistema na aba SISTEMAS
  (`src/ui/icones.tsx`; ícone novo entra lá). Cor e tipografia são tokens no
  `:root` de `src/index.css` (`--interface`, `--bg`, `--font-ui`, `--font-mono`) —
  CSS novo usa os tokens, não valores escritos à mão. A cor por fase fica em
  `phaseColor`/`accentFor()` (`src/store.ts`), porque a cena 3D e o HUD precisam da
  mesma resposta. O anel antigo segue como estilo (`ring`, `sphere`, `wire`) que o
  agente pode pedir. Faltam as fontes locais (item 2.3) e os ícones no app.
- **App mobile (ADR 0019):** `apps/mobile` (Expo SDK 58, RN 0.88, bundle
  `com.ricardocruz.apolo`, Personal Team `9F2MVYQ9SF`). Ele ouve e responde por
  voz, como o PC, sem conversa escrita, pelo H.E.R.M.E.S. (`hermes/`, porta 8788 com
  token, só com o canal e a mídia dos popups, publicada pelo Tailscale). Desde a
  ADR 0030 ele tem a autonomia do PC no core: backlog, autodesenvolvimento e Fênix
  (rotinas e scripts bash), com as mesmas travas e a confirmação falada conferida na
  transcrição do microfone do celular; sem botões, ele confirma dizendo "confirmo". A
  voz (`src/lib/voz/celular.ts`) e os `Panels` e `Blades` da web são compilados por
  `npm run popups` e rodam numa WebView; os shaders ficam em `src/scene/shaders.ts`.
  Mudar esse código muda o app. Popup é só para conteúdo visual, nunca para a
  resposta. `ios/` e
  `popups.gerado.ts` são gerados: não edite. CocoaPods usa o
  Ruby portátil do Homebrew (`scripts/setup-mobile.command`); no Homebrew,
  Intel + macOS 26 compila LLVM por horas — sempre responder `n`.
- **Telemetria e direção (ADR 0020):** o app grava tempos no Mac por `telemetria`
  (`bridge/telemetria.mjs`, `npm run logs:celular`), nunca a fala. A voz só funciona
  com o app na tela: ao ir para segundo plano ela desliga, e não há
  `UIBackgroundModes` (revisão da ADR 0020). CarPlay nativo exige conta paga e
  aprovação da Apple; o espelhamento não existe. No celular, as partículas usam
  `particlesOrbitVertex`, e o shader do PC fica como está.
- **Cores e HTTPS (ADR 0021):** a cor por atividade vem de `src/lib/estados.ts`, para
  web e app (ouvindo verde, processando amarelo, script lilás, código vermelho, pausa
  azul claro); não escreva cor de estado à mão. Toda conexão é HTTPS: a página fica em
  `https://localhost:5173`, a ponte só aceita origem `https`, e `npm run https` confia
  no certificado de `~/.apolo/tls`.
- **Extensão entre dispositivos (ADR 0022):** `bridge/extensoes.mjs` é só a tomada;
  nenhuma extensão está registrada. O que vier por ela passa pelo gate.
- **Em Espera (ADR 0017):** é a fase `dormant`, por Esc, ociosidade ou voz
  (`dormir`: "em espera", "já volto", "boa noite" de despedida). Nela, só o nome
  ou Espaço acordam: `src/lib/chamada.ts` usa a Web Speech API, com o microfone do
  modelo fechado. `ignorar_fala` é como ele fica calado quando a fala não é para ele.
  O visual de espera (círculo compacto e agrupado, popups na bandeja) é só para a
  espera **pedida** (`dormir` ou Esc, `esperaPedida` no store); a automática, por
  silêncio, fecha o microfone e deixa a tela igual. Componentes visuais leem a fase
  por `faseNaTela()` (`src/store.ts`), não por `phase`. Com os popups do bom dia na
  tela, a conversa fica aberta por até 3 minutos.
- **Nomes dos sistemas (ADR 0018):** cada sistema plugável ganha um nome próprio,
  no espírito de GAIA (*Horizon Zero Dawn*): criativo, fácil de falar, ligado ao
  tema e interessante, nesta ordem, escrito com pontos como C.O.R.E. O canal do
  celular é H.E.R.M.E.S. e a guardiã é F.Ê.N.I.X. (`src/lib/sistemas.ts`). Servidor MCP do Claude Code que não
  serve ao A.P.O.L.O. sai por `APOLO_MCP_IGNORAR` no `.env.local`, sem citá-lo no repositório.
- **Aba SISTEMAS (ADR 0018, RF-56):** só aparece pela tecla `D` ou por voz
  (`diagnostico`). Tudo o que o A.P.O.L.O. usa para rodar é uma linha só, C.O.R.E.;
  skills, extensões, APIs e conectores futuros entram como outras linhas em
  `src/lib/sistemas.ts`. Degradado usa `--alerta` (`contrastante()` em `src/lib/cor.ts`),
  nunca uma cor fixa. Popups viram quadradinhos ao entrar em espera (`BladeTray`).
- **Exibição (RF-57):** ponte e chat só aparecem se pedidos por voz; a escolha fica
  em `~/.apolo/preferencias.json` (`bridge/preferencias.mjs`). A ponte reaparece
  sozinha com proposta ou teste em aberto: nunca esconda o botão Confirmar.
- **Voz própria:** pendente; o usuário quer usar o "Voice Studio" (ferramenta a
  confirmar). ADR nova quando definida.
- **F.Ê.N.I.X., H.E.R.M.E.S. e A.P.O.L.O. independentes (ADR 0025):** `npm start`
  é a F.Ê.N.I.X. (`fenix/`, lê `fenix.config.json`): sobe a ponte, a interface e o
  H.E.R.M.E.S., reinicia o que cair ou travar, troca de versão com rollback
  (`fenix/src/versoes.mjs`, o antigo supervisor), atualiza a `main` e roda rotinas
  fixas e scripts bash, que só rodam com `--writes` e a confirmação do Ricardo, e
  nunca com uma versão sem revisão no ar. O H.E.R.M.E.S. (`hermes/`) é a porta do
  celular e repassa a conversa à ponte em `/hermes`; o que o celular pode pedir é
  decidido em `bridge/hermes.mjs`. **Nenhum dos três importa código do outro**:
  só conversam por WSS com token, para poderem ir a repositórios e máquinas
  diferentes, e os testes cobram isso. A proteção do `fenix.config.json` tem de
  bater com `bridge/autodev/politica.mjs` (`scripts/fenix.test.mjs`). Estado,
  transição, token e eventos ficam em `~/.apolo/fenix/`.
- **Pacto A.P.O.L.O. ↔ F.Ê.N.I.X. (ADR 0028, RF-67):** ele conversa, mostra e muda o
  próprio código; ela cuida da máquina e da versão no ar ("QUEM FAZ O QUÊ" em
  `bridge/realtime.mjs`). A Fênix passa a quem sobe `FENIX_PID` e `FENIX_RENASCER` (a
  receita: comando, pasta, `fenix.log`, `renascimentos.log`, variáveis dela); se ela
  morre, a ponte (`bridge/renascer.mjs`, sensível) a sobe de novo, solta, e sai; três
  vezes em 10 min, desiste. Ctrl-C não ressuscita. `scripts/resiliencia.test.mjs` roda
  isso com a Fênix real e uma ponte mínima (`scripts/resiliencia/ponte.mjs`): mudou a
  Fênix, o cliente ou o renascimento, rode `npm run test:resiliencia`. Prazos da Fênix
  podem vir de `tempos` no `fenix.config.json`.
- **Asas próprias (ADR 0029):** toda troca de versão e a atualização da `main`
  passam por `conferirCopia` (`fenix/src/versoes.mjs`): motivo exato quando não dá
  (arquivos, operação do Git pela metade, branch que não existe), Git com prazo e
  sem pedir senha, `fetch` + `merge --ff-only` conferidos, e nenhum caminho deixa os
  serviços desligados. Arquivo não rastreado só barra se o alvo o sobrescrever. O
  H.E.R.M.E.S. e a A.U.R.O.R.A. sobem sozinhos (`npm run hermes`, `npm run aurora`),
  sobrevivem à morte da Fênix (`src/saidas.mjs` de cada um) e são **adotados** quando
  ela volta (`"independente": true` no `fenix.config.json`). O contrato entre eles é
  `GET /saude` e os WSS com token: a ponte mede a saúde dos dois sozinha
  (`bridge/sondas.mjs`). Não ponha estado de um deles só no relato da Fênix.
- **Notificações (ADR 0027, RF-66):** o H.E.R.M.E.S. é a central: serviços pedem por
  WSS em `/notificacoes` (porta local 8792, `APOLO_NOTIFICAR_TOKEN`) e ele entrega na
  central do macOS (`osascript`, com argumentos, nunca interpolados) e no iPhone pelo
  ntfy (`APOLO_NTFY_TOPICO`, que é segredo). Botões são endereços de uso único na porta
  do celular (`/acao/<token>`) e voltam só a quem pediu. O tópico `<tópico>-mac` leva
  ao Mac o que o Ricardo publicar pelo celular. Notificação nunca leva segredo nem
  conteúdo pessoal: o ntfy.sh vê o texto. Também nunca leva exceção, rastro de erro,
  código ou saída de comando, só frases para ele: o detalhe técnico fica no log
  (`~/.apolo/fenix/rotinas/<rotina>.log`, `eventos.log`), e `textoDoAviso`
  (`fenix/src/avisos.mjs`) barra o que escapar. Uma rotina explica a própria falha
  numa última linha que começa com "✖", e é essa linha que vai no aviso. A Fênix avisa versões, quedas e rotinas.
- **A.U.R.O.R.A., o bom dia (ADR 0026, RF-55):** `modules/aurora/`, serviço à parte
  (porta 8791, token `APOLO_AURORA_TOKEN`) que a Fênix sobe. A cada "bom dia", a voz
  chama `bom_dia`: um trecho de rock das playlists do YouTube toca baixinho no tocador
  do canto (`src/ui/Tocador.tsx`, player oficial visível em 200×200, nunca baixar nem
  esconder; `musica` pausa ou abre a playlist no YouTube Music) e ela narra agenda (.ics),
  notícias por tema e GitHub. Temas e playlists em `modules/aurora/aurora.config.json`.
  E-mail e To Do esperam um app registrado na Microsoft. Nada fora de `modules/aurora`
  importa o módulo. O bom dia abre em diagonal os popups de notícias, compromissos e
  desenvolvimento (`src/lib/bomDia.ts`, ids `bomdia-*`; o desenvolvimento vem de
  `bridge/desenvolvimento.mjs`). "Obrigado" sai da transcrição (`agradece`, em
  `src/lib/comandos.ts`): fecha tudo e entra em espera. O Chrome só toca o iframe com
  som depois de um clique: `scripts/subir-apolo.command` abre a interface com
  `--autoplay-policy=no-user-gesture-required`; fora dela, o tocador pede o clique.
- **Autodesenvolvimento (ADR 0011 e 0015):** com `npm start -- --autodev`, o
  A.P.O.L.O. altera o próprio código por voz ou chat, com confirmação, numa
  worktree em `~/.apolo/autodev`, **a partir da versão no ar** (a `main` ou uma
  branch de fase, ADR 0031). Depois das checagens, reinicia no código novo e fica
  **em teste, sem prazo**: aprovar vira **um commit da branch de trabalho, que
  segue no ar** (a própria branch de fase; partindo da `main`, uma `fase-x.y/nome`
  nova), e o próximo pedido soma outro commit; descartar, uma queda ou um
  `npm start` sem aprovação voltam à versão de onde ela partiu e apagam a branch
  de teste. A `main` nunca recebe commit direto: só pull request. `autodev/<id>` só existe durante o
  teste. O VS Code é opcional (`APOLO_AUTODEV_VSCODE=1`) e fecha sozinho. Arquivos
  sensíveis (`bridge/autodev/politica.mjs`) nunca entram em teste sem revisão.
  A conferência roda lint, tipos, build e `npm test`; ao aprovar, ele oferece o PR
  para a `main`, que só sai com o sim falado e `--writes` (revisão da ADR 0015).
  `desenvolvimento` com acao `backlog` lista "Pendências em etapas" numeradas
  (`etapa.posição`, contando os feitos); `propor` com `tarefa: "1.3"` faz o item
  inteiro como pedido (`pedidoDaTarefa`, em `bridge/desenvolvimento.mjs`).
  Motivos de rollback ficam em `~/.apolo/fenix/eventos.log`.
- Escopo atual: **apenas o core e os pontos de extensão**. Módulos de domínio
  (e-mail, agenda, finanças, automação residencial) vêm depois.

## Regras para agentes

1. **Idioma:** documentação, mensagens de commit, comentários novos e a fala do
   assistente em **português do Brasil**. Identificadores de código em inglês.
2. **Core pequeno.** Se uma funcionalidade é de um domínio (e-mail, casa,
   finanças), ela é um **módulo**, não código no core. Na dúvida, módulo.
3. **Segurança primeiro.** Toda ferramenta com efeito no mundo (enviar, apagar,
   pagar, ligar/desligar dispositivo) passa pelo **gate de permissões** e é
   negada por padrão. Nunca enfraqueça o gate para "fazer funcionar".
4. **Segredos nunca no repositório.** Chaves e tokens só em `.env.local`
   (ignorado pelo Git) ou no cofre do sistema. Nunca logue segredos.
5. **Multi-IA de verdade.** Nenhum código fora de `core/providers/` pode
   depender de um provedor específico (Claude, Gemini, Grok...).
6. **Gratuito por padrão** para voz. Hoje a voz é speech-to-speech pelo Gemini
   Live, que tem plano gratuito (ADR 0010); a OpenAI Realtime, paga, é só
   opção. Provedores de voz ficam isolados em `src/lib/voz/` e
   `bridge/realtime.mjs`.
7. **Rodar local hoje, servidor amanhã.** Nada pode assumir `localhost` fixo,
   um único usuário conectado ou o sistema de arquivos do Mac.
8. **Mudanças pequenas e verificáveis.** Rode `npm run lint` e `npm run build`
   antes de considerar uma tarefa concluída.

## Git

- Toda branch nova parte da `main` atualizada (`git switch main && git pull`),
  nunca de outra branch — para evitar conflitos.
- Nada é commitado direto na `main`: o trabalho entra por pull request,
  revisado pelo Ricardo.
- Nome de branch (ADR 0016): `fase-x.y/<nome-criativo>`. Cada branch nova soma 0.1
  à maior já usada (`git branch -a`): depois de `fase-2.3/...` vem `fase-2.4/...`.
- Ao mudar de fase, recomeça em `fase-x/<nome>`, com x = fase anterior + 1: depois
  de `fase-2.N/...` vêm `fase-3/...` e `fase-3.1/...`. Só o Ricardo muda de fase.
- O nome é criativo e amplo: evoca a entrega inteira, sem amarrar a uma única
  alteração, porque a branch pode receber mais coisas antes do merge. Exemplo:
  `fase-2.3/voz-e-verniz`, e não `fase-2.3/confirmacao-autodev`.

## Mantenha esta documentação viva

Ao concluir uma tarefa, atualize **no mesmo commit**:
- `docs/01-requisitos.md` — status do requisito (`proposto → em andamento → feito`);
- `docs/05-roadmap.md` — marque o item da fase;
- `docs/adr/` — crie uma ADR nova (copie `docs/adr/0000-modelo.md`) para toda
  decisão de arquitetura, biblioteca ou provedor;
- este arquivo — se mudar comando, estrutura de pastas ou regra.

## Comandos

```bash
npm install          # dependências
npm start            # a F.Ê.N.I.X. sobe ponte (cérebro), interface e H.E.R.M.E.S.
scripts/subir-apolo.command # o mesmo, por dois cliques; abre a interface em janela própria do Chrome (perfil ~/.apolo/chrome, autoplay liberado para a música do bom dia)
npm run bridge       # só o cérebro, modo somente leitura
npm run dev          # só a interface (Vite, https://localhost:5173)
npm run lint         # oxlint
npm run build        # checagem de tipos + build
npm run setup        # confere Node, Claude Code e a chave da voz (Gemini ou OpenAI)
npm start -- --autodev  # permite o autodesenvolvimento (ADR 0011)
npm run https        # confia no certificado local e liga o HTTPS do Tailscale (uma vez)
npm run celular      # pareia o iPhone: token, Tailscale e código de pareamento
npm run logs:celular # resume as medições do app (-- 7 para sete dias, --eventos para quedas)
npm run popups       # compila os popups da web para o app do iPhone
npm run rollback     # descarta a alteração em teste e volta à main (com tudo parado)
npm run atualizar    # pede à F.Ê.N.I.X. no ar que traga a main nova; sai com 1 e o motivo se não der
npm run avisar -- "título" "texto"  # a F.Ê.N.I.X. no ar manda o aviso pelo H.E.R.M.E.S. (Mac e iPhone)
npm run hermes       # só o H.E.R.M.E.S., sem a Fênix (a F.Ê.N.I.X. já o sobe)
npm run aurora       # só a A.U.R.O.R.A., sem a Fênix (a F.Ê.N.I.X. já a sobe)
npm run aurora:autorizar # uma vez: autoriza a A.U.R.O.R.A. a ler as playlists do YouTube
npm run aurora:resumo    # mostra o texto do bom dia de hoje
npm run test:autodev # testes da política e do rollback
npm run test:autodev:e2e # ciclo real com Chrome headless mudo (leva minutos, fora do npm test)
npm run test:git     # testes do sub-módulo git (commit e pull request)
npm run test:gateway # testes do canal do app e do H.E.R.M.E.S.
npm run test:fenix   # testes da F.Ê.N.I.X. e do lado dela no A.P.O.L.O.
npm run test:hermes  # testes do H.E.R.M.E.S.
npm run test:aurora  # testes da A.U.R.O.R.A.
npm run test:comandos # testes dos comandos por voz (RF-20)
npm run test:conversa # testes da janela de conversa (ADR 0024)
npm run test:resiliencia # o pacto (ADR 0028): branch que mata a ponte volta à main; a Fênix morta é revivida
npm test             # todos os testes (scripts/, fenix/test/, hermes/test/, modules/aurora/test/)
```

## Ambiente

- Desenvolvimento: macOS (Intel x64), VS Code, Node.js ≥ 20, Chrome.
- Linguagem: **TypeScript** em core, web e app (`apps/mobile`, React Native + Expo).
- Modelos Whisper locais já existem em `~/.whisper-models/` (sem uso desde a
  voz speech-to-speech, ADR 0009).
- Chaves no `.env.local`: `GEMINI_API_KEY` (voz, padrão) e, opcional,
  `OPENAI_API_KEY`. A ponte lê esse arquivo; nada disso vai ao navegador.
- Testar a voz exige rodar no próprio Mac (`npm start`): a rede dos ambientes
  de agente não alcança o Google nem a OpenAI.
