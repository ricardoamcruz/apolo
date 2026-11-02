# ADR 0006 — Celular por app nativo

- **Status:** aceita
- **Data:** 2026-11-01

## Contexto
O usuário quer usar o A.P.O.L.O no PC e no celular, e escolheu app nativo em
vez de PWA ou bot de mensagens.

## Decisão
Criar `apps/mobile/` com **React Native + Expo, em TypeScript**, como **projeto
nativo** (pastas `ios/` e `android/` geradas, compiladas pelo Xcode e pelo
Android Studio — sem depender do Expo Go). Código nativo em Swift/Kotlin quando
necessário. O app fala
com o core pelo mesmo protocolo de canal da interface web (RNF-11).
Alvo principal: **iPhone**; compatível com **Android** a partir do mesmo código.

## Consequências
- Uma única linguagem (TypeScript) no core, na interface web e no app.
- Testes no iPhone com **Apple ID gratuito** (Personal Team): o app expira em 7
  dias e push/Siri não ficam disponíveis. Se o iPhone travar, os testes seguem no
  **celular Android** do usuário, que não exige conta paga.
- Publicar (TestFlight/App Store) e usar push/Siri exige conta Apple Developer paga.
- **Limite do iOS:** não permite microfone sempre ouvindo em segundo plano.
  A ativação por voz no iPhone será via Siri/Atalhos (App Intents) ou
  abrindo o app; a palavra "Apolo" contínua fica para PC e Android.
Melhor acesso a microfone em segundo plano, notificações e atalhos do sistema.
Exige um protocolo estável e versionado desde a Fase 1, autenticação por token e,
para uso fora de casa, o core acessível pela internet (servidor ou túnel seguro).
