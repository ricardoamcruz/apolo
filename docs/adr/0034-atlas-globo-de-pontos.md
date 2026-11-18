# ADR 0034 — A.T.L.A.S., o globo de pontos

- **Status:** aceita
- **Data:** 2026-11-17

## Contexto

O primeiro objetivo do mapa: marcar qualquer lugar do mundo (cidade, coordenada ou
os lugares de uma pesquisa) com a cara do A.P.O.L.O.: pontos, a cor da interface e a
contrastante nos marcadores, sem botões, por voz, mouse e toque. Ele é a primeira
extensão plugável (ADR 0033).

O estudo e o protótipo ficaram fora do repositório, com o Ricardo. Dele saíram as
escolhas: o Enxame vira o globo, estilo "Enxame cheio" e marcador "farol", e pontos
espalhados pelo mundo mostram o globo inteiro, sem planificar.

## Decisão

**O nome.** A.T.L.A.S., o titã que carrega o mundo, da mesma mitologia de Apolo e
Hermes (ADR 0018).

**Os pontos.** Duas esferas de Fibonacci (160 mil e 640 mil pontos) filtradas por
uma máscara de terra do Natural Earth 1:50m (domínio público), gerada uma vez por
`extensoes/atlas/ferramentas/gerar-terra.mjs` em `terra.bin` (200 KB). De longe, a
camada leve (45 mil pontos de terra e um pouco de mar); de perto, a densa (179 mil).
A costa é um pouco mais clara. Sem textura, sem servidor de mapas, sem chave.

**O Enxame vira o globo.** Ao abrir, a extensão pede o núcleo: o Enxame se apaga em
meio segundo enquanto os pontos do globo surgem numa esfera do mesmo tamanho na tela,
cobrindo-a por igual e girando nas faixas do Enxame. Cada ponto desliza pela latitude
até o seu lugar, o giro morre ao pousar, e a câmera vai do tamanho do Enxame ao globo
inteiro. Ao fechar, o caminho inverso, e o Enxame volta enquanto os últimos pontos se
juntam. Tudo no shader: a CPU só avança um número por quadro.

**Desempenho.** O laço de desenho só roda com o mapa aberto ou em transição. As
camadas são montadas depois da partida e sobem para a placa de vídeo invisíveis, para
a primeira abertura não engasgar. A camada densa só é desenhada de perto. Densidade
de pixels até 2.

**O zoom.**
- Um lugar: uma calota do tamanho do lugar (pela caixa que a busca devolve), nunca
  menor que o contexto do tipo: cidade 6° (cerca de 700 km do centro à borda),
  estado 9°, país 16°, lugar 3°.
- Vários: o centro deles e a menor distância em que todos cabem, com margem para os
  rótulos; nunca mais perto que 2,5°, onde os pontos já não mostram chão.
- Espalhados por mais de um hemisfério: o globo inteiro, centrado no meio deles.
- O voo segue o grande círculo e se afasta em proporção ao caminho.

**A busca.** Pelo OpenStreetMap, no navegador: o **Nominatim** primeiro (ordena por
importância e devolve nomes em português: acerta "Brasília" e "Assunção", que o
Photon confundia com cidades menores), numa fila de um pedido por segundo, que é a
regra de uso dele; o **Photon** (komoot) de reserva. Cache local de 500 buscas. A
resposta à voz diz onde cada lugar foi achado, para ela corrigir um engano. O modelo
não inventa coordenadas: só manda `lat`/`lon` que o Ricardo falou. O texto da busca
(o nome do lugar) vai aos servidores do OpenStreetMap; nada mais. Os dados são do
OpenStreetMap (ODbL), e a leitura no rodapé mostra o crédito quando a busca foi usada.
O Google Maps exigiria chave e cobrança, contra a regra do gratuito por padrão.

**A voz.** Uma ferramenta, `mapa` (`livre`), com `acao`: `marcar`, `acrescentar`,
`limpar`, `abrir`, `fechar`, `enquadrar`, `aproximar`, `afastar`; `locais` (até 25,
sempre com o país) e `tipo` (cidade, estado, país, lugar, coordenada). O mapa só
fecha a pedido: "feche o mapa", Esc ou a espera pedida. Uma limpeza de tela não o
fecha, porque o agente de tarefas também limpa sozinho ao fim de um assunto (bug de
17/11/2026).

**Mouse e toque.** Arrastar gira, com inércia; roda ou pinça aproxima; toque ou
clique duplo reenquadra. Os gestos da câmera chegam como toque, então a pinça gira o
globo sem nada novo. Nenhum botão.

## Revisão de 17/11/2026: a camada de cidade e a localização

Depois do primeiro teste (bug 2: cinco cafeterias da mesma cidade ficaram empilhadas,
porque o zoom parava a 300 km), com estudo e protótipo aprovados pelo Ricardo:

- **A camada de cidade.** Abaixo de uns 280 km de raio na tela, entram rodovias e
  litoral (blocos de zoom 8); mais perto, avenidas, rios, água e parques; do zoom 13
  (uns 16 km) para baixo, as ruas de bairro. Vêm dos
  **blocos vetoriais do OpenFreeMap** (dados do OpenStreetMap, esquema OpenMapTiles,
  grátis e sem chave), a fonte mais rápida: um bloco chega em 0,4 s, contra 38 s do
  Overpass para uma região. O endereço da versão atual vem do índice
  (`tiles.openfreemap.org/planet`), guardado por um dia. Cada bloco fica no cache do
  navegador (até 1.500): voltar a uma região não baixa nada.
- **Nitidez e desempenho.** Os blocos são decodificados num Web Worker
  (`processarBloco`, função pura no fim de `interface.js`, testada com um bloco real),
  então a animação não engasga. Os pontos ficam num plano preso a uma âncora (o centro
  da região), em raios da Terra relativos a ela: precisão de centímetro, e a curvatura
  exata. Só os blocos da tela, do centro para fora; o zoom anterior só sai quando o
  novo cobriu a tela. O plano de corte da câmera acompanha a altura.
- **O rearranjo.** Cada ponto sai de um enxame solto no ar, na escala da tela, desce e
  se assenta na rua, no seu tempo. Brilho pela importância (via expressa e rio mais
  fortes, rua de bairro e parque mais fracos); nenhuma cor nova.
- **Os nomes dos lugares.** Em letra fina, na cor da interface: cidades de longe,
  bairros de perto, sem se encostar, até 18 na tela. O parêntese de desambiguação do
  OpenStreetMap sai do rótulo.
- **O zoom chega à rua.** Até uns 700 m de altura. Vários lugares: até uns 600 m de
  raio. Um "lugar" sozinho: uns 2,8 km. O voo anda no logaritmo da altura.
- **Grupos.** Marcadores a menos de 40 px um do outro viram um só, com a contagem e a
  categoria que a voz mandou ("5 cafeterias"); o zoom os separa.
- **A localização dele** (`mapa` com `minha_localizacao`): um ponto na **terceira cor**
  (`terceira()` em `src/lib/cor.ts`: 50° adiante da contrastante, a 130° da interface;
  azul, vermelho e amarelo), com o círculo da precisão no chão e o rótulo "Você". Só
  quando ele pede: a API `apolo.localizacao()` confere a fala dele na transcrição do
  microfone, como a câmera, e nunca depende só do modelo. A coordenada fica na tela: a
  resposta à voz (que vai ao provedor) não a leva, e nada a guarda. Base para as rotas.
- **Créditos.** Com a cidade na tela, o rodapé mostra © OpenFreeMap, © OpenMapTiles e
  © OpenStreetMap. Sem rede, diz "ruas indisponíveis agora".

## Consequências

- Rua e bairro entraram na revisão acima. Prédios ficam de fora: em pontos, viram
  uma massa sem leitura.
- Quais blocos ele vê revela a região olhada aos servidores do OpenFreeMap; a
  localização dele, em si, não sai da máquina.
- A janela em popup (a opção B do estudo) fica reservada para detalhar um ponto
  quando houver muitos, ou mostrar mais informações de um ponto escolhido.
- A primeira busca de uma lista longa leva um segundo por lugar (o globo se monta
  enquanto isso); as repetidas são instantâneas.
- Trocar o mapa é trocar a pasta `extensoes/atlas/`.
