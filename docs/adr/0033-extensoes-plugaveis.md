# ADR 0033 — Extensões plugáveis, sem recompilar

- **Status:** aceita
- **Data:** 2026-11-17

## Contexto

Nem tudo o que o A.P.O.L.O. vai ganhar é um serviço. A F.Ê.N.I.X., o H.E.R.M.E.S. e
a A.U.R.O.R.A. são processos à parte, com porta, token e `/saude` (ADR 0025 e
0029), e os módulos de domínio serão servidores MCP (ADR 0005). Mas muita coisa é
menor: uma interface na tela, um algoritmo, uma função que a voz chama. Para essas,
um processo próprio é peso sem ganho.

O pedido do Ricardo, ao começar o mapa: trocar uma extensão por outra só trocando a
pasta, **sem recompilar o A.P.O.L.O. nem reiniciá-lo**. Se ele quiser outro mapa,
apaga a pasta do A.T.L.A.S. e põe a nova.

Três restrições moldam a resposta:

- A interface é compilada pelo Vite. Código que entra pelo build exige build.
- A política de segurança da página (`index.html`, sensível) só aceita script da
  própria origem ou de `blob:`.
- As ferramentas de voz são declaradas pela ponte (`bridge/realtime.mjs`) e
  executadas pelo navegador (`src/App.tsx`).

## Decisão

Uma **extensão plugável** é uma pasta `extensoes/<id>/` com:

- `apolo.extensao.json`: o manifesto (contrato `"1"`): `id` (igual ao nome da
  pasta), `nome`, `versao`, `descricao`, `interface` (o arquivo `.js`), `icone`
  (opcional: um `.svg` da pasta, desenhado na aba SISTEMAS como máscara, na cor do
  estado; sem ele, o losango na largura de um ícone), `ferramentas`
  (nome, descrição, parâmetros em JSON Schema e `permissao`) e `instrucoes` (até
  1.500 caracteres, que entram no texto do modelo de voz);
- o módulo da interface: **um arquivo só**, ES module, sem `import`, que exporta
  `ativar(apolo)` e pode devolver uma função de desligar;
- os dados que ele pede por `apolo.arquivo()`.

**A ponte** (`bridge/plugaveis.mjs`, sensível) lê e valida os manifestos, serve os
arquivos em `/extensoes/<id>/<arquivo>` (só tipos conhecidos, só de dentro da pasta,
com links resolvidos antes de julgar), entrega as ferramentas e as instruções à
sessão de voz do PC e vigia a pasta: a cada mudança, relê e avisa as interfaces. **A
ponte não executa código de extensão nenhum.**

**A interface** (`src/lib/plugaveis.ts`) baixa o módulo, importa como `blob:` e chama
`ativar` com a API. Na mudança, desliga a versão antiga (tudo o que ela registrou sai
junto) e liga a nova. Ferramentas novas valem a partir da próxima sessão de voz.

**A API** é o contrato, e só ela: o `THREE` do A.P.O.L.O. (o mesmo, não um segundo),
`arquivo`, `ferramenta`, `camada` (uma camada da tela entre a cena e o HUD, sem
toques por padrão), `cor` (a cor da interface, a contrastante, a terceira e um ouvinte
de troca), `localizacao` (a do Ricardo, só com o pedido na fala dele, conferido na
transcrição como o da câmera),
`nucleo` (geometria do Enxame na tela, `ceder` e `devolver`: com o núcleo cedido o
Enxame se apaga e a extensão desenha no lugar), `ao('espera' | 'limpar')`,
`descreverTela` (a frase que a voz recebe sobre o que está na tela) e `log`.

**Segurança.** Por enquanto, uma extensão só declara ferramentas `livre` (mostrar,
calcular, desenhar). O manifesto que pedir outra permissão não carrega, com o motivo
na aba SISTEMAS. Ferramenta com efeito no mundo exige o gate, e esse caminho será
uma ADR própria. Nome de ferramenta que já exista no core ou em outra extensão
também não carrega.

**Falha isolada (RNF-07).** Manifesto inválido, arquivo faltando ou `ativar` que
lança: a extensão fica de fora, com o motivo numa linha própria da aba SISTEMAS, e
o resto segue.

O celular não recebe extensões: o app não tem a tela onde elas desenham. A voz do
celular continua com a lista fechada da ADR 0030.

## Consequências

- Trocar, apagar ou acrescentar uma pasta em `extensoes/` muda o A.P.O.L.O. no ar.
  O A.T.L.A.S. (ADR 0034) é a primeira.
- O módulo é um arquivo só. Uma extensão grande precisa ser empacotada antes por
  quem a escreve; o A.P.O.L.O. não compila nada dela.
- A API cresce por ADR. Uma extensão que mexa em algo fora dela (o store, o DOM do
  HUD) quebra sem aviso na próxima versão.
- Fica a fazer: ferramentas com efeito pelo gate, extensões no celular e uma pasta de
  extensões fora do repositório (já dá por `APOLO_EXTENSOES_PASTA`).
- Ficam três ideias de "extensão" no projeto, com nomes diferentes: módulo de
  domínio (MCP, `modules/`), serviço independente (Fênix, H.E.R.M.E.S., Aurora) e
  extensão plugável (`extensoes/`). A tomada entre dispositivos (ADR 0022,
  `bridge/extensoes.mjs`) é outra coisa: transporte de mensagens.
