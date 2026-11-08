# A.P.O.L.O.

**Assistente Preditivo Operacional Logístico e Otimizado** é o assistente pessoal
do Ricardo. Ele conversa por voz em tempo real, no PC e no iPhone, e tem uma
interface holográfica.

A ideia vem do JARVIS e da I.A. de *Horizon Zero Dawn*: um **core** pequeno e
confiável que cresce por **módulos plugáveis**. Visão e princípios em
[`docs/00-visao.md`](docs/00-visao.md).

> **Estado:** a Fase 0 (fundação) está concluída. O que se usa hoje é o fork do
> JARVIS, já em pt-BR, com voz, app do iPhone e autodesenvolvimento. O `core/` da
> Fase 1 ainda não existe. Ver [`docs/05-roadmap.md`](docs/05-roadmap.md).

## Como funciona

```
 PC: Chrome (https://localhost:5173)          iPhone: app A.P.O.L.O.
 ┌──────────────────────────────┐            ┌──────────────────────────────┐
 │ HUD React + Three.js         │            │ React Native + Expo           │
 │ voz: Gemini Live (WebSocket) │            │ voz: mesma da web, numa WebView│
 └──────────────┬───────────────┘            └──────────────┬───────────────┘
                │ áudio vai direto ao Google                │ HTTPS/WSS pelo Tailscale
                │                                           ▼
                │                              ┌────────────────────────┐
                │                              │ H.E.R.M.E.S. (hermes/) │
                │                              │ token do celular, 8788 │
                │                              └───────────┬────────────┘
                ▼                                          │ WSS /hermes
        ┌───────────────────────────────────────────────────────────────┐
        │ Ponte do A.P.O.L.O. (bridge/, Node, porta 8787, HTTPS/WSS)    │
        │ credencial temporária da voz · gate de permissões             │
        │ agente de tarefas: Claude Agent SDK + servidores MCP          │
        │ navegador · git · autodesenvolvimento · telemetria · extensões│
        └──────────────────────────────┬────────────────────────────────┘
                                       │ WSS /fenix
        ┌──────────────────────────────▼────────────────────────────────┐
        │ F.Ê.N.I.X. (fenix/, porta 8790): sobe e guarda os serviços,   │
        │ troca de versão com rollback, rotinas e scripts confirmados    │
        └───────────────────────────────────────────────────────────────┘
```

- **A voz** é um modelo só, que ouve e fala direto em áudio (speech-to-speech),
  sem a fila reconhecimento → texto → síntese. Você pode interrompê-lo falando por
  cima. O padrão é o Gemini Live, que tem plano gratuito; a OpenAI Realtime é
  opcional. Ver [ADR 0009](docs/adr/0009-voz-speech-to-speech.md) e
  [ADR 0010](docs/adr/0010-voz-gemini-live.md).
- **O agente de tarefas** é o Claude Code rodando como biblioteca na ponte. A voz
  repassa a ele, pela ferramenta `executar_tarefa`, tudo o que exige agir ou buscar
  informação.
- **A ponte** guarda as chaves. O navegador e o app só recebem uma credencial
  temporária da voz.
- **O celular** usa o mesmo código de voz e os mesmos popups da web, compilados
  para uma WebView, e chega à ponte pelo H.E.R.M.E.S. Ver
  [ADR 0019](docs/adr/0019-gateway-do-celular.md).
- **A F.Ê.N.I.X.** é quem o `npm start` sobe. Ela sobe a ponte, a interface e o
  H.E.R.M.E.S., reinicia o que cair ou travar, coloca no ar o código que o
  A.P.O.L.O. escreveu e volta à `main` se quebrar. Também roda as rotinas da
  máquina (testes, build, atualizar, app do iPhone, volume) e scripts bash que
  você confirmar.
- **Notificações:** o H.E.R.M.E.S. entrega avisos na central do macOS e no iPhone pelo
  app gratuito ntfy, com botões de resposta. A Fênix avisa quando uma versão vai
  para o ar, volta à segura ou um serviço cai. Ver
  [ADR 0027](docs/adr/0027-notificacoes-pelo-hermes.md).
- **A A.U.R.O.R.A.** é o bom dia. A cada "bom dia", toca um trecho de rock das
  suas playlists do YouTube, baixinho, enquanto ele resume a agenda, as notícias dos
  seus temas e o GitHub. Ver [ADR 0026](docs/adr/0026-aurora-bom-dia.md).
- **A.P.O.L.O., F.Ê.N.I.X. e H.E.R.M.E.S. são independentes:** pastas próprias,
  nenhum importa código do outro, e conversam só por WebSocket com TLS e token,
  então podem ir para repositórios e máquinas diferentes. Ver
  [ADR 0025](docs/adr/0025-fenix-hermes-servicos-independentes.md).

## Tecnologias

| Camada | Linguagem | Principais bibliotecas |
|---|---|---|
| Interface do PC (`src/`) | TypeScript, TSX, CSS, GLSL (shaders em `src/scene/shaders.ts`) | React 19, Three.js e React Three Fiber, Framer Motion, Zustand, MediaPipe (gestos), DOMPurify |
| Ponte (`bridge/`) | JavaScript (ES modules, `.mjs`) em Node.js | Claude Agent SDK, `ws`, Zod |
| F.Ê.N.I.X. (`fenix/`) e H.E.R.M.E.S. (`hermes/`) | JavaScript (`.mjs`) em Node.js | só `ws` e a biblioteca padrão do Node |
| App do iPhone (`apps/mobile/`) | TypeScript, TSX | Expo SDK 58, React Native 0.88, `expo-gl`, `react-native-webview`, `expo-secure-store` |
| Scripts e testes (`scripts/`) | JavaScript (`.mjs`) | `node:test`, Chrome headless no teste de ponta a ponta |
| Ferramentas | — | Vite 8, TypeScript 6, oxlint, CocoaPods e Xcode no iOS |

O core da Fase 1 será em TypeScript ([ADR 0007](docs/adr/0007-typescript-core.md)).
Identificadores de código ficam em inglês; documentação, comentários novos,
commits e a fala do assistente, em português do Brasil.

Tamanho aproximado do código em novembro de 2026: 10 mil linhas de TypeScript e
TSX, 10 mil de `.mjs` e 2 mil de CSS.

## Estrutura do repositório

```
apolo/
├── src/                interface do PC (HUD, cena 3D, voz, popups)
│   ├── lib/voz/        clientes de voz: Gemini, OpenAI e a ponte do celular
│   ├── scene/          núcleo 3D, partículas e shaders
│   └── ui/             painéis, popups (blades), SISTEMAS, diagnóstico
├── bridge/             a ponte: servidor, gate, git, navegador, autodev e os
│                       lados do A.P.O.L.O. na F.Ê.N.I.X. e no H.E.R.M.E.S.
├── fenix/              F.Ê.N.I.X.: guardiã, versões, rotinas (serviço à parte)
├── hermes/             H.E.R.M.E.S.: a porta do celular (serviço à parte)
├── modules/aurora/     A.U.R.O.R.A.: o bom dia com rock e o resumo do dia
├── fenix.config.json   o que a F.Ê.N.I.X. sabe do A.P.O.L.O.
├── apps/mobile/        app do iPhone (Expo); ios/ é gerado
├── scripts/            preparar, setup, celular, https, iphone e os testes
├── docs/               visão, requisitos, arquitetura, roadmap e ADRs
└── AGENTS.md           guia para agentes de IA (Claude Code, Gemini CLI, Copilot)
```

## Requisitos

- macOS, para o app do iPhone. A interface e a ponte rodam em qualquer sistema com Node.
- Node.js 22 ou mais novo. Os testes importam TypeScript direto, o que pede Node 22.18+.
- Google Chrome, em janela de verdade: em painel de prévia o microfone não funciona.
- **Chave do Gemini** para a voz, gratuita em https://aistudio.google.com/apikey,
  ou uma chave da OpenAI, paga por uso.
- **Claude Code** instalado e logado (`npm install -g @anthropic-ai/claude-code`,
  depois `claude` uma vez), para o agente de tarefas.

## Começar

```bash
npm install
cp .env.example .env.local     # e preencha GEMINI_API_KEY
npm run setup                  # confere se está tudo pronto
npm run https                  # uma vez: confia no certificado local
npm start                      # a F.Ê.N.I.X. sobe ponte, interface e H.E.R.M.E.S.
```

Abra **https://localhost:5173** no Chrome e fale normalmente: a interface liga
sozinha, direto no círculo, como no app. Se o Chrome segurar o som até um gesto na
página, a barra de estado avisa, e qualquer clique ou tecla o libera. Toda conexão é HTTPS, e a ponte recusa origem `http`
([ADR 0021](docs/adr/0021-padrao-de-cores-e-https.md)).

Para ele abrir abas quando você pedir, libere uma vez os pop-ups desse endereço:
nas configurações do site, **Permitir pop-ups e redirecionamentos**. O navegador só
abre janelas pedidas por um clique, e um pedido por voz não conta como clique
([ADR 0012](docs/adr/0012-controle-navegador.md)).

Ele também cuida do próprio código. Diz o que está pendente, commita numa branch e
abre pull request para a `main`, as duas últimas só com `npm start -- --writes` e o
[GitHub CLI](https://cli.github.com) logado. Merge, push na `main` e `--force` não
existem ([ADR 0014](docs/adr/0014-submodulo-git.md)). Com `npm start -- --autodev`,
ele altera o próprio código por voz, com teste, aprovação e rollback para a `main`
([ADR 0015](docs/adr/0015-ciclo-de-teste-autodev.md)).

### iPhone

Resumo: Tailscale no Mac e no iPhone, `npm run celular` para parear, `npm start`, e
instalar a versão Release com `cd apps/mobile && npm run ios -- --device
--configuration Release`. O passo a passo, os limites da conta gratuita da Apple e
os problemas comuns estão em [`docs/06-ambiente-mobile.md`](docs/06-ambiente-mobile.md).

## Comandos

Todo atalho de teclado também funciona por voz ([ADR 0023](docs/adr/0023-comandos-por-voz.md)).
Se você esquecer, pergunte a ele quais comandos existem.

| Tecla | Ação | Por voz | No celular |
|---|---|---|---|
| Espaço | acorda da espera ou interrompe a fala | "Apolo" acorda; "para", "chega" interrompem | "Apolo" ou toque na tela |
| Esc | entra em espera e cancela a tarefa | "em espera", "já volto"; "cancela" só cancela | sim |
| G | modo mãos: câmera e gestos | "ligar modo mãos", "desligar a câmera" | não |
| D | diagnóstico completo | "diagnóstico completo", "fechar diagnóstico" | não |
| `]` e `[` | próximo e anterior popup | "próximo popup", "popup anterior" | sim |
| E | tela cheia do popup, ou sair dela | "tela cheia", "sair da tela cheia" | sim |
| X | fecha o popup da frente | "fechar este popup"; "limpe a bagunça" fecha todos | sim |

Depois de chamado pelo nome, a conversa segue sem repeti-lo. Se ficar 20 segundos sem
nada dirigido a ele, ele volta sozinho à espera; a TV e conversas ao lado não o
seguram acordado ([ADR 0024](docs/adr/0024-conversa-continua.md)). Em espera, o nome o
acorda, no PC e no celular, e no celular um toque também
([ADR 0017](docs/adr/0017-em-espera-pelo-nome.md)).
A cor da interface mostra o que ele está fazendo: verde ouvindo, amarelo
processando, lilás executando script, vermelho codificando e azul claro em espera.

## Scripts

| Comando | O que faz |
|---|---|
| `npm start` | a F.Ê.N.I.X. com ponte, interface e H.E.R.M.E.S. (`-- --writes` e `-- --autodev` liberam ações) |
| `npm run bridge` | só a ponte, somente leitura |
| `npm run dev` | só a interface (Vite) |
| `npm run setup` | confere Node, Claude Code e a chave da voz |
| `npm run https` | confia no certificado local e liga o HTTPS do Tailscale |
| `npm run celular` | pareia o iPhone: token, Tailscale e código de pareamento |
| `npm run popups` | compila os popups e a voz da web para o app |
| `npm run logs:celular` | resume as medições do app (`-- 7` para sete dias) |
| `npm run rollback` | com tudo parado, descarta a alteração em teste e volta à `main` |
| `npm run hermes` | só o H.E.R.M.E.S. (a F.Ê.N.I.X. já o sobe) |
| `npm run aurora:autorizar` | uma vez: autoriza a leitura das suas playlists do YouTube |
| `npm run aurora:resumo` | mostra o texto do bom dia de hoje |
| `npm run lint` · `npm run build` | oxlint · checagem de tipos e build |
| `npm test` | todos os testes: `scripts/`, `fenix/test/`, `hermes/test/` e `modules/aurora/test/` |
| `npm run test:fenix` · `npm run test:hermes` | só os da F.Ê.N.I.X. ou do H.E.R.M.E.S. |
| `npm run test:autodev:e2e` | ciclo real do autodesenvolvimento, com Chrome headless mudo |

## Segurança

- **Gate de permissões:** toda ferramenta com efeito no mundo é negada por padrão,
  e as que agem pedem `--writes`. A confirmação do autodesenvolvimento e o modo mãos
  conferem a fala do Ricardo na transcrição, e não só o que o modelo decidiu.
- **Segredos** só em `.env.local` (ignorado pelo Git). Nunca vão ao navegador nem ao app.
- **Celular:** o H.E.R.M.E.S. só tem o canal do app, exige token e fica atrás do
  Tailscale; o que o celular pode pedir é decidido na ponte.
- **F.Ê.N.I.X.:** rotinas são uma lista fixa, sem shell. Um script bash só roda com
  `--writes`, com a sua confirmação (fala ou botão) e com o texto exato proposto,
  nunca com uma versão sem revisão no ar, e sem nenhum segredo no ambiente.
- **Telemetria** guarda tempos, nunca a fala ([ADR 0020](docs/adr/0020-telemetria-e-direcao-no-celular.md)).

## Documentação

| Arquivo | Conteúdo |
|---|---|
| [`docs/00-visao.md`](docs/00-visao.md) | o que é o A.P.O.L.O. e seus princípios |
| [`docs/01-requisitos.md`](docs/01-requisitos.md) | requisitos `RF-*` e `RNF-*`, com status |
| [`docs/02-arquitetura.md`](docs/02-arquitetura.md) | core, provedores de IA, canais e voz |
| [`docs/03-modulos.md`](docs/03-modulos.md) | contrato dos módulos plugáveis |
| [`docs/04-base-jarvis.md`](docs/04-base-jarvis.md) | o código herdado do JARVIS |
| [`docs/05-roadmap.md`](docs/05-roadmap.md) | fases e backlog da próxima versão |
| [`docs/06-ambiente-mobile.md`](docs/06-ambiente-mobile.md) | Xcode, iPhone, Tailscale e o app |
| [`docs/adr/`](docs/adr/README.md) | as 27 decisões de arquitetura (ADRs) |
| [`docs/poc/`](docs/poc/) | provas de conceito a testar, como avisos pelo WhatsApp |
| [`fenix/README.md`](fenix/README.md) · [`hermes/README.md`](hermes/README.md) · [`modules/aurora/README.md`](modules/aurora/README.md) | o protocolo e o config de cada serviço |
| [`AGENTS.md`](AGENTS.md) | regras para agentes de IA que trabalham neste repositório |

## Histórico de versões

Cada versão é uma branch `fase-x.y/<nome>` integrada à `main` por pull request
([ADR 0016](docs/adr/0016-nome-das-branches.md)).

| Versão | Data | O que entrou |
|---|---|---|
| `fase-2.7/alvorada` | em revisão | A.U.R.O.R.A., o bom dia: a cada "bom dia", um trecho de rock das playlists do YouTube toca baixinho no player oficial enquanto ele resume a agenda (.ics do Outlook), as notícias dos temas escolhidos e o GitHub (ADR 0026, RF-55). O autodesenvolvimento confere com `npm test` antes de ir ao ar e oferece o pull request ao aprovar. Notificações push pelo H.E.R.M.E.S.: central do macOS e iPhone pelo ntfy, com botões de resposta, e avisos da Fênix (ADR 0027, RF-66) |
| `fase-2.6/das-cinzas` (#10) | 08/11/2026 | F.Ê.N.I.X., a guardiã: `npm start` passa a ser ela, que sobe e reinicia ponte, interface e H.E.R.M.E.S., troca de versão com rollback, atualiza a `main`, roda rotinas (testes, build, app do iPhone, volume) e scripts bash confirmados. O canal do celular vira o serviço H.E.R.M.E.S. Os três independentes, só pela rede (ADR 0025). Nota técnica da P.O.C. de avisos pelo WhatsApp |
| `fase-2.5/maos-livres` (#9) | 08/11/2026 | O canal do celular aparece na aba SISTEMAS como H.E.R.M.E.S., e servidores do Claude Code que não servem ao A.P.O.L.O. ficam de fora (`APOLO_MCP_IGNORAR`). Conversa contínua por 20 s depois do nome, sem a TV segurar a conversa aberta; o nome acorda também no iPhone (ADR 0024). A página do PC liga sozinha, sem a tela de INICIAR e a animação de carregamento. No iPhone, a voz desliga ao minimizar o app. Todas as teclas também por voz: popups um a um, modo mãos, diagnóstico completo, cancelar tarefa e explicar os comandos (RF-20, ADR 0023). `]` e `[` passam por todos os popups. Acordar pelo nome ficou mais rápido. README técnico |
| `fase-2.4/apolo-no-bolso` (#8) | 07/11/2026 | App do iPhone por voz, com sinal de escuta e palavras ouvidas; telemetria no Mac; voz em segundo plano; cor por atividade na web e no app; HTTPS em toda conexão; ponto de extensão entre dispositivos (ADRs 0019 a 0022) |
| `fase-2.3/voz-e-verniz` (#7) | 06/11/2026 | Em Espera acordando pelo nome, `ignorar_fala` para não se intrometer, aba SISTEMAS com o C.O.R.E., ponte e chat só quando pedidos (ADRs 0017 e 0018) |
| `fase-2.2/autodev-ciclo` (#6) | 06/11/2026 | Ciclo de teste do autodesenvolvimento: aprovar guarda numa branch, descartar ou cair volta à `main` (ADR 0015) |
| `fase-2.2/interface-apolo` (#5) | 06/11/2026 | Controle do navegador, sub-módulo git e começo da identidade visual (ADRs 0012 a 0014) |
| `fase-2/autodesenvolvimento` (#4) | 03/11/2026 | Autodesenvolvimento por voz com rollback automático; abertura sem o reator herdado (ADR 0011) |
| `fase-1/voz-realtime` (#3) | 03/11/2026 | Voz speech-to-speech, Gemini Live como padrão e interface em português (ADRs 0009 e 0010) |
| `docs/estado-atual-agents` (#2) | 03/11/2026 | Estado atual no `AGENTS.md` e regra das branches |
| `fase-0/apolo-ptbr-mobile` (#1) | 02/11/2026 | Documentação do A.P.O.L.O., persona em pt-BR e o primeiro app "olá" no iPhone |

## Licença

MIT. Derivado do projeto open source J.A.R.V.I.S., de Aditya Dewaskar (ver `LICENSE`).
