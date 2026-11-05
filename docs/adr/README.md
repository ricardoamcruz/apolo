# Registro de decisões (ADRs)

| ADR | Título | Status |
|---|---|---|
| 0001 | Evoluir o fork do JARVIS em vez de reescrever | aceita |
| 0002 | Multi-IA por interface `Provider` + roteador | aceita |
| 0003 | Grok como provedor opcional (API paga) | aceita |
| 0004 | Voz gratuita e local por padrão (revisada) | substituída por 0009 |
| 0005 | Módulos como servidores MCP + manifesto | aceita |
| 0006 | Celular por app nativo (React Native + Expo) | aceita |
| 0007 | TypeScript como linguagem do core | aceita |
| 0008 | Voz própria pelo VoiceStudio, em frases pré-gravadas | substituída por 0009 |
| 0009 | Voz em tempo real, speech-to-speech (OpenAI Realtime) | aceita |
| 0010 | Gemini Live como provedor padrão da voz | aceita |
| 0011 | Autodesenvolvimento com rollback automático | proposta |
| 0012 | Controle do navegador pela própria interface | proposta |
| 0013 | Identidade visual do A.P.O.L.O. na interface | proposta |

## Em aberto

- Paleta do A.P.O.L.O. (ADR 0013): ficar no ciano herdado ou ir para âmbar sobre
  azul profundo, no espírito de *Horizon*? Escolha do Ricardo; entra como
  revisão da 0013. Junto dela, a geometria do núcleo 3D, que ainda é o reator.
- Contexto compartilhado (RF-18): branch local ou arquivo? Decidir em ADR nova.
- Sub-módulo git (RF-17): como guardar a credencial do GitHub fora do repositório
  e como isso convive com o item 7 da ADR 0011. Decidir em ADR nova.
