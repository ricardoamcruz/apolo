# 00 — Visão do A.P.O.L.O.

## O que é

O A.P.O.L.O. (Assistente Preditivo Operacional Logístico e Otimizado) é o
assistente pessoal do Ricardo. Conversa por voz e texto, no PC e no celular,
age sobre os sistemas dele (e-mail, agenda, finanças, casa) e **antecipa**
necessidades em vez de só responder.

## Inspirações

- **JARVIS (Homem de Ferro):** interface holográfica, voz, briefing proativo.
  O código-base deste repositório é um fork do projeto JARVIS open source.
- **A I.A. de *Horizon Zero Dawn*:** uma inteligência central com
  **subfunções especializadas** (no jogo, GAIA e suas subfunções). Aqui, isso
  vira um **core** que coordena **módulos plugáveis**, cada um dono de um domínio.

## O que significa cada letra (e o que exige do sistema)

| Letra | Significado | Exigência |
|---|---|---|
| **P**reditivo | antecipa | agendador, eventos, gatilhos e briefings proativos |
| **O**peracional | executa | ferramentas com efeito real, sob permissões |
| **L**ogístico | organiza | agenda, tarefas, prazos, rotas, lembretes |
| **O**timizado | escolhe bem | roteia cada tarefa para a IA/recurso mais adequado e barato |

## Princípios

1. **Core enxuto, módulos ricos.** O core sabe conversar, lembrar, decidir
   permissões e carregar módulos. Todo o resto é módulo.
2. **Seguro por padrão.** Lê livremente; age só com permissão explícita.
3. **Multi-IA.** Claude é o principal, mas Gemini, Grok e outros são
   intercambiáveis. Nenhum provedor é ponto único de falha.
4. **Gratuito e local quando possível**, especialmente voz.
5. **Portável.** Roda neste PC hoje; em servidor, nuvem ou modelo híbrido amanhã.
6. **Seu de verdade.** Código aberto, dados sob controle do dono.
7. **Fala português do Brasil**, com personalidade própria (não uma imitação do JARVIS).

## Fora de escopo agora

Os módulos de domínio (e-mail, agenda, finanças, automação residencial) e o
deploy em servidor. O foco atual é o **core e os pontos de extensão** que
tornam esses módulos possíveis.
