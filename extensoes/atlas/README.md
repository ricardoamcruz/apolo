# A.T.L.A.S. — o globo de pontos

Extensão plugável do A.P.O.L.O. (ADR 0033 e 0034). O núcleo vira um globo de pontos
e marca lugares no mundo: cidades, coordenadas e listas de lugares. Sem botões: voz,
mouse e toque.

## Pedidos por voz

- "Onde fica Tóquio?" · "Marque São Paulo." · "Marque menos 22,95, menos 43,21."
- "Mostre no mapa as capitais do Mercosul." (vários de uma vez)
- "Acrescente Lima." · "Enquadre todos." · "Aproxime." · "Afaste."
- "Mostre 5 cafeterias em Pinheiros." (de perto, as ruas e os bairros aparecem)
- "Onde eu estou?" (a sua localização, num ponto amarelo quando a interface é azul)
- "Limpe o mapa." · "Feche o mapa."

O mapa só fecha a pedido: "feche o mapa", Esc ou a espera pedida.

## De perto: a cidade

Abaixo de uns 280 km de raio, rodovias e litoral se montam em pontos; mais perto,
avenidas, rios e parques; de uns 16 km para baixo, as ruas de bairro, com os nomes das
cidades e dos bairros. Marcadores muito
juntos viram um grupo com a contagem até o zoom os separar.

## A sua localização

Só quando você pede ("onde eu estou?"): a extensão pede ao A.P.O.L.O., que confere a
sua fala na transcrição antes de ler a posição do navegador. O ponto fica na tela, na
terceira cor, com o círculo da precisão. A coordenada não vai na resposta à voz e não
é guardada.

## Mouse e toque

Arrastar gira (com inércia), a roda ou a pinça aproxima, toque ou clique duplo
reenquadra os marcadores. Com o modo mãos ligado, a pinça gira o globo.

## Arquivos

| Arquivo | O que é |
|---|---|
| `apolo.extensao.json` | o manifesto: a ferramenta `mapa` e as instruções para a voz |
| `interface.js` | o globo: um arquivo só, sem `import` (o three.js vem do A.P.O.L.O.) |
| `icone.svg` | o ícone da aba SISTEMAS (traço, usado como máscara na cor do estado) |
| `terra.bin` | a máscara de terra em bits, de duas esferas de Fibonacci |
| `ferramentas/gerar-terra.mjs` | gera o `terra.bin` |

## Dados

- **Continentes:** Natural Earth 1:50m, domínio público, pelo pacote `world-atlas`.
  Para gerar de novo, baixe `land-50m.json` (world-atlas 2.0.2) e rode
  `node extensoes/atlas/ferramentas/gerar-terra.mjs <caminho do land-50m.json>`.
- **Ruas, rios, parques e bairros:** blocos vetoriais do OpenFreeMap (© OpenMapTiles,
  © colaboradores do OpenStreetMap), decodificados num Web Worker e guardados no cache
  do navegador (`atlas-blocos-v1`, até 1.500 blocos).
- **Busca de lugares:** © colaboradores do OpenStreetMap (ODbL), pelo Nominatim
  (no máximo um pedido por segundo, a regra de uso dele) e pelo Photon, da komoot, de
  reserva. Só o nome do lugar sai da máquina; as respostas ficam em cache no navegador
  (`atlas:busca:v2`, até 500). O crédito aparece no rodapé do mapa quando a busca é usada.

## Trocar ou tirar

Apagar esta pasta tira o mapa; outra pasta com outro `id` põe outro. A ponte percebe
sozinha. A ferramenta nova vale a partir da próxima conversa.
