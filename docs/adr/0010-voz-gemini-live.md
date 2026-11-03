# ADR 0010 — Gemini Live como provedor padrão da voz

- **Status:** aceita
- **Data:** 2026-11-03
- **Complementa:** ADR 0009

## Contexto
A ADR 0009 trocou a voz por speech-to-speech com a OpenAI Realtime, que é paga
por uso. O Ricardo não tem créditos na OpenAI e pediu a opção mais rápida e,
depois, a mais barata. A Gemini Live API, do Google, faz o mesmo
(speech-to-speech, chamada de funções, tempo real) e tem plano gratuito
(modelos Live marcados "Free of charge" na tabela de preços, conferida em
03/11/2026). O `gemini-3.8-live` é o recomendado pelo Google para voz com baixa
latência.

## Decisão
1. **Dois provedores**, escolhidos por `APOLO_VOZ_PROVEDOR` (`gemini` ou
   `openai`). Sem escolha, vale o Gemini se houver `GEMINI_API_KEY`.
2. **Gemini por WebSocket.** A ponte emite um token efêmero de uso único
   (`POST v1beta/auth_tokens`) e devolve junto a mensagem de configuração
   (personalidade, voz `Charon`, ferramentas, detecção de turno). O navegador
   conecta em `BidiGenerateContentConstrained?access_token=...`.
3. **Áudio tratado no navegador** (`src/lib/voz/gemini.ts`): captura PCM 16 kHz
   por AudioWorklet, reprodução PCM 24 kHz enfileirada, e um portão anti-eco:
   enquanto ele fala, o microfone só sobe quando a voz da pessoa fica bem mais
   alta (interromper falando por cima). Com fone de ouvido, o portão não atrapalha.
4. **Sessão longa:** compressão de contexto (janela deslizante) e retomada de
   sessão; quando o Google fecha a conexão, o navegador pede um novo token e
   reconecta sem perder a conversa.
5. A OpenAI continua disponível (`src/lib/voz/openai.ts`).

## Consequências
- Custo zero dentro dos limites gratuitos, que não são publicados nem
  garantidos (aparecem no AI Studio).
- No plano gratuito o Google pode usar o conteúdo para melhorar os produtos
  dele; no pago, não.
- O portão anti-eco é uma aproximação: em ambiente barulhento ou falando baixo,
  interromper por voz pode falhar; Espaço sempre interrompe.
