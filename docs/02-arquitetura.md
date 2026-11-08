# 02 — Arquitetura

> Status: **proposta** (Fase 0). Itens marcados com ADR estão em `docs/adr/`.

## Visão geral

```
            CANAIS (rostos)                         CORE (cérebro)                         MÓDULOS (mãos)
 ┌──────────────────────────┐         ┌─────────────────────────────────────────┐     ┌──────────────────────┐
 │ PC: HUD web (React/Three)│         │ Gateway  HTTP + WebSocket + auth        │     │ mod-email   (MCP)    │
 │ Celular: app nativo      │◄──────► │ Orquestrador (loop do agente)           │◄──► │ mod-agenda  (MCP)    │
 │ (futuro: Telegram, CLI)  │  WS     │ Roteador de IAs ─► providers/           │ MCP │ mod-financas(MCP)    │
 │ Voz: STT/TTS local       │         │ Host de módulos (registro + ciclo vida) │     │ mod-casa    (MCP)    │
 └──────────────────────────┘         │ Gate de permissões + auditoria          │     │ ...                  │
                                      │ Memória (SQLite) · Agendador/eventos    │     └──────────────────────┘
                                      │ Configuração + segredos                 │
                                      └─────────────────────────────────────────┘
```

Três camadas, com uma regra: **canais só falam com o core; módulos só falam
com o core.** Canais nunca chamam módulos diretamente.

## Componentes do core

| Componente | Responsabilidade | Origem |
|---|---|---|
| **Gateway** | HTTP/WebSocket, autenticação por token, CORS/origens, sessões de vários dispositivos | evolui `bridge/server.mjs` |
| **Orquestrador** | recebe a mensagem, monta contexto (persona + memória + ferramentas), roda o loop de ferramentas, transmite a resposta em streaming | evolui `bridge/server.mjs` |
| **Roteador de IAs** | escolhe o provedor por tarefa (conversa, raciocínio, visão, barato), aplica fallback e registra consumo | **novo** — ADR 0002 |
| **Providers** | adaptadores: Claude (Agent SDK, assinatura), Claude API, Gemini, Grok (xAI), local (Ollama, futuro) | **novo** |
| **Host de módulos** | lê manifestos, sobe/derruba servidores MCP, valida versões, expõe ferramentas ao orquestrador | evolui `configuredServers()` — ver `03-modulos.md` |
| **Gate de permissões** | `livre` / `confirmar` / `negado` por ferramenta; pede confirmação pelo canal; grava auditoria | evolui `decideTool()` |
| **Memória** | SQLite local: conversas, preferências, fatos, estado dos módulos | **novo** |
| **Agendador/eventos** | cron, gatilhos e barramento interno de eventos (módulos publicam/assinam) | **novo** |
| **Config/segredos** | `apolo.config.json` + `.env.local`; segredos nunca no Git; quem lê o `.env.local` é `bridge/env.mjs`, o primeiro import de todo ponto de entrada (ponte, `npm start`, `npm run rollback`), para que nenhum módulo leia configuração antes de ela existir | evolui `.env.example` |

## Estrutura de pastas alvo

```
apolo/
├── AGENTS.md  CLAUDE.md  GEMINI.md
├── docs/                    documentação viva (este diretório)
├── core/                    o cérebro (Node + TypeScript)
│   ├── gateway/             HTTP, WebSocket, auth
│   ├── orchestrator/        loop do agente, persona, contexto
│   ├── providers/           claude-agent/, anthropic/, gemini/, xai/, ...
│   ├── router/              política de escolha + fallback + custos
│   ├── modules/             host de módulos, manifesto, ciclo de vida
│   ├── permissions/         gate, confirmações, auditoria
│   ├── memory/              SQLite
│   ├── scheduler/           agendador e eventos
│   └── config/
├── modules/                 módulos plugáveis (cada um em sua pasta)
│   └── _exemplo/            módulo de referência
├── apps/
│   ├── face/                interface web atual (src/ de hoje) — PC
│   └── mobile/              app nativo do celular (Fase 2) — ADR 0006
└── bridge/                  código herdado, migrado aos poucos para core/
```

A migração é **incremental**: o JARVIS continua funcionando enquanto `bridge/`
é desmontado em `core/`. Ver ADR 0001.

## Multi-IA (ADR 0002)

Há dois tipos de provedor, e o orquestrador trata os dois pela mesma interface:

1. **Agênticos** — o próprio SDK roda o loop de ferramentas.
   *Claude Agent SDK* (já usado; autentica pelo login do Claude Code).
2. **De chat com ferramentas** — o core roda o loop: envia mensagens e
   ferramentas, executa as chamadas via MCP e devolve o resultado.
   *Gemini, Grok, Claude API, modelos locais.* Proposta: usar uma biblioteca
   unificada (ex.: AI SDK da Vercel) para não escrever um adaptador por provedor.

Interface comum (rascunho):

```ts
interface Provider {
  id: string                       // 'claude-agent' | 'gemini' | 'xai' ...
  capabilities: Set<'tools' | 'vision' | 'streaming' | 'long-context'>
  ask(req: AskRequest, events: AskEvents): Promise<AskResult>
  health(): Promise<{ ok: boolean; reason?: string }>
}
```

Política inicial do roteador: **Claude** para conversa e ações; **Gemini**
(gratuito) como fallback e para tarefas baratas/volumosas (resumos, triagem);
**Grok** opcional (exige créditos pagos).

## Voz (ADR 0009 e 0010)

Speech-to-speech: um modelo só ouve, raciocina e responde em áudio, numa conexão
aberta pelo navegador direto com o provedor. A ponte guarda a chave, emite uma
credencial temporária (`POST /realtime/sessao`) e define personalidade, voz,
detecção de turno e ferramentas (`bridge/realtime.mjs`). O que exige agir no
mundo vai ao Claude pela ferramenta `executar_tarefa`.

| Provedor | Como | Custo |
|---|---|---|
| **Gemini Live** (padrão) — `gemini-3.8-live`, voz Charon | WebSocket, PCM 16/24 kHz, portão anti-eco e retomada de sessão (`src/lib/voz/gemini.ts`) | plano gratuito |
| OpenAI Realtime — `gpt-realtime-2.1` | WebRTC (`src/lib/voz/openai.ts`) | pago por uso |

Escolha com `APOLO_VOZ_PROVEDOR`. Ferramentas da voz: `executar_tarefa`,
`desenvolvimento`, `fenix`, `olhar_camera`, `ajustar_interface`, `diagnostico`,
`ignorar_fala`, `dormir`.

| Função | Como |
|---|---|
| Ouvir + entender + falar | sessão de voz em tempo real (`src/lib/realtime.ts`) |
| Agir (web, e-mail, navegador, painéis) | agente de tarefas Claude, na ponte |
| Ativação | liga sozinha ao abrir a página; conversa de 20 s depois do nome (ADR 0024); em espera, o nome ou Espaço acordam |

## Autodesenvolvimento (ADR 0011 e 0015)

```
voz/chat → proposta → confirmação humana → worktree + Claude Code → checagens
         → F.Ê.N.I.X. troca a branch e reinicia a ponte → EM TESTE (sem prazo)
                              ├─ aprovado: fase-x.x/nome, volta à main
                              └─ descartado, queda ou partida sem aprovação:
                                 apaga a autodev, volta à main
```

| Peça | Arquivo |
|---|---|
| Regras do que pode mudar | `bridge/autodev/politica.mjs` |
| O gate, que `server.mjs` usa e não define | `bridge/gate.mjs` |
| Nome da branch e título do commit | `bridge/autodev/entrega.mjs` |
| VS Code opcional | `bridge/autodev/editor.mjs` |
| Agente (único ponto que conhece o provedor) | `bridge/autodev/agente.mjs` |
| Ciclo do trabalho e checagens | `bridge/autodev/index.mjs` |
| Troca, teste, aprovação e rollback | `fenix/src/versoes.mjs` (F.Ê.N.I.X.) |
| Rollback manual | `fenix/fenix.mjs rollback` (`npm run rollback`) |
| Ciclo real com Chrome mudo | `scripts/e2e/autodev.mjs` |
| Chat e acompanhamento na tela | `src/ui/Autodev.tsx`, `src/lib/autodev.ts` |

A ponte fala com a F.Ê.N.I.X. pelo canal dela (`/fenix`, WSS com token). Sem a
Fênix (`npm run bridge`), a alteração fica na branch e nada reinicia.

## Serviços independentes (ADR 0025)

```
 iPhone ─WSS /canal─▶ H.E.R.M.E.S. ─WSS /hermes─▶ ponte do A.P.O.L.O. ─WSS /fenix─▶ F.Ê.N.I.X.
```

| Serviço | Pasta | Faz | Fala com |
|---|---|---|---|
| A.P.O.L.O. | `bridge/`, `src/`, `apps/mobile/` | voz, interface, agente | a Fênix por `FENIX_URL`; recebe o H.E.R.M.E.S. em `/hermes` |
| F.Ê.N.I.X. | `fenix/` + `fenix.config.json` | sobe e guarda os serviços, versões, rotinas, scripts confirmados | quem a chama em `/fenix` |
| H.E.R.M.E.S. | `hermes/` | porta do celular (8788) e relé até a ponte | a ponte por `HERMES_APOLO_URL` |

Nenhum importa código do outro; cada pasta tem `package.json` próprio e os testes
cobram isso. O protocolo de cada um está no README da pasta.

## Sub-módulo git (ADR 0014)

`bridge/git.mjs` expõe as ferramentas `git_*` sobre o repositório do próprio
A.P.O.L.O.: `git_status` e `git_diff` leem; `git_commit` guarda o trabalho
pendente numa branch e `git_pull_request` propõe o merge para a `main`. As duas
últimas só existem com `JARVIS_ALLOW_WRITES=1` — o gate acontece na construção
do servidor, como no `chrome.mjs`.

Não há merge, push na `main`, `--force` nem rebase: o merge é do Ricardo. A
conferência de segredos é a mesma do autodesenvolvimento (`classificar()` em
`bridge/autodev/politica.mjs`), e a credencial do GitHub nunca passa pela ponte
— quem autentica são o `git` e o `gh` da máquina. Testes: `npm run test:git`.

## Protocolo de canal (RNF-11)

Web e app nativo usam o **mesmo** protocolo WebSocket do gateway, com
mensagens tipadas e versão (`{ "v": 1, "type": ... }`). Tipos mínimos: texto do
usuário, áudio, resposta em streaming, chamada de ferramenta, pedido de
confirmação, painel do HUD, notificação, status. O esquema fica em
`core/gateway/protocol.ts` e é documentado em `docs/` quando implementado.

## Implantação

| Etapa | Onde roda | Requisitos novos |
|---|---|---|
| Agora | tudo neste Mac | nenhum |
| Rede local | core no Mac, app nativo do celular na mesma Wi-Fi | auth por token, TLS local, protocolo de canal versionado (RNF-11) |
| Servidor/nuvem | core em servidor; rosto em qualquer lugar | Docker, HTTPS público, segredos no servidor |
| Híbrido | core na nuvem + "agentes locais" (voz, casa) conectados ao core | módulo remoto via MCP sobre HTTP |
