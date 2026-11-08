# 06 — Ambiente mobile (iPhone + Android)

App em React Native + Expo (TypeScript), compilado como projeto nativo.
Ambiente do Ricardo: macOS 26.5.2 (Intel), Xcode instalado, iPhone e celular Android.

## 1. Base (uma vez)

Caminho recomendado: dar dois cliques em `scripts/setup-mobile.command`
(Node, CocoaPods, Xcode e o projeto `apps/mobile`; pode rodar de novo sem risco).

> **Intel + macOS 26:** o Homebrew não tem mais binários prontos e `brew install
> cocoapods` tentaria compilar LLVM/Ruby por horas. O script instala o CocoaPods
> em `~/.gem/apolo` usando o Ruby moderno que vem embutido no Homebrew
> (`portable-ruby`). O comando `pod` usa o `ruby` do PATH, então o `~/.zshrc`
> precisa ter, **antes** do `/usr/bin`:
>
> ```bash
> export GEM_HOME="$HOME/.gem/apolo"
> export PATH="$GEM_HOME/bin:$PATH"
> export PATH="/usr/local/Homebrew/Library/Homebrew/vendor/portable-ruby/current/bin:$PATH"
> ```

Manual, em máquinas onde o Homebrew funciona normalmente:

```bash
# Homebrew (se ainda não tiver): https://brew.sh
brew install node watchman cocoapods
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
xcodebuild -version          # confirmar
```

No Xcode: **Settings → Components** → instalar a plataforma **iOS** (simulador e SDK).

## 2. iPhone com Apple ID gratuito

1. Xcode → **Settings → Accounts → +** → entrar com o Apple ID (cria o *Personal Team*).
2. iPhone no cabo → confiar no computador.
3. iPhone: **Ajustes → Privacidade e Segurança → Modo de Desenvolvedor** → ativar e reiniciar.
4. Rodar o app (passo 4). Na primeira instalação: **Ajustes → Geral → VPN e
   Gerenciamento de Dispositivos** → confiar no seu certificado.

Limites da conta gratuita: app expira em 7 dias (reinstalar pelo Xcode), até 3
apps, sem push e sem Siri. Bundle id do projeto (iOS e Android): `com.ricardocruz.apolo`, definido em `apps/mobile/app.json`. Mudá-lo depois faz o aparelho tratar o app como outro.

## 3. Android (celular físico)

1. Instalar o **Android Studio** → no primeiro uso, aceitar o SDK padrão.
   Em **SDK Manager**, garantir Android SDK Platform e Build-Tools recentes.
2. No `~/.zshrc`:
   ```bash
   export ANDROID_HOME="$HOME/Library/Android/sdk"
   export PATH="$PATH:$ANDROID_HOME/platform-tools"
   export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
   ```
3. Celular: **Configurações → Sobre o telefone → tocar 7× em "Número da versão"**
   → em **Opções do desenvolvedor**, ativar **Depuração USB**.
4. Conectar no cabo e aceitar a chave RSA no celular. Conferir: `adb devices`.

## 4. Criar e rodar o app de teste

```bash
cd ~/Projetos/apolo/apps
npx create-expo-app@latest mobile --template blank-typescript
cd mobile
npx expo run:ios --device        # escolhe o iPhone conectado; compila no Xcode
npx expo run:android --device    # instala no Android conectado
```

`run:ios` gera a pasta `ios/`. Se a assinatura falhar, abra
`ios/*.xcworkspace` no Xcode → **Signing & Capabilities** → Team = *Personal
Team*, ajuste o Bundle Identifier e rode pelo botão ▶.

## 5. Usar o app fora do Wi-Fi (ADR 0019)

Uma vez, nesta ordem:

1. Instale o **Tailscale** pela App Store no Mac e no iPhone e entre com a mesma
   conta nos dois. Não use `brew install tailscale`: no Intel + macOS 26 ele tenta
   compilar por horas.
2. `npm run celular`. Ele gera o token no `.env.local`, publica o gateway e copia
   o código de pareamento. Na primeira vez, o Tailscale mostra um link para ativar
   o HTTPS: abra, ative e rode de novo.
3. `npm start` (reinicie se já estava rodando).
4. Instale a versão **Release**, que leva o código dentro do app. A de
   desenvolvimento depende do Metro no Mac e só abre na mesma rede:
   ```bash
   cd apps/mobile
   npm run ios -- --device --configuration Release
   ```
   Use `npm run ios`, e não `npx expo run:ios`: ele recompila antes os popups
   (`npm run popups`), que vêm dos componentes da web e não vão para o Git.
5. No app, cole o código e toque em **CONECTAR**. Pressionar o estado, no alto à
   direita, apaga o pareamento.

No dia a dia: Mac acordado com `npm start` rodando e Tailscale ligado no iPhone.
Para o Mac não dormir na tomada: **Ajustes do Sistema → Bateria → Opções →
Impedir suspensão automática quando a tela estiver desligada**.

Para instalar pelo Wi-Fi, sem cabo: Xcode → **Window → Devices and Simulators**,
com o iPhone no cabo, marcar **Connect via network**.

## Problemas comuns

| Sintoma | Solução |
|---|---|
| `No profiles for ... were found` | Escolher o Personal Team em Signing & Capabilities |
| "Desenvolvedor não confiável" no iPhone | Confiar no certificado (passo 2.4) |
| `pod install` falha | `cd ios && pod install --repo-update` |
| `pod`: `Could not find 'securerandom'` (Ruby 2.6) | O Ruby do sistema está na frente: colocar o `portable-ruby` no PATH (seção 1) |
| `incompatible ... libruby.2.6.dylib ... nkf.bundle` | Extensão compilada no Ruby antigo: `gem pristine nkf --extensions` (com o Ruby novo no PATH) |
| `No profiles for 'com.ricardocruz.apolo'` / `pass -allowProvisioningUpdates` | Conferir `ios.appleTeamId` no `app.json` (Personal Team) e compilar uma vez com `xcodebuild -workspace ios/APOLO.xcworkspace -scheme APOLO -destination id=<UDID> -allowProvisioningUpdates -allowProvisioningDeviceRegistration build`; o Xcode cria certificado e perfil |
| `invalid code signature ... not been explicitly trusted` ao abrir | Confiar no certificado no iPhone (passo 2.4) |
| iPhone aparece como *Offline* no `xctrace` | Desbloquear, confiar no Mac e manter no cabo; o Modo de Desenvolvedor precisa estar ativo |
| `adb devices` vazio | Trocar o cabo/porta, reativar Depuração USB, aceitar a chave RSA |
| App sumiu do iPhone após 7 dias | Em `apps/mobile`, rodar `npm run ios -- --device --configuration Release` de novo |
| Falta `popups.gerado` ao compilar ou no `tsc` | `npm run popups` na raiz |
| Círculo não aparece no simulador | Abrir a janela do Simulator e esperar: no Intel, o shader roda na CPU, a cerca de 1 quadro por segundo |
| App mostra DESCONECTADO | Tailscale ligado no iPhone? Mac acordado? `npm start` rodando e reiniciado depois de atualizar o código? Em `tailscale serve status`, a porta 8788 aparece? |
| App pede o código de novo: "O Mac recusou este token" | O token mudou no `.env.local`: rode `npm run celular` e pareie de novo |
| Ele não ouve | Ajustes → A.P.O.L.O → Microfone. Em espera, diga "Apolo" ou toque na tela |

## Logs e uso no carro

O app manda as medições ao Mac pelo próprio canal, em casa ou fora, e `npm run logs:celular`
resume (`-- 7` para sete dias, `-- 1 --eventos` para ver quedas). Os arquivos ficam em
`~/.apolo/logs`. Mudar `app.json` ou instalar pacote nativo exige `npx expo prebuild
--platform ios --no-install`, `pod install` e nova compilação.

No CarPlay o A.P.O.L.O. não aparece como app (ADR 0020). Ele só ouve com o app na
tela: ao minimizar, a voz desliga e o indicador do microfone some. Com o iPhone ligado
ao carro, a rota de áudio é escolhida pelo iOS.

Para abrir rápido: no app Atalhos, crie um atalho "Apolo" com a ação **Abrir App** →
A.P.O.L.O.; em **Ajustes → Acessibilidade → Toque → Tocar Atrás**, escolha esse atalho.
"E aí, Siri, Apolo" também passa a abri-lo.
