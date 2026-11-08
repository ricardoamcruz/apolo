# ADR 0026 — A.U.R.O.R.A., o bom dia com rock e o resumo do dia

- **Status:** proposta
- **Data:** 2026-11-08

## Contexto

O RF-55 estava adiado desde 02/11. Em 08/11 o Ricardo pediu: a cada "bom dia", um
trecho aleatório de rock do YouTube Music dele, mais baixo que a voz, tocando por
baixo enquanto o A.P.O.L.O. cumprimenta e passa o status do dia. O status junta as
notícias do interesse dele (tecnologia e IA, economia e finanças, games e cultura
pop, que devem ficar configuráveis), a agenda, os e-mails importantes e as tarefas
do Microsoft To Do e do GitHub do projeto.

Restrições que apareceram no caminho:

- O **YouTube Music não tem API oficial**. As playlists dele são as do YouTube, e
  a YouTube Data API v3 as lê com OAuth. Os termos do Google proíbem baixar o áudio
  e tocar com o player escondido.
- A **Microsoft** não deixa mais conta pessoal registrar app sem um diretório, e o
  diretório gratuito do Azure pede cartão de crédito, que o Ricardo não quer dar.
  O IMAP com senha de app foi testado e recusado ("Basic authentication is
  disabled"). Usar o ID de app de outro fabricante seria se passar por ele.

## Decisão

**Um módulo à parte**, `modules/aurora/` (A.U.R.O.R.A., Agenda, Últimas notícias,
Recados, Obrigações, Rock e Alvorada; Aurora é a deusa do amanhecer). Como a
Fênix e o H.E.R.M.E.S. (ADR 0025), tem `package.json` próprio, não importa nada
do A.P.O.L.O. e só conversa pela rede: `GET /bom-dia` com token (`APOLO_AURORA_TOKEN`),
na porta 8791, com TLS. A Fênix o sobe como serviço opcional.

É um serviço HTTP, e não ainda o servidor MCP do contrato de `docs/03-modulos.md`,
porque quem chama é a voz, que precisa de uma resposta direta e rápida. Quando o
host de módulos existir (Fase 1), a mesma lógica (`src/resumo.mjs`) ganha uma
fachada MCP.

| Parte | De onde | Credencial |
|---|---|---|
| Música | YouTube Data API: playlists com "rock" no nome (ou as escolhidas em `aurora.config.json`), senão as músicas curtidas | OAuth de dispositivo, só leitura (`youtube.readonly`); token de renovação em `~/.apolo/aurora/youtube.json` (0600) |
| Agenda | Link `.ics` que o Outlook.com publica | o link, em `APOLO_AGENDA_ICS` |
| Notícias | RSS do Google Notícias, por tema, das últimas 24 h | nenhuma |
| Tarefas | `gh pr list` e `gh issue list` do repositório | o `gh` já logado |
| E-mails e To Do | **pendente** | exige app registrado na Microsoft |

**A música toca no player oficial do YouTube**, num popup pequeno (`kind: 'musica'`),
com `enablejsapi`: volume 18 de 100, começando entre 45 s e 75 s da faixa, por 35 s,
com fade de 4 s e o popup se fechando sozinho. Nada é baixado.

**O gatilho é a voz:** a ferramenta `bom_dia` é chamada a cada "bom dia", inclusive
quando ele acorda o A.P.O.L.O. com "bom dia, Apolo". A voz recebe o resumo em
tópicos e o narra em até 30 segundos. Só no PC, por enquanto.

## Consequências

- O bom dia funciona sem cartão nem senha: a agenda pelo `.ics`, as notícias e o
  GitHub de imediato, e a música depois de `npm run aurora:autorizar`, uma vez.
- Os temas, as playlists, o volume e a duração do trecho mudam em
  `modules/aurora/aurora.config.json`, sem mexer em código.
- O link `.ics` dá leitura da agenda a quem o tiver: fica só no `.env.local`.
  `modules/` entrou na lista do que exige revisão (política e Fênix).
- O Google mostra "app não verificado" na autorização, porque o app está em modo
  de teste com o Ricardo como usuário de teste. É esperado e não expira enquanto
  for só ele.
- Falta: e-mails e To Do (quando houver diretório na Microsoft), o bom dia no
  celular e deixar os temas editáveis por voz.
