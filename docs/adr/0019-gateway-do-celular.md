# ADR 0019 — Gateway do celular e acesso fora de casa pelo Tailscale

- **Status:** proposta
- **Data:** 2026-11-06

## Contexto
O app do iPhone precisa mandar pedidos ao agente que roda no Mac, inclusive fora
do Wi-Fi de casa. A ponte (porta 8787) foi feita para uma página local: confia no
Origin e tem rotas sem autenticação (`/file`, `/media`, `/realtime/sessao`). O
Mac fica atrás do roteador, sem endereço público.

Um túnel público, como o Cloudflare Tunnel ou o ngrok, deixaria o agente a uma
URL de qualquer pessoa, protegido só pelo token. Abrir porta no roteador é pior.

## Decisão
1. **Tailscale como caminho de rede.** Mac e iPhone entram na mesma rede privada,
   sem porta aberta no roteador. `tailscale serve` entrega HTTPS com certificado
   real, que é o que dá `wss://` sem exceção de ATS no iOS. O plano pessoal é
   gratuito (regra 6).
2. **Uma porta só para o celular** (`bridge/gateway.mjs`, 8788, em `127.0.0.1`).
   Ela existe apenas com `APOLO_GATEWAY_TOKEN` e só tem o canal `/canal` e a mídia
   dos popups. É ela, e não a 8787, que o Tailscale publica: a superfície exposta
   é definida pelo que existe nessa porta, e não por uma checagem em cada rota.
3. **Token Bearer no aperto de mão**, gerado pelo `npm run celular`, guardado no
   `.env.local` e, no aparelho, no Keychain (`THIS_DEVICE_ONLY`). O Tailscale não
   substitui o token: outro aparelho da mesma conta não deve alcançar o agente só
   por estar na rede.
4. **O celular só conversa.** O gateway aceita `ask`, `interrupt` e `voz_sessao`.
   Autodev e preferências ficam no PC, onde há o botão Confirmar. As ferramentas
   passam pelo mesmo gate do HUD; as que dependem do navegador (câmera, ambiente,
   controle da interface) ficam fora da sessão do celular.
5. **Voz, como no PC.** Ele ouve e responde falando, sem conversa escrita na tela e
   sem barra de texto. Roda o mesmo `connectGemini` do browser, dentro da WebView
   (`src/lib/voz/celular.ts`), porque ela é um navegador com microfone. A página não
   tem o token: a credencial temporária e as tarefas passam pelo app, que fala com o
   gateway. Na voz do celular restam `executar_tarefa`, `ignorar_fala` e `dormir`.
   Em espera, um toque acorda, porque o reconhecimento do nome não existe no iOS.
   A voz fica desligada sem backend: ela conversaria e falharia em toda tarefa.
6. **Os mesmos popups, não uma imitação.** Eles mostram o que é visual, como no PC.
   `Panels` e `Blades` são compilados por
   `npm run popups` numa página única (`src/popups.tsx`), que vai dentro do app e
   roda numa WebView transparente sobre a cena. WebView porque o agente escreve
   HTML. Dentro do app, e não servida pelo Mac, para que o que roda no aparelho seja
   o que foi instalado.
7. **Mídia por chave no caminho.** A WebView não põe cabeçalho em `<img>` nem em
   `<iframe>`, então `/m/<chave>/{img,media,file,page}` se autentica por um HMAC do
   token. A chave libera só esses GETs, que têm as mesmas proteções da ponte, e
   nunca o agente: o canal continua exigindo o token.
8. **Mesma cena da web.** three.js sobre `expo-gl`, com os shaders em
   `src/scene/shaders.ts`, sem cópia. Bloom fica de fora: o custo no celular não
   compensa, e a ampliação da imagem faz parte desse papel. O círculo flutua no
   centro da tela.

## Consequências
- O Mac precisa estar ligado, acordado e com o A.P.O.L.O. rodando, e o Tailscale
  ativo nos dois aparelhos. Com `--writes`, um pedido pelo celular age no mundo
  sem confirmação, como pelo PC: a confirmação por canal é o RF-05.
- A conexão ainda é a sessão. O iOS suspende o app em segundo plano, então sair
  do app no meio de uma tarefa a interrompe e a memória da conversa se perde.
  Manter a sessão no Mac entre conexões é o próximo passo natural.
- **CONECTADO** significa que o backend respondeu há pouco: o app manda um ping a
  cada 6 s, e sem resposta mostra **DESCONECTADO** na cor de `contrastante()`.
- A voz só com Gemini: a OpenAI, por WebRTC, não foi levada ao celular.
- `popups.gerado.ts` não vai para o Git: `npm run ios`, em `apps/mobile`, o recria.
- No simulador de Mac Intel, o shader roda na CPU, a cerca de 1 quadro por segundo.
  O desempenho real só se mede no aparelho.
- O protocolo ainda é o do HUD, sem versão: RNF-11 continua aberto.
- Sem push (exige conta Apple paga) e, na conta gratuita, o app expira em 7 dias.
- Quando o core for para um servidor (Fase 4), o gateway muda de endereço com
  `APOLO_GATEWAY_HOST`, e o app só precisa de um código de pareamento novo.
