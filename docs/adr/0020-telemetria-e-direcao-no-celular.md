# ADR 0020 — Telemetria do celular e voz para usar dirigindo

- **Status:** proposta
- **Data:** 2026-11-07

## Contexto
A conversa pelo iPhone parece lenta, e sem medidas não há como saber onde está o
tempo. A voz vai direto do iPhone ao Google; só as tarefas e a credencial passam
pelo Tailscale até o Mac, então "lento" pode ser três coisas diferentes.

O Ricardo também quer o A.P.O.L.O. ao dirigir, no CarPlay. O CarPlay não espelha o
iPhone: mostra apenas apps feitos para ele, com os modelos de tela da Apple. Apps de
voz são uma categoria desde o iOS 26.4, com o direito
`com.apple.developer.carplay-voice-based-conversation`, concedido pela Apple a
pedido, app a app, como capacidade gerenciada da conta de desenvolvedor. O
A.P.O.L.O. assina com Personal Team gratuito, e a documentação lida não diz se esse
tipo de conta pode receber o direito; a expectativa é que não.

## Decisão
**Telemetria.** O app mede a conexão, a voz e as tarefas e manda os números em lotes
pelo canal autenticado (`telemetria`, em `MENSAGENS_DO_CELULAR`), inclusive pelo
Tailscale fora de casa. Sem conexão, guarda até 500 eventos na memória. A ponte
acrescenta o tempo do agente, que separa agente de rede, e grava em
`~/.apolo/logs/celular-AAAA-MM-DD.jsonl` (`bridge/telemetria.mjs`), com permissão
0600, teto de 5 MB por dia e 14 dias de retenção. Só passam nome, duração, rede e
rótulo curto validado: nunca a fala nem o que possa carregar URL ou chave.
`npm run logs:celular` resume por medida e por rede.

**Voz em segundo plano** (revisto em 07/11/2026, ver abaixo). O modo `audio` de `UIBackgroundModes` deixa a voz seguir
com a tela bloqueada ou em outro app. Com isso o som pode seguir a rota do carro
quando o iOS a escolher, sem CarPlay nativo. A sessão fecha só por ociosidade ou
queda do backend; ao voltar ao app, religa o que tiver caído. A espera por ociosidade
continua valendo: o microfone não fica aberto para o Google sem ninguém falando.

**CarPlay nativo fica de fora** até haver conta paga e direito aprovado. Exigirá uma
tela própria com o modelo de voz da Apple e áudio nativo, porque a WebView não existe
no CarPlay.

**Latência.** Os primeiros logs (07/11/2026, Wi-Fi) mostraram ping de 10 ms e tarefas
de 23 s e 45 s, das quais a rede foi cerca de 0,1 s. Trocar o Tailscale direto por
outro caminho não melhora nada que se perceba, então ele fica. No celular, a voz
espera 700 ms de silêncio em vez de 1,2 s (`APOLO_CELULAR_SILENCIO_MS`), e o agente
usa esforço `low` (`APOLO_CELULAR_ESFORCO`). O PC não muda.

## Consequências
- Com 700 ms, uma pausa longa no meio da frase pode encerrar a sua vez de falar.
- Com esforço `low`, respostas de tarefas podem vir mais rasas.
- Dá para comparar Wi-Fi e dados móveis e isolar agente, rede e Google.
- O gateway aceita uma mensagem a mais, que só vira linha de log.
- O microfone na WebView em segundo plano tem relatos conflitantes no iOS, e a Apple
  não documenta esse caso: precisa ser validado no aparelho, no carro. Se falhar, o
  caminho é capturar o áudio em código nativo.
- Sem palavra de ativação no celular, depois da espera só um toque acorda, o que não
  serve ao volante. Falta decidir como acordá-lo dirigindo.
- O indicador laranja do iOS aparece com o app fora de vista enquanto o microfone
  estiver aberto.

## Revisão de 07/11/2026: voz só com o app na tela
No aparelho, minimizar deixava o indicador do microfone aceso sem que ele respondesse.
O Ricardo prefere usar o app só aberto. O modo `audio` saiu do `UIBackgroundModes`, e o
app desliga a voz ao ir para segundo plano e religa ao voltar. Ele não ouve mais com
a tela bloqueada nem em outro app, e o som do carro só vale com o app aberto. Para
abrir rápido: Tocar Atrás ou "E aí, Siri, Apolo", com um atalho que abre o app.
