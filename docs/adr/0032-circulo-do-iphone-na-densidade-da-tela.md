# ADR 0032 — O círculo do iPhone na densidade da tela

- **Status:** aceita (validada no iPhone pelo Ricardo em 15/11/2026)
- **Data:** 2026-11-14

## Contexto
Comparando prints da interface web e do app do iPhone, o Ricardo viu que no app
as partículas em órbita e os pontos do Enxame saem borrados, e quer a mesma
nitidez da web.

A causa estava em `apps/mobile/src/Cena.tsx`: o `GLView` tinha metade da largura
e da altura da tela (`REDUCAO = 2`) e era ampliado duas vezes por `transform`.
O quadro tinha um quarto dos pixels, e a ampliação espalhava cada ponto de luz.
A ADR 0019 (item 8) tinha escolhido isso de propósito: a ampliação fazia as vezes
do bloom e poupava bateria. Na prática, o efeito é o borrado que ele não quer.

Não era a web: a tentativa anterior (densidade do canvas da web, na
`fase-2.10/nitidez-de-cristal`, descartada) não mexia no app, que é nativo, por
`expo-gl`.

## Decisão
- O `GLView` ocupa a tela inteira, sem ampliação: o quadro sai na densidade da
  própria tela, como a web no Mac.
- Os tamanhos dos pontos (`uSize`) são multiplicados por `ESCALA_DOS_PONTOS = 2`.
  Os shaders medem o ponto em pixels do quadro, e os tamanhos tinham sido
  acertados para um quadro com metade dos pixels por lado; o dobro mantém cada
  ponto do mesmo tamanho na tela, em qualquer densidade de iPhone.
- O resto da cena fica igual: mesmos shaders, mesma contagem de pontos, 30
  quadros por segundo.

## Consequências
- Partículas e Enxame nítidos no iPhone, com o mesmo tamanho e brilho de antes.
- Revisa o item 8 da ADR 0019: a ampliação deixa de fazer as vezes do bloom, e o
  brilho suave que ela dava some junto com o borrado.
- O quadro tem quatro vezes mais pixels. A cena é leve (cerca de 3.400 pontos,
  sem pós-processamento) e roda a 30 quadros por segundo, mas o consumo de
  bateria e o aquecimento precisam ser observados no aparelho; se pesar, o
  caminho é baixar a contagem de pontos, não voltar a ampliar.
- Não volte a reduzir e ampliar o `GLView` para economizar: é isso que borra.

## Validação
- No simulador (iPhone 17 Pro), o quadro GL sai em 1206×2622, a densidade cheia
  da tela, e um recorte em pixel real ficou tão definido quanto a web no mesmo
  tamanho de tela.
- `ESCALA_DOS_PONTOS = 1.5` deixaria o ponto do tamanho exato da web, mas o
  círculo perde brilho, porque a web compensa com bloom; fica 2.
- O app do aparelho é Release, com o JavaScript embutido: mudança na cena só
  aparece no iPhone depois de reinstalar
  (`npx expo run:ios --configuration Release`).
