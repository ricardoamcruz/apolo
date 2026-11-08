# ADR 0027 — Notificações push pelo H.E.R.M.E.S.

- **Status:** proposta
- **Data:** 2026-11-08

## Contexto

O Ricardo quer que o H.E.R.M.E.S. envie e receba notificações push, e que a
F.Ê.N.I.X. dispare avisos que apareçam como notificação do sistema. Ele escolheu
receber três coisas: pedidos dos outros serviços, respostas dele pelos botões do
push, e avisos vindos do celular para o Mac.

Push nativo no app A.P.O.L.O. exige a conta paga da Apple (APNs não existe no
Personal Team, a mesma barreira do CarPlay). Entre as alternativas gratuitas, ele
escolheu o **ntfy**: um app gratuito na App Store que recebe push com o app
fechado, por tópicos.

## Decisão

**O H.E.R.M.E.S. vira a central de notificações** (`hermes/src/notificacoes.mjs`):

- **Entrada dos serviços:** WebSocket em `/notificacoes`, numa **porta só local**
  (8792), separada da porta do celular que o Tailscale publica. Token próprio
  (`APOLO_NOTIFICAR_TOKEN`). Pedido: `{ type: 'notificar', titulo, texto,
  prioridade, botoes: [{ rotulo, acao }] }`.
- **Saída no Mac:** central de notificações do macOS, por `osascript`, com título
  e texto passados como argumentos (nunca interpolados no script).
- **Saída no iPhone:** publica no tópico do ntfy (`APOLO_NTFY_TOPICO`), em JSON,
  com prioridade e botões.
- **Botões:** cada botão vira um endereço de uso único, com prazo de 1 h, na porta
  do celular (`/acao/<token>`, pelo Tailscale, `APOLO_HERMES_URL_PUBLICA`). O toque
  volta só ao serviço que pediu a notificação, como `notificacao:acao`.
- **Do celular para o Mac:** o H.E.R.M.E.S. assina `<tópico>-mac` no ntfy; o que o
  Ricardo publicar ali pelo app ntfy aparece na central do macOS.

**A F.Ê.N.I.X. avisa** por uma central configurada no `fenix.config.json`
(`notificacoes`, sem saber que é o H.E.R.M.E.S.): versão em teste (com o botão
**Descartar**, que só volta à versão segura), rollback, troca que falhou, serviço
que caiu (no máximo um aviso a cada 10 min por serviço) e rotina longa terminada.

## Consequências

- Avisos chegam ao iPhone com o app fechado, sem pagar a Apple.
- **O ntfy.sh público vê o texto das notificações**, e quem souber o nome do
  tópico lê e publica nele. Por isso o tópico é aleatório e mora no `.env.local`,
  e as notificações não levam segredos nem conteúdo pessoal. Dá para hospedar um
  servidor ntfy próprio depois (`HERMES_NTFY_URL`).
- O botão **Descartar** age sem a confirmação falada: é o toque do Ricardo, e o
  efeito é o caminho seguro (voltar à `main`). Aprovar uma versão continua só pela
  voz ou pela tela, porque guarda código.
- Os botões só funcionam com o celular pareado (a porta do celular e o Tailscale).
- Falta: o A.P.O.L.O. e a A.U.R.O.R.A. pedirem notificações; avisos ditados por voz
  no app A.P.O.L.O.; um servidor ntfy próprio.
