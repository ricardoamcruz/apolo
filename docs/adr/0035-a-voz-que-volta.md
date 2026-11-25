# ADR 0035 — A voz que volta sozinha

- **Status:** aceita
- **Data:** 2026-11-24

## Contexto
Em 24/11/2026 o A.P.O.L.O. ficou sem responder com todos os processos de pé. O Google
abria a sessão de voz, recebia o áudio e não devolvia nada: em testes sem navegador,
0 de 6 falas respondidas por áudio, contra 6 de 6 por texto. Depois, duas aberturas
falharam (12 s sem confirmação). Nada tentava de novo: a página ia para a espera, a
ponte contava a sessão surda como "ligada", e a Fênix só anotava "falhando". Havia
ainda duas janelas, o Safari e o Chrome, e o aviso só aparecia na aba SISTEMAS.

## Decisão
1. **Religar sempre:** na partida, ao acordar e quando a sessão acaba, com espera de
   1 s até 30 s (5 min se a cota acabou). A cada duas falhas, o modelo de reserva.
2. **Surdez** (`src/lib/voz/surdez.ts`): duas frases inteiras sem nenhum
   sinal, 10 s depois da primeira. Conta o fim da frase, porque o 3.8 não manda nada
   enquanto ela dura. Primeiro
   outra conexão na mesma conversa; depois os modelos de `APOLO_GEMINI_RESERVAS`.
3. **Por texto:** acabados os modelos, o reconhecedor do navegador transcreve e a frase
   vai como texto. O áudio ganha outra chance a cada 10 min. A transcrição alimenta a
   mesma conferência da fala (`registrarFala`): nenhuma trava muda. A fala passa a ir ao
   serviço de reconhecimento do navegador também na conversa; antes, só na espera.
4. **A Fênix age** (`fenix/src/voz.mjs`): voz ruim por 1 min recarrega a página; mais
   90 s, reabre a janela (`saude.reabrir` no `fenix.config.json`); mais 90 s, avisa. Um
   degrau de cada por episódio, que recomeça depois de 30 min. Janela fechada de
   propósito não é reaberta, e surdez só avisa. A página não recarrega durante uma tarefa.
5. **Uma voz por vez** (`bridge/donaDaVoz.mjs`): a da janela que assumiu por último. As
   outras só mostram a tela; Espaço traz a voz.
6. **Visível:** `avisoDeVoz` fica sempre na tela, e os passos da voz vão para
   `~/.apolo/logs/voz-AAAA-MM-DD.log` (14 dias), sem o que foi dito.

## Consequências
- O reserva padrão (`gemini-2.5-flash-native-audio-latest`) transcreve mal: com ele,
  cancelar e confirmar por voz podem não funcionar, sempre para o lado seguro.
- Um barulho que pareça fala e não gere retorno reabre a sessão, no máximo duas vezes
  antes de ir para o texto.
- Por texto não dá para falar por cima dele: Espaço interrompe.
- No celular valem só o religar da conexão caída e a retomada; sem reservas nem texto.

## Revisão (24/11/2026)
A primeira versão da surdez contava desde o começo da fala e disparou sete vezes em cinco
minutos, com o Google ouvindo. Pior: a recusa da retomada ("BidiGenerateContent…") era lida
como falta de cota, por causa do "rate" de "Generate", e a conversa inteira caía. Agora
conta frases inteiras, pede duas, a primeira recuperação é calada e na mesma conversa, e
o modelo de reserva volta ao principal depois de 10 min, com o microfone fechado.
