# A.P.O.L.O.

**Assistente Preditivo Operacional Logístico e Otimizado** — o assistente pessoal
do Ricardo, com interface holográfica e conversa por voz em tempo real.

## Como funciona

```
 você fala ──► modelo de voz em tempo real (OpenAI Realtime, speech-to-speech)
                 │  ouve, pensa e responde em áudio, numa conexão WebRTC
                 │
                 └─ executar_tarefa ──► agente de tarefas (Claude, na ponte local)
                                         internet, e-mail, agenda, navegador,
                                         painéis na tela, servidores MCP
```

- **A voz** é um modelo só, que ouve e fala direto (sem a fila
  reconhecimento → texto → síntese). Responde em fração de segundo e pode ser
  interrompido falando por cima. Ver [ADR 0009](docs/adr/0009-voz-speech-to-speech.md).
- **O agente de tarefas** é o Claude Code rodando como biblioteca na ponte local.
  A voz repassa a ele tudo o que exige agir ou buscar informação.
- **A interface** é uma página React + Three.js.

## Requisitos

- Node.js 22 ou mais novo.
- Google Chrome (janela de verdade, não painel de prévia — o microfone não
  funciona nesses).
- **Chave da OpenAI** para a voz (paga por uso).
- **Claude Code** instalado e logado (`npm install -g @anthropic-ai/claude-code`,
  depois `claude` uma vez) para o agente de tarefas.

## Começar

```bash
npm install
cp .env.example .env.local     # e preencha OPENAI_API_KEY
npm run setup                  # confere se está tudo pronto
npm start                      # ponte + interface
```

Abra no Chrome o endereço que aparecer (http://localhost:5173), clique em
**INICIAR** (ou bata palmas) e fale normalmente.

## Teclas

| Tecla | Ação |
|---|---|
| Espaço | liga, acorda da espera, ou interrompe a fala dele |
| Esc | põe em espera (e cancela uma tarefa em andamento) |
| G | câmera e controle por gestos |
| D | painel de diagnóstico |

Depois de 90 segundos sem ninguém falar, ele entra em espera e fecha o
microfone. Espaço ou palmas acordam.

## Documentação

Visão, requisitos, arquitetura e decisões em [`docs/`](docs/).

Licença MIT. Derivado do projeto open source J.A.R.V.I.S. (ver `LICENSE`).
