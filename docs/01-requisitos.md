# 01 — Requisitos

Status: `proposto` · `aprovado` · `em andamento` · `feito` · `adiado`.
Prioridade: **M** (must, core) · **S** (should) · **C** (could, futuro).
Fase: ver `05-roadmap.md`.

## Requisitos funcionais — core

| ID | Requisito | Prior. | Fase | Status |
|---|---|---|---|---|
| RF-01 | Conversar por **texto** e **voz** em português do Brasil | M | 1–2 | em andamento |
| RF-02 | **Roteador de IAs**: usar Claude (principal), Gemini e Grok, com escolha por tarefa e fallback automático quando um provedor falhar ou estourar limite | M | 1 | aprovado |
| RF-03 | **Host de módulos**: descobrir, validar, carregar, habilitar e desabilitar módulos plugáveis sem alterar o core | M | 1 | aprovado |
| RF-04 | **Gate de permissões** por módulo e por ferramenta: `livre` (leitura), `confirmar` (pede ok ao usuário), `negado` | M | 1 | aprovado |
| RF-05 | **Confirmação de ações** pelo canal ativo (tela do PC ou celular), com resumo do que será feito | M | 1 | proposto |
| RF-06 | **Memória persistente**: histórico de conversas, preferências e fatos do usuário, consultável pelos módulos com permissão | M | 1 | proposto |
| RF-07 | **Agendador e eventos** (base do "Preditivo"): tarefas recorrentes, gatilhos por horário/evento e briefings proativos | M | 1 | proposto |
| RF-08 | **Canal PC**: interface web atual (HUD), adaptada ao A.P.O.L.O | M | 1 | em andamento |
| RF-09 | **Canal celular**: **app nativo** (voz, notificações, confirmação de ações) conectado ao core | M | 2 | em andamento |
| RF-10 | **Voz em tempo real gratuita**: conversa speech-to-speech em pt-BR, sem custo por padrão (Gemini Live — ADR 0009 e 0010) | M | 2 | feito (03/11/2026) |
| RF-11 | **Palavra de ativação** "Apolo" no PC e Android; no iPhone via Siri/Atalhos (limite do iOS). Hoje: a página liga sozinha, a conversa segue por 20 s depois do nome, e em espera o nome ou Espaço acordam (ADR 0009, 0017 e 0024) | S | 2 | em andamento |
| RF-12 | **Painel de status**: módulos carregados, provedor de IA em uso, consumo/limites, erros | S | 1 | proposto |
| RF-13 | **Registro de auditoria** de toda ação com efeito (quem pediu, qual módulo, resultado) | M | 1 | proposto |
| RF-14 | **Configuração** por arquivo + variáveis de ambiente, com segredos fora do Git | M | 1 | proposto |
| RF-15 | **Autodesenvolvimento**: por voz ou chat, alterar o próprio código com o Claude Code, seguir o roadmap, reiniciar para teste, voltar à `main` se quebrar ou se o Ricardo descartar, e guardar em `fase-x.x/nome` se ele aprovar (ADR 0011, ADR 0015) | S | 2 | em andamento |
| RF-16 | **Limpar a tela por comando**: entender pedidos como "limpe a bagunça" como fechar os popups abertos (painéis e artigos), preservando a conversa; "apague o histórico" e "limpe tudo" são os outros dois escopos. O A.P.O.L.O. diz o que saiu, ou que a tela já estava limpa | S | próxima versão | feito (03/11/2026) |
| RF-17 | **Sub-módulo git**: fazer commits e gerar pull requests para a própria `main`, passando pelo gate de permissões; o merge continua sendo revisado pelo Ricardo (ADR 0014) | S | próxima versão | em andamento |
| RF-18 | **Contexto compartilhado**: avaliar salvar informações importantes em uma branch local ou em um arquivo de contexto compartilhado, para uso futuro (relacionado a RF-06) | S | próxima versão | proposto |
| RF-19 | **Controle do navegador**: detectar em qual navegador e sistema está rodando, abrir novas abas e transformar uma popup aberta em aba (ADR 0012) | S | próxima versão | em andamento |
| RF-20 | **Comandos por voz**: todo atalho de teclado da interface (`Espaço`, `Esc`, `G`, `D`, `[`, `]`, `E`, `X`) também acionável por voz, com ativação e desativação; entrar em espera ao fim de uma conversa sem se intrometer quando o Ricardo falar com outra pessoa; explicar e lembrar os comandos quando pedido. A câmera do modo mãos só liga por ordem explícita do Ricardo (ADR 0023) | S | próxima versão | em andamento |

## Requisitos funcionais — módulos futuros (fora do escopo atual)

| ID | Módulo | Prior. | Fase |
|---|---|---|---|
| RF-50 | E-mail **Google (Gmail) e Microsoft (Outlook)** (ler, resumir, rascunhar; enviar só com confirmação) | S | 3 |
| RF-51 | Agenda **Google Calendar e Outlook** (consultar, criar e mover eventos) | S | 3 |
| RF-52 | Briefing diário (agenda + e-mails importantes + pendências) | S | 3 |
| RF-53 | Finanças (consulta e alertas; nunca movimentar dinheiro sem confirmação) | C | 4 |
| RF-54 | Automação residencial (módulo construído pelo usuário) | C | 4 |
| RF-55 | **Intro de boas-vindas personalizada**: ao ativar depois de muitas horas fora (ex.: ao acordar, ou ao voltar à noite), tocar um trecho de rock das playlists do Ricardo junto com a saudação falada. Decidido em 08/11/2026: a cada "bom dia", trecho do YouTube Music baixinho por baixo da voz e o resumo do dia (agenda, notícias por tema, GitHub; e-mail e To Do pendentes) pela A.U.R.O.R.A. (ADR 0026) | C | 2 | em andamento |
| RF-56 | **Aba SISTEMAS**: sob demanda (tecla D ou voz), mostra o C.O.R.E. e, no futuro, cada skill, sub-sistema plugável, extensão, API e conector; o que estiver degradado usa a cor mais contrastante com a da interface no momento, e o modelo narra o estado | M | 1 em diante | em andamento |
| RF-57 | **Exibição sob demanda**: ponte e chat ocultos por padrão, exibidos por voz (inclusive "modo detalhado"); a escolha persiste ao religar | M | 1 | em andamento |
| RF-58 | **Sinal de escuta no celular**: círculo e partículas reagem à voz da pessoa, com rótulo de estado e as palavras ouvidas na tela por alguns segundos | M | 2 | feito (07/11/2026) |
| RF-59 | **Telemetria do celular**: tempos de conexão, voz e tarefas gravados no Mac, consultáveis por `npm run logs:celular`, sem guardar a fala (ADR 0020) | S | 2 | feito (07/11/2026) |
| RF-60 | **Uso dirigindo**: voz com o app aberto, pelo som do carro (sem segundo plano, revisão da ADR 0020); CarPlay nativo depende de conta paga e aprovação da Apple (ADR 0020) | S | 2–3 | em andamento |
| RF-61 | **Padrão de cores por atividade** na web e no app: ouvindo verde, processando amarelo, script lilás, código vermelho, pausa azul claro (ADR 0021) | M | 2 | feito (07/11/2026) |
| RF-62 | **HTTPS em toda conexão** entre servidor, web e app (ADR 0021) | M | 2 | feito (07/11/2026) |
| RF-63 | **Comandos entre dispositivos** (mobile, servidor e web): ponto de extensão pronto; a extensão vem depois (ADR 0022) | S | 3 | em andamento |
| RF-64 | **F.Ê.N.I.X., a guardiã**: sobe e mantém no ar a ponte, a interface e o H.E.R.M.E.S. (reinicia se cair ou travar), coloca no ar a versão nova e volta à estável se quebrar, atualiza a `main`, roda rotinas (testes, build, diagnóstico, app do iPhone, volume) e scripts bash só com confirmação; A.P.O.L.O., F.Ê.N.I.X. e H.E.R.M.E.S. independentes e comunicáveis entre máquinas (ADR 0025) | S | 2 | em andamento |
| RF-66 | **Notificações push**: o H.E.R.M.E.S. entrega avisos dos serviços na central do macOS e no iPhone (ntfy), com botões de resposta de uso único, e leva ao Mac o que o Ricardo publicar pelo celular; a F.Ê.N.I.X. avisa versões, quedas e rotinas longas (ADR 0027) | S | 2 | em andamento |
| RF-65 | **Avisos pelo WhatsApp**: testar o CallMeBot como canal gratuito de avisos curtos ao Ricardo, só para o número dele (`docs/poc/0001-callmebot-whatsapp.md`) | C | 3 | proposto |

## Requisitos não funcionais

| ID | Requisito |
|---|---|
| RNF-01 | **Segurança:** negar por padrão ações com efeito; WebSocket/HTTP autenticados assim que sair do `localhost`; origem verificada |
| RNF-02 | **Privacidade:** segredos fora do repositório; dados pessoais armazenados localmente por padrão; logs sem segredos |
| RNF-03 | **Portabilidade:** rodar em macOS agora; Linux/servidor e nuvem depois; nada fixo em `localhost` ou caminhos do Mac |
| RNF-04 | **Modelo híbrido:** core em servidor e partes locais (voz, casa) conversando pela rede |
| RNF-05 | **Custo:** funcionar só com planos gratuitos + a assinatura Claude; registrar consumo por provedor |
| RNF-06 | **Latência de voz:** começar a falar em até ~2 s após o fim da pergunta, com fala em streaming |
| RNF-07 | **Resiliência:** falha de um módulo ou provedor não derruba o core |
| RNF-08 | **Extensibilidade:** um módulo novo não exige mudança no core; contrato versionado |
| RNF-09 | **Manutenibilidade:** TypeScript tipado, lint e build limpos, documentação atualizada no mesmo commit |
| RNF-10 | **Idioma:** interface, voz e documentação em pt-BR |
| RNF-11 | **Protocolo de canal estável e versionado** entre core e clientes (web e app nativo), documentado, para o app não quebrar a cada mudança no core |

## Restrições e fatos conhecidos (verificados em 01/11/2026)

- **Grok (xAI):** a API **não tem plano gratuito**; é pré-paga desde o fim do
  beta (dez/2024). O Grok gratuito existe só no app/site, sem API. → ver ADR 0003.
- **Gemini:** a API tem plano gratuito pelo Google AI Studio, com limites de
  uso e possível uso dos dados para melhorar produtos Google.
- **Claude:** o código-base usa o Claude Agent SDK com o login do Claude Code
  (assinatura). Para rodar 24 h num servidor, avaliar chave de API.
- **Voz (03/11/2026):** o pipeline STT → LLM → TTS ficou lento; trocado por
  speech-to-speech. OpenAI Realtime exige créditos; Gemini Live tem plano
  gratuito e é o padrão (ADR 0010). Kokoro, ElevenLabs e a voz do VoiceStudio
  saíram do projeto. Modelos de voz locais (Moshi, Qwen-Omni) ficam para quando
  houver servidor com GPU.

## Decisões do usuário (01/11/2026)

- Evoluir o fork do JARVIS (ADR 0001, aceita).
- Celular por **app nativo** em React Native + Expo; foco **iPhone**, compatível com Android (ADR 0006).
- Core em **TypeScript** (ADR 0007).
- E-mail e agenda: **Google e Microsoft**.
- Grok: adaptador pronto, **desligado por padrão** (ADR 0003, aceita).
- Provedores: Claude (principal), Gemini, Grok.

## Perguntas em aberto

Ver a seção "Em aberto" de `docs/adr/README.md`.
