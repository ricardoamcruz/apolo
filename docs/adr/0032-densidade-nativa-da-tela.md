# ADR 0032 — O reator desenhado na densidade real da tela

- **Status:** proposta
- **Data:** 2026-11-13
- **Complementa:** ADR 0013 (identidade visual), quanto à nitidez do núcleo

## Contexto
O canvas da cena 3D era criado com `dpr={[1, 2]}`: o buffer tinha, no máximo,
dois pixels por pixel de CSS. Num Mac Retina isso é a densidade da tela e a
imagem sai exata. Num iPhone, de densidade 3, o quadro saía com dois terços dos
pixels e o navegador o ampliava para compor a página — e ampliar uma imagem
feita de pontos de luz e linhas finas é justamente o que borra o enxame e o
halo de poeira.

A densidade também não é fixa durante a sessão: zoom do navegador e uma janela
arrastada para outro monitor a mudam, e não existe evento próprio para isso.

## Decisão
O teto da densidade passa a ser a densidade da própria tela, lida de
`window.devicePixelRatio` em `src/lib/densidade.ts`, fonte única para todo
canvas da web (o reator em `src/scene/Scene.tsx` e a mão desenhada em
`src/ui/Pointer.tsx`, para as duas camadas de vidro não terem resoluções
diferentes).

- **Teto de 3** (`DENSIDADE_MAXIMA`): a densidade de um iPhone Retina, a maior
  tela de verdade que ele encontra. Acima disso o ganho não se vê e o custo é
  real — o número de pixels cresce com o quadrado da densidade, e o bloom
  redesenha o quadro inteiro várias vezes.
- **Mínimo de 1** no `dpr` do r3f, para ele poder baixar a resolução sozinho se
  a cena engasgar.
- `aoMudarDensidade` observa a mudança por uma media query `(resolution: Ndppx)`
  refeita a cada troca, porque `resize` erra nos dois sentidos: girar o celular
  dispara `resize` sem mudar a densidade, e o zoom muda a densidade sem mudar a
  janela.

O círculo do app do iPhone não entra aqui: ele é nativo (`expo-gl`,
`apps/mobile/src/Cena.tsx`), não passa por navegador, e desenha de propósito com
metade dos pontos por lado (`REDUCAO`), porque ampliar suaviza o traço no lugar
do bloom e poupa bateria.

## Consequências
- No Mac nada muda: a densidade já era 2. Quem muda é a tela de alta densidade,
  que ganha nitidez e passa a desenhar mais pixels — se algum aparelho sentir,
  o lugar de tratar é `DENSIDADE_MAXIMA`, não um número solto no canvas.
- Canvas novo na web lê `densidadeDaTela()`; nunca `window.devicePixelRatio`
  direto, nem um teto escrito à mão.
- Falta validar no iPhone, com a interface web aberta no aparelho.
