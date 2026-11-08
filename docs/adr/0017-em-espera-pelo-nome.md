# ADR 0017 — Em Espera: acordar pelo nome e não se intrometer

- **Status:** aceita
- **Data:** 2026-11-06

## Contexto
O Ricardo quer colocar o A.P.O.L.O. Em Espera por voz e que, nesse estado, ele só
responda quando chamado pelo nome. Também quer que ele não comece a processar
antes de a frase acabar e que não responda quando a conversa for com outra pessoa.
Até aqui a espera acordava com Espaço ou palmas, e a detecção de fim de fala era a
mais apressada possível: 500 ms de silêncio com sensibilidade alta.

## Decisão
1. **Em Espera é a fase `dormant`.** Esc, ociosidade (20 s sem nada dirigido a ele
   desde a ADR 0024) e a ferramenta `dormir` caem
   no mesmo estado. Por voz, `dormir` também cancela a tarefa em andamento, como o
   Esc. Distinguir "boa noite" de despedida e de cumprimento fica com o modelo, que
   tem o contexto da conversa.
2. **O nome é ouvido pela Web Speech API do navegador** (`src/lib/chamada.ts`), só
   em espera. O microfone do modelo de voz segue fechado. É gratuita (regra 6) e
   não exige modelo local. O nome tem de abrir ou fechar a frase: falar do Apolo
   não o acorda. O que vier junto com o nome vira o primeiro pedido. Revisão de
   07/11/2026: o nome sozinho acorda quando o trecho provisório fica 400 ms sem
   continuar (`NOME_ESTAVEL_MS`), sem esperar o Chrome fechar a frase. Esperar
   custava cerca de um segundo. Nome com pedido ainda espera a frase inteira.
3. **Palmas não acordam mais da espera,** para que só o nome acorde por voz. Espaço
   continua, por ser um gesto deliberado. Em navegador sem a API, as palmas voltam.
4. **Fim de fala mais paciente:** 1200 ms de silêncio
   (`APOLO_REALTIME_SILENCIO_MS`) e sensibilidade baixa no início e no fim da fala.
5. **A ferramenta `ignorar_fala`** é como o modelo fica calado: fala com outra
   pessoa ou frase pela metade. Sem ela, o Gemini sempre responde algo. A resposta
   que ainda vier nessa vez é descartada na interface, sem som nem texto.

## Consequências
Cada resposta começa cerca de 0,7 s mais tarde; é o preço de não cortar quem pausa.

Em espera, o Chrome envia o áudio ao serviço de reconhecimento do Google enquanto
escuta. O A.P.O.L.O. só recebe o texto e só age sobre o nome. Não funciona offline
nem fora dos navegadores com a API; o caminho sem essas limitações é um detector
local de palavra de ativação, a avaliar quando houver canal fora do Chrome.

Reconhecer que a conversa é com outra pessoa é um julgamento do modelo sobre o
contexto, e não uma garantia: a voz não é identificada. Vai errar às vezes, tanto
respondendo quanto ficando quieto. Identificar o falante fica para uma ADR futura.
