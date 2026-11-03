# ADR 0008 — Voz própria pelo VoiceStudio, em frases pré-gravadas

- **Status:** aceita
- **Data:** 2026-11-03

## Contexto
O Ricardo criou a voz própria do A.P.O.L.O. — perfil **Apolo_v01**, masculino,
pt-BR — no **VoiceStudio** (github.com/debpalash/VoiceStudio, AGPL-3.0), com o
motor OmniVoice (k2-fsa) rodando no Docker deste Mac (`omnivoice`, porta 3900).
A voz foi criada por descrição (*voice design*), não clonada de ninguém.

O VoiceStudio é local e gratuito (atende a regra 6 e a ADR 0004) e expõe uma API
no formato da OpenAI (`POST /v1/audio/speech`), com chave Bearer.

Medido em 03/11/2026 (i9 Intel, Docker só com CPU — o OmniVoice pede ≥ 6 GB de
VRAM para GPU): **25 a 45 s para gerar 1 a 5 s de fala**. A meta de conversa é
começar a falar em ~2 s (RNF-06), então a voz própria não serve para respostas
em tempo real nesta máquina. A pronúncia em pt-BR é boa; palavras em inglês
("online") saem mal.

## Decisão
1. **Frases fixas pré-gravadas.** `npm run voz:gerar` (`scripts/gerar-voz.ts`)
   grava com a voz própria todas as frases de `FIXED_PHRASES`
   (`src/lib/fillers.ts`: abertura, "Pois não?", confirmações, frases de
   ferramenta) em `public/audio/voz/` + `manifest.json`. O `tts.ts` toca o
   arquivo quando o texto bate (`src/lib/clips.ts`); o resto sai na voz do sistema.
2. **Respostas livres** continuam na voz masculina pt-BR do sistema até o
   VoiceStudio rodar numa máquina com GPU (servidor, RNF-04). Como a API segue o
   formato da OpenAI, isso será um motor de TTS no `tts.ts` apontando para outro
   endereço, sem mudar o resto.
3. Configuração só por variáveis (`VOICESTUDIO_URL`, `VOICESTUDIO_API_KEY`,
   `VOICESTUDIO_VOICE`) no `.env.local`. As gravações **não** são versionadas.
4. Frases fixas evitam palavras em inglês.

## Consequências
- Identidade sonora já agora, sem atraso, custo zero e tudo local.
- Duas vozes convivem (gravada nas frases fixas, do sistema nas respostas) até
  haver GPU.
- Frase fixa nova ou alterada só ganha a voz própria depois de rodar
  `npm run voz:gerar` de novo (incremental; `-- --tudo` regrava todas).
- O VoiceStudio é AGPL-3.0, mas é usado como serviço separado via HTTP; o
  código do A.P.O.L.O. não incorpora nem distribui o código dele.
- Outra máquina sem o VoiceStudio simplesmente fala tudo na voz do sistema.
