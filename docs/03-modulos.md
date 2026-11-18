# 03 — Módulos plugáveis

> Status: **proposta**. É o contrato mais importante do projeto: tudo o que o
> A.P.O.L.O fará no futuro passa por aqui.

## O que é um módulo

Um módulo é uma pasta em `modules/<id>/` com:
1. um **manifesto** `apolo.module.json`;
2. um **servidor MCP** (Model Context Protocol) que expõe ferramentas;
3. opcionalmente, **painéis** para o HUD e **tarefas agendadas**.

Usar MCP como base significa que um módulo pode ser escrito em **qualquer
linguagem** (TypeScript, Python, C#...) e rodar **local ou remoto** (stdio ou
HTTP). Servidores MCP prontos da comunidade também podem virar módulos só com
um manifesto.

## Manifesto (rascunho v1)

```json
{
  "apolo": "1",
  "id": "agenda",
  "nome": "Agenda",
  "versao": "0.1.0",
  "descricao": "Consulta e organiza compromissos.",
  "servidor": {
    "tipo": "stdio",
    "comando": "node",
    "args": ["dist/server.js"]
  },
  "permissoes": {
    "padrao": "negado",
    "ferramentas": {
      "listar_eventos": "livre",
      "criar_evento": "confirmar",
      "apagar_evento": "confirmar"
    }
  },
  "segredos": ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  "eventos": { "publica": ["agenda.evento_proximo"], "assina": [] },
  "agendamentos": [{ "id": "sincronizar", "cron": "*/15 * * * *" }],
  "provedor_preferido": null
}
```

`servidor.tipo` pode ser `stdio` (processo local) ou `http` (módulo remoto, ex.:
automação residencial rodando em outra máquina).

## Ciclo de vida

`descoberto → validado → habilitado → iniciado → (falhou → reiniciando) → parado`

- Manifesto inválido ou versão de contrato incompatível: o módulo **não carrega**,
  e o core segue normalmente (RNF-07).
- Segredo ausente: o módulo carrega como **indisponível** e o painel de status diz o porquê.
- O usuário habilita e desabilita módulos sem reiniciar o core.

## Permissões

- O manifesto **sugere** o nível de cada ferramenta; a configuração do usuário
  **decide** (e pode endurecer, nunca afrouxar sem ação explícita).
- Ferramenta não listada assume `permissoes.padrao`, que por padrão é `negado`.
- Toda chamada `confirmar` gera um pedido no canal ativo, com resumo legível;
  sem resposta em X segundos, é negada.
- Toda ação com efeito vai para a auditoria (RF-13).

## Eventos (base do "Preditivo")

Módulos publicam eventos (`agenda.evento_proximo`, `email.importante`) e o core
os distribui. O módulo de briefing, por exemplo, só assina eventos de outros
módulos: não depende deles diretamente.

## Checklist para criar um módulo
- [ ] Aparece como linha própria na aba SISTEMAS, com estado (RF-56, ADR 0018)

1. Copiar `modules/_exemplo/` (será criado na Fase 1).
2. Preencher o manifesto; ferramentas com efeito ficam em `confirmar`.
3. Implementar o servidor MCP; nomes de ferramenta em `snake_case`, verbos claros.
4. Declarar segredos no manifesto e documentá-los no README do módulo.
5. Registrar o módulo em `docs/01-requisitos.md` e, se houver decisão nova, em uma ADR.

## Extensões plugáveis (ADR 0033)

Nem tudo precisa ser um módulo MCP ou um serviço com porta. Uma interface na tela,
um algoritmo ou uma função que a voz chama é uma **extensão plugável**: uma pasta em
`extensoes/<id>/`, ligada e desligada com o A.P.O.L.O. no ar, sem recompilar. Trocar
a pasta troca a extensão. A primeira é o A.T.L.A.S., o mapa (`extensoes/atlas/`).

```json
{
  "apolo": "1",
  "id": "atlas",
  "nome": "A.T.L.A.S.",
  "versao": "0.1.0",
  "descricao": "O globo de pontos.",
  "interface": "interface.js",
  "icone": "icone.svg",
  "ferramentas": [
    { "nome": "mapa", "permissao": "livre", "descricao": "…", "parametros": { "type": "object", "properties": {} } }
  ],
  "instrucoes": "Quando a voz deve usar a ferramenta, em poucas frases."
}
```

- `interface.js` é um ES module de **um arquivo só**, sem `import`, que exporta
  `ativar(apolo)` e pode devolver uma função de desligar. O three.js vem em
  `apolo.THREE`; dados e imagens, por `apolo.arquivo('nome')`.
- A API (`ApiDaExtensao`, em `src/lib/plugaveis.ts`) é o contrato inteiro: `ferramenta`,
  `camada`, `cor`, `nucleo`, `ao`, `descreverTela`, `log`. Mexer em outra coisa quebra
  na próxima versão.
- Só ferramentas `livre` por enquanto: efeito no mundo exige o gate, que ainda não
  chega às extensões. O manifesto que pedir outra permissão não carrega.
- Nome de ferramenta igual a uma do core ou de outra extensão não carrega.
- A ponte lê os manifestos e serve os arquivos (`bridge/plugaveis.mjs`), mas não
  executa nada da extensão. As ferramentas novas valem na próxima sessão de voz.
- Pasta começando com `_` ou `.` fica de fora (rascunho).

Checklist: manifesto válido, um arquivo de interface, ferramentas livres com descrição
clara, a linha na aba SISTEMAS (automática, com o `nome` do manifesto e o `icone`, um
`.svg` de traço em 24 × 24 como os de `src/ui/icones.tsx`), um README na pasta, RF e
ADR se houver decisão nova.

## Comunicação entre dispositivos

Módulos poderão levar mensagens entre celular, servidor e web pelo ponto de extensão
de `bridge/extensoes.mjs` (ADR 0022). Ele só transporta: o que uma mensagem mandar
fazer passa pelo gate, com as mesmas permissões de qualquer ferramenta.
