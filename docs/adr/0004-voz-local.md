# ADR 0004 — Voz gratuita e local por padrão

- **Status:** aceita (02/11/2026, revisada)
- **Data:** 2026-11-01

## Contexto
O usuário quer voz gratuita ou open source, masculina, em pt-BR. A base usa a
fala do navegador e, opcionalmente, o ElevenLabs (pago).

Ao testar (01–02/11/2026): o `kokoro-js` (Kokoro no navegador) instalado só
tem vozes em inglês (`en-us`, `en-gb`); as vozes pt-BR do Kokoro existem só na
versão Python. O usuário quer gerar a voz própria do A.P.O.L.O. no
"Voice Studio" (ferramenta ainda a confirmar).

## Decisão
- **Princípio:** voz gratuita e local por padrão; serviços pagos só como opção.
- **STT:** reconhecimento do Chrome em `pt-BR`; whisper.cpp local como
  alternativa privada.
- **TTS provisório:** a melhor voz masculina pt-BR do sistema operacional
  (no macOS: Reed, Eddy, Rocko), via `speechSynthesis`.
- **Voz própria:** escolhida numa ADR nova, depois de confirmar o que é o Voice
  Studio (local ou nuvem, tempo real ou só arquivos, licença).
- ElevenLabs continua opcional; Kokoro fica de fora até haver pt-BR no navegador.

## Consequências
Custo zero e privacidade desde já, com qualidade de voz limitada (vozes do
sistema soam robóticas). A troca da voz não exige mudança fora de `src/lib/tts.ts`.
