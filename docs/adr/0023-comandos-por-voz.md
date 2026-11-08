# ADR 0023 — Comandos por voz para todas as teclas

- **Status:** proposta
- **Data:** 2026-11-07

## Contexto
O RF-20 pede que todo atalho de teclado também funcione por voz: `Espaço`, `Esc`,
`G`, `D`, `[`, `]`, `E` e `X`. Pede também que o A.P.O.L.O. explique os comandos
quando o Ricardo esquecer. Faltavam três coisas: alternar, ampliar e fechar um popup
só; ligar o modo mãos; cancelar a tarefa sem entrar em espera. Havia ainda um defeito:
com três ou mais popups, `]` e `[` só alternavam entre dois.

Duas restrições pesaram:
- **Cancelar não pode depender do modelo.** O Gemini Live espera a resposta da
  ferramenta antes de continuar, então não chamaria uma ferramenta de cancelar
  enquanto `executar_tarefa` ainda roda. A transcrição da fala continua chegando.
- **A câmera só liga por ordem explícita** (RF-20). O modelo pode ser induzido por um
  texto vindo de uma ferramenta; a transcrição do microfone, não (como na ADR 0011).

## Decisão
1. **Uma lista só de comandos**, em `bridge/comandos.mjs`, com tecla, ação, exemplos
   de fala e se vale no celular. Ela entra nas instruções da voz para que ele saiba
   explicar os comandos, e o teste falha se uma tecla ficar sem comando.
2. **Popups por `ajustar_interface`**: o campo `popups` ganha `proximo`, `anterior`,
   `tela_cheia`, `sair_tela_cheia` e `fechar`, que agem sobre o da frente. As teclas e
   a voz chamam a mesma função (`src/lib/comandosDePopup.ts`), na web e no celular.
   Alternar segue a ordem de abertura (`src/lib/ordemDosPopups.ts`), que não muda.
3. **Modo mãos por `ajustar_interface`** com `modo_maos`. Desligar é direto. Para
   ligar, a interface confere se a fala dos últimos 20 s pediu mãos, gestos ou
   câmera; se não pediu, a câmera fica desligada. Só no PC.
4. **Diagnóstico completo** por `diagnostico` com `detalhes`, o mesmo que a tecla `D`.
5. **Cancelar pela transcrição** (`src/lib/comandos.ts`): durante uma tarefa, uma
   frase que seja inteira uma ordem ("cancela", "cancela a tarefa", "deixa pra lá")
   cancela depois de 0,9 s sem a frase continuar. Assim "cancela a reunião" chega ao
   agente como pedido. No celular, o app manda `interrupt` pelo canal que já existe.
6. **Interromper a fala** continua sendo falar por cima. Se a fala for só "para",
   "chega" ou "silêncio", o modelo usa `ignorar_fala` e fica quieto. Acordar segue a
   ADR 0017: o nome no PC e o toque no celular.

## Consequências
Cada tecla nova precisa de uma linha na lista; o teste cobra. As instruções da voz
ficam mais longas, cerca de dez linhas.

Cancelar depende de o Google mandar a transcrição enquanto a ferramenta está
pendente. Isso só se confirma por voz, no Mac e no iPhone. Se não vier, o caminho é
ouvir a ordem pela Web Speech API durante a tarefa, como em espera. Um "para"
dito a outra pessoa durante uma tarefa também cancela: é o mesmo risco do `Esc`,
sem efeito além de interromper o agente.
