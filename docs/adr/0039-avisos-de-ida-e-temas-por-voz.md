# ADR 0039 — Avisos de ida ao H.E.R.M.E.S., e os temas do bom dia por voz

- **Status:** aceita
- **Data:** 2026-11-27

## Contexto

Duas pendências da Etapa 3 do roadmap ("Contexto e comunicação") encostam no mesmo
ponto: o que o Ricardo precisa saber ou mudar sem estar na frente da tela.

1. **Só a F.Ê.N.I.X. pedia notificações.** A central é do H.E.R.M.E.S. (ADR 0027), e
   o protocolo dela é um WebSocket em `/notificacoes`, com botões que voltam a quem
   pediu. Isso serve à Fênix, que fica conectada e precisa receber o toque num
   botão. O A.P.O.L.O. e a A.U.R.O.R.A. não precisam de nada disso: cada um tem um
   aviso só de ida, raro, e manter uma conexão aberta para isso custaria mais do que
   o aviso vale. Pior: a A.U.R.O.R.A. não pode nem importar a biblioteca `ws` — a
   independência dela (ADR 0029) só permite `node:` e o que está na própria pasta — e
   o `WebSocket` global do Node não aceita uma autoridade de certificado própria, que
   é exatamente o caso aqui (certificado local, ADR 0021).
2. **Os temas de notícia do bom dia só mudavam no editor.** Eles estão em
   `modules/aurora/aurora.config.json`, versionado no repositório. "Tira games do bom
   dia" era um pedido que não tinha como ser atendido — e escrever no arquivo do
   repositório é pior do que não atender: a cópia em execução ficaria suja, e cópia
   suja barra a troca de branch (ADR 0038) e o autodesenvolvimento (ADR 0015).

## Decisão

**Um caminho curto na central: `POST /notificar`.** Mesma porta local das
notificações, mesmo token (`APOLO_NOTIFICAR_TOKEN`), corpo em JSON
(`{ titulo, texto, prioridade }`) de no máximo 8 KB, resposta com o que a central
fez. Botões pedidos por aqui são ignorados: não há conexão para onde devolver o
toque. O WebSocket de `/notificacoes` continua como está, e é ele que a Fênix usa.

Com isso, cada um tem o seu cliente pequeno, sem importar código do outro:
`bridge/avisos.mjs` e `modules/aurora/src/avisos.mjs`. As regras da ADR 0027 valem
igual: o aviso nunca leva segredo, exceção, rastro, código ou saída de comando — o
detalhe fica no log, e `textoDoAviso` barra o que escapar.

**O A.P.O.L.O. avisa o que termina sozinho:** o autodesenvolvimento. Alteração que
subiu e está em teste, trabalho que foi para uma branch de revisão e trabalho que não
terminou. O que parte dele com ele na frente da tela (aprovar, cancelar, reverter)
não volta como notificação. A decisão é de `avisoDoAutodev`, sobre a mudança de
estado — nunca sobre o estado, para o mesmo aviso não sair duas vezes.

**A A.U.R.O.R.A. avisa a música do bom dia:** quando o acesso ao YouTube quebra e
quando volta. Só a mudança avisa (ela confere a cada 10 min, ADR 0029), e a primeira
conferência de cada partida só registra. O texto é uma frase escrita por ela; a
mensagem de erro do Google fica no log.

**Os temas de notícia são editáveis por voz, e a escolha mora fora do repositório.**
A ferramenta `noticias` (PC e celular) lista, tira, inclui, muda quantas notícias por
tema e volta ao padrão. A A.U.R.O.R.A. serve isso em `GET`/`POST /noticias`, com o
token dela, e guarda a escolha em `AURORA_PASTA/noticias.json` — como as preferências
de exibição do A.P.O.L.O. (RF-57). O `aurora.config.json` continua sendo o padrão, e
"volta aos temas de sempre" apaga a escolha. A ponte só repassa o pedido
(`bridge/aurora.mjs`); nada fora de `modules/aurora` lê ou escreve o arquivo dela.

## Consequências

- Quem quiser avisar o Ricardo precisa de três coisas: o endereço, o token e um POST.
  Nenhum serviço novo precisa de biblioteca de WebSocket para isso.
- Um aviso que não sai nunca atrapalha: vira linha de log, e o serviço segue igual.
- O `aurora.config.json` deixa de ser a verdade sobre os temas: é o padrão. Quem
  quiser saber o que vale hoje pergunta à A.U.R.O.R.A. (`GET /noticias`), não ao
  arquivo.
- Mudar os temas no arquivo do repositório não muda nada para quem já escolheu por
  voz, até ele pedir o padrão de volta. É o preço de não sujar a cópia em execução.
- Falta validar no Mac: o aviso chegando ao iPhone quando o autodesenvolvimento
  termina, e "tira games do bom dia" por voz, no PC e no celular.
