# ADR 0009 — Voz em tempo real, speech-to-speech (OpenAI Realtime)

- **Status:** aceita
- **Data:** 2026-11-03
- **Substitui:** ADR 0004 (voz local) e ADR 0008 (voz própria pré-gravada)

## Contexto
A conversa passava por três etapas em fila: reconhecimento de fala (Chrome ou
ElevenLabs Scribe) → Claude → síntese de voz (voz do sistema, Kokoro ou frases
gravadas no VoiceStudio). Cada etapa esperava a anterior terminar, e o
resultado ficou lento e ruim de conversar — o Ricardo pediu para trocar.

A linha Realtime da OpenAI (`gpt-realtime-2.1` e `-mini`) faz **speech-to-speech**
num modelo só: ouve o áudio, raciocina (esforço configurável), chama funções e
responde em áudio, numa conexão WebRTC aberta direto pelo navegador.

## Decisão
1. **A voz é uma sessão Realtime.** `src/lib/realtime.ts` abre a conexão WebRTC
   (microfone sobe, voz desce, eventos num canal de dados). Detecção de turno,
   interrupção e cancelamento de eco ficam no próprio fluxo.
2. **A chave fica na ponte.** `bridge/realtime.mjs` lê `OPENAI_API_KEY` do
   `.env.local` e emite uma chave temporária por sessão
   (`POST /realtime/sessao` → `POST /v1/realtime/client_secrets`). A
   personalidade, a voz, a detecção de turno e as ferramentas são definidas lá.
3. **O Claude vira o agente de tarefas.** A voz tem a ferramenta
   `executar_tarefa`, que repassa o pedido ao agente da ponte (Claude Agent SDK,
   com todos os servidores MCP, navegador, painéis). O texto final volta e a voz
   fala o resultado. Conversa simples nunca passa pelo Claude.
4. **Ferramentas locais rápidas** executadas no navegador: `olhar_camera`
   (manda a foto direto para o modelo de voz), `ajustar_interface` e `dormir`.
5. **Sem palavra de ativação.** Depois de ligar, o microfone fica aberto; após
   90 s sem fala ele entra em espera (microfone fechado, sessão aberta).
   Acorda com Espaço ou palmas.
6. **Removidos:** `voice.ts`, `tts.ts`, `kokoro.ts`, `vad.ts`, `fillers.ts`,
   `clips.ts`, `capabilities.ts`, o modo direto (`anthropic.ts`, `brain.ts`), os
   endpoints `/tts` e `/stt` (ElevenLabs), `scripts/gerar-voz.ts` e as
   dependências `kokoro-js`, `@picovoice/*` e `@anthropic-ai/sdk`.

Configuração (todas opcionais, no `.env.local`): `APOLO_REALTIME_MODELO`
(padrão `gpt-realtime-2.1`), `APOLO_REALTIME_VOZ` (`cedar`),
`APOLO_REALTIME_RACIOCINIO` (`low`), `APOLO_REALTIME_SILENCIO_MS` (`500`),
`APOLO_REALTIME_TRANSCRICAO` (`gpt-4o-mini-transcribe`).

## Consequências
- Resposta em fração de segundo e interrupção natural.
- **Deixa de ser gratuito e local:** a voz é paga por uso na OpenAI e o áudio
  vai para a nuvem. O `-mini` custa cerca de um terço do modelo cheio. Isso
  contraria o princípio da ADR 0004, por escolha explícita do Ricardo.
- A voz própria Apolo_v01 (VoiceStudio) sai de cena; as vozes são as da OpenAI.
- Uma sessão Realtime dura no máximo cerca de uma hora; ao cair, ela reabre
  na próxima ativação, sem a memória da conversa (o agente de tarefas mantém a
  dele enquanto a ponte estiver de pé).
- O app de celular (ADR 0006) pode usar o mesmo endpoint da ponte para abrir a
  sessão.
