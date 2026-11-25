# ADR 0036 — A fala marcada do lado de cá

- **Status:** aceita
- **Data:** 2026-11-24

## Contexto
A surdez da ADR 0035 tinha causa: o detector automático de fala do Gemini Live. Em
24/11/2026, com a mesma gravação, três frases por sessão e a configuração do projeto, o
3.8 respondeu 0 de 12 com o detector dele (sensibilidade, tamanho dos blocos, ruído e
retomada não mudaram isso) e 30 de 30 com `activityStart` e `activityEnd` enviados por nós,
com transcrição correta. O 3.1 falhou igual; o 2.5 ouvia, mas transcrevia mal.

## Decisão
`src/lib/voz/detectorDeFala.ts` decide o começo e o fim pelo volume, com piso adaptado ao
ruído da sala, e o cliente desliga o detector do Google ao abrir a sessão. Só a fala sobe,
com 480 ms de antes; o silêncio da sala não. O silêncio que encerra a fala continua vindo
da ponte. Fechar o microfone encerra a fala aberta, e a resposta não se perde. Falar por
cima dele abre a fala e o interrompe, como antes.

## Consequências
- Decide por volume, e não por reconhecer voz: um barulho alto e longo vira fala, e o
  modelo a ignora (`ignorar_fala`). Uma fala sem pausa fecha em 30 s.
- Voz muito baixa ou distante pode não abrir; os limites estão no topo do arquivo.
- A recuperação da ADR 0035 fica como segunda linha de defesa.
- Vale para o app do iPhone só depois de recompilado; o já instalado segue como estava.
