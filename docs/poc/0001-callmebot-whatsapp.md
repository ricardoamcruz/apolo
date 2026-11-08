# P.O.C. 0001 — Avisos pelo WhatsApp com o CallMeBot

- **Status:** a testar (pedido do Ricardo em 08/11/2026)
- **Requisito:** RF-65

## Objetivo

Saber se o CallMeBot serve para o A.P.O.L.O. (e a F.Ê.N.I.X.) mandarem avisos
curtos ao WhatsApp do Ricardo, de graça: "a versão nova quebrou e voltei para a
main", "a rotina do iPhone terminou", "o C.O.R.E. está degradado".

## Como o serviço funciona

- Uso pessoal e gratuito. O Ricardo adiciona o número do bot aos contatos e manda
  a mensagem de ativação que o site do CallMeBot indica; o bot responde com uma
  **chave de API** ligada ao número dele.
- Enviar é um `GET` HTTPS:
  `https://api.callmebot.com/whatsapp.php?phone=<número>&text=<texto em URL>&apikey=<chave>`.
- Só manda para o número que fez a ativação. Não recebe mensagens nem responde.

## Riscos conhecidos

- **Terceiro no meio:** o texto passa pelos servidores do CallMeBot e pode ser
  lido por eles. Nada de segredo, conteúdo de e-mail ou dado pessoal no aviso:
  só frases curtas de estado.
- **Sem garantia:** serviço gratuito, sem SLA; há limite de envio e atrasos.
  Aviso perdido não pode ser o único sinal de nada importante.
- **Não oficial:** não é a API da Meta. Pode parar a qualquer momento.

## Desenho proposto para o teste

- **Módulo, não core** (regra 2 do AGENTS.md): um sistema próprio, com nome no
  padrão da ADR 0018, que a F.Ê.N.I.X. ou o A.P.O.L.O. chamam.
- **Segredos só no `.env.local`:** `APOLO_WHATSAPP_NUMERO` e
  `APOLO_WHATSAPP_CHAVE`. A chave nunca vai a log: a URL inteira contém a chave,
  então o log registra só "aviso enviado" ou o código HTTP.
- **Destino fixo:** só o número configurado. Mandar para qualquer outro número
  passaria pelo gate de permissões, negado por padrão (regra 3).
- **Limite próprio:** no máximo um aviso por minuto e por assunto, para não
  estourar o limite do serviço nem virar spam.
- **Conteúdo:** até 300 caracteres, sem dados pessoais.

## O que medir

1. Tempo entre o envio e a chegada no celular (10 envios, rede de casa e 4G).
2. Quantos chegam de 10, e se chegam em ordem.
3. O que o serviço devolve quando a chave está errada ou o limite estoura.
4. Se a notificação do WhatsApp toca como mensagem comum (som e banner).

## Critério de aceite

9 de 10 avisos chegam em menos de 30 s, sem erro silencioso. Se falhar, as
alternativas avaliadas foram o bot do Telegram (gratuito e oficial) e uma conta
de WhatsApp num chip pré-pago com Baileys (gratuita, não oficial, risco de
bloqueio do chip).
