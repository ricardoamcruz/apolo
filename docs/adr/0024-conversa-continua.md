# ADR 0024 — Conversa contínua depois do nome

- **Status:** proposta
- **Data:** 2026-11-07

## Contexto
Com o A.P.O.L.O. aberto, ele se intromete quando o Ricardo fala com outra pessoa ou
quando a TV está ligada. O Ricardo quer conversar de forma natural, sem dizer o nome
a cada frase.

Até aqui, só o modelo decidia se uma fala era para ele (`ignorar_fala`, ADR 0017), e
isso falha com TV e com outras vozes. Havia também um defeito: qualquer voz ouvida
zerava os 90 s da espera, então com a TV ligada ele nunca descansava. No celular, a
espera só acabava com um toque.

Outras camadas foram avaliadas. Olhar para a tela como gatilho foi recusado pelo
Ricardo, porque exige a câmera sempre ligada. Reconhecer a voz dele (verificação de
falante local) fica para depois, se a TV ainda incomodar.

## Decisão
1. **Janela de conversa de 20 s** (`src/lib/conversa.ts`), na web e no celular. O nome
   abre a conversa, e ela segue sem repeti-lo. Só uma resposta dele ou uma tarefa
   reabre a janela. Ouvir alguém, a TV ou uma fala ignorada não reabrem. Sem nada
   dirigido a ele por 20 s, ele volta à espera. Substitui os 90 s de ociosidade.
2. **Prorrogação única de 8 s** se o prazo vencer com alguém falando ou com a
   resposta saindo: assim ele não dorme no meio de uma frase, mas a TV não o segura
   acordado para sempre.
3. **Nome no celular.** Em espera, o microfone segue aberto para o Gemini, mas a
   sessão fica muda (`silenciar`): nada do que ele disser toca, e as ferramentas são
   ignoradas. Se a frase fechada tiver o nome, pela mesma regra do PC
   (`chamouPeloNome`), a resposta toca e a conversa recomeça. O toque continua
   acordando.
4. **TV, vídeo, rádio e música** entram explicitamente no `ignorar_fala`.

## Consequências
Ele entra em espera bem mais vezes, e depois de uma pausa longa é preciso dizer o
nome de novo. Com a TV ligada, ele dorme depois de 20 a 28 s e só volta pelo nome.

No celular, em espera, o áudio da sala segue indo ao Google enquanto o app está na
tela, e o modelo segue gerando respostas que ninguém ouve, o que gasta cota. Isso
termina ao minimizar o app (revisão da ADR 0020). No PC nada muda: em espera só o
reconhecedor do Chrome ouve.

A decisão sobre o nome no celular depende de a transcrição chegar antes do áudio da
resposta, como o cliente do Gemini já faz. Precisa ser validada no aparelho.
