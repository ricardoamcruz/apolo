#!/bin/bash
# A.P.O.L.O — prepara o ambiente mobile (iPhone + Android) no macOS.
# Seguro para rodar mais de uma vez. Ver docs/06-ambiente-mobile.md
set -u
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
azul(){ printf "\n\033[1;34m== %s ==\033[0m\n" "$1"; }
ok(){ printf "\033[1;32m✓ %s\033[0m\n" "$1"; }
aviso(){ printf "\033[1;33m! %s\033[0m\n" "$1"; }

azul "1/5 Node.js (>= 20)"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
NODE_MAJOR=$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/')
if [ -n "${NODE_MAJOR:-}" ] && [ "$NODE_MAJOR" -ge 20 ]; then
  ok "Node $(node -v) já instalado"
else
  echo "Instalando Node LTS via nvm (binário pronto, sem compilar)..."
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  . "$NVM_DIR/nvm.sh"
  nvm install --lts && nvm alias default 'lts/*'
  ok "Node $(node -v)"
fi

azul "2/5 CocoaPods (iOS)"
# Homebrew não suporta mais Intel + macOS 26: compilaria LLVM/Rust/Ruby (horas).
# Usamos o Ruby do sistema com instalação no usuário (sem sudo, sem compilar LLVM).
export GEM_HOME="$HOME/.gem/apolo"; export PATH="$GEM_HOME/bin:$PATH"
grep -q 'gem/apolo' "$HOME/.zshrc" 2>/dev/null || printf '\nexport GEM_HOME="$HOME/.gem/apolo"\nexport PATH="$GEM_HOME/bin:$PATH"\n' >> "$HOME/.zshrc"
# O Ruby do macOS (2.6) é velho demais para o CocoaPods atual. O próprio Homebrew
# traz um Ruby moderno pronto ("portable-ruby"); usamos ele, sem compilar nada.
# O `pod` roda com o `ruby` do PATH, então esse Ruby precisa vir antes do /usr/bin.
PRUBY=""
for d in "$(brew --repository 2>/dev/null)/Library/Homebrew/vendor/portable-ruby/current/bin" \
         /usr/local/Homebrew/Library/Homebrew/vendor/portable-ruby/current/bin \
         /opt/homebrew/Library/Homebrew/vendor/portable-ruby/current/bin; do
  [ -x "$d/ruby" ] && PRUBY="$d" && break
done
if [ -n "$PRUBY" ]; then
  export PATH="$PRUBY:$PATH"
  grep -q 'portable-ruby' "$HOME/.zshrc" 2>/dev/null || printf 'export PATH="%s:$PATH"\n' "$PRUBY" >> "$HOME/.zshrc"
fi
if command -v pod >/dev/null 2>&1 && pod --version >/dev/null 2>&1; then ok "CocoaPods $(pod --version) já instalado"
else
  if [ -n "$PRUBY" ]; then
    echo "Usando o Ruby do Homebrew: $("$PRUBY/ruby" -v)"
    # Gems da tentativa anterior (Ruby 2.6) não servem para este Ruby: guarda e recomeça.
    [ -d "$GEM_HOME" ] && [ ! -f "$GEM_HOME/.portable" ] && mv "$GEM_HOME" "$GEM_HOME-ruby26-$(date +%s)"
    mkdir -p "$GEM_HOME/bin" && touch "$GEM_HOME/.portable"
    "$PRUBY/gem" install cocoapods --no-document --bindir "$GEM_HOME/bin" \
      && ok "CocoaPods $(pod --version)" \
      || aviso "CocoaPods falhou com o Ruby do Homebrew."
  else
    aviso "Ruby moderno não encontrado. Tentando o Ruby do sistema com versões antigas fixadas..."
    /usr/bin/gem install ffi -v 1.16.3 --no-document && \
    /usr/bin/gem install activesupport -v 6.1.7.10 --no-document && \
    /usr/bin/gem install cocoapods --no-document && ok "CocoaPods $(pod --version)" \
      || aviso "CocoaPods não instalou. O iOS fica pendente; o Android segue normalmente."
  fi
fi

azul "3/5 Xcode (vai pedir a senha do Mac)"
# Procura o Xcode onde quer que esteja instalado (nem sempre é /Applications/Xcode.app).
XCODE_APP=$(mdfind "kMDItemCFBundleIdentifier == 'com.apple.dt.Xcode'" 2>/dev/null | head -1)
[ -z "$XCODE_APP" ] && for c in /Applications/Xcode*.app "$HOME"/Applications/Xcode*.app; do [ -d "$c" ] && XCODE_APP="$c" && break; done
if [ -z "$XCODE_APP" ]; then
  aviso "Não encontrei o Xcode. Abra o Xcode uma vez e rode este script de novo."
else
  echo "Xcode encontrado em: $XCODE_APP"
  sudo xcode-select -s "$XCODE_APP/Contents/Developer" && ok "xcode-select apontado"
  sudo xcodebuild -license accept && ok "Licença aceita"
  sudo xcodebuild -runFirstLaunch >/dev/null 2>&1 && ok "Componentes do Xcode prontos"
  xcodebuild -version | head -1
fi

azul "4/5 Projeto apps/mobile"
mkdir -p "$ROOT/apps"
if [ -d "$ROOT/apps/mobile" ]; then ok "apps/mobile já existe"
else
  cd "$ROOT/apps" && npx --yes create-expo-app@latest mobile --template blank-typescript && ok "apps/mobile criado"
fi

azul "5/5 Pronto"
echo "Com o iPhone no cabo (desbloqueado, Modo de Desenvolvedor ativo), rode:"
echo "  cd \"$ROOT/apps/mobile\" && npx expo run:ios --device"
echo "Android: cd \"$ROOT/apps/mobile\" && npx expo run:android --device"
echo
read -n 1 -s -r -p "Pressione qualquer tecla para fechar."
