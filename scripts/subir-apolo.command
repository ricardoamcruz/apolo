#!/bin/bash
# Sobe o A.P.O.L.O. sozinho: a F.Ê.N.I.X. (npm start) liga ponte, interface e
# H.E.R.M.E.S., e a interface abre numa janela própria do Chrome quando responder.
#
# Janela própria, com perfil em ~/.apolo/chrome, porque só assim o Chrome aceita
# --autoplay-policy: sem isso, a música do bom dia (um iframe do YouTube) só toca
# depois de um clique, e acordar por voz não conta como clique. O Chrome do dia a
# dia, com a extensão do Claude, continua como está. Na primeira vez, permita o
# microfone nessa janela.
# Uso: dê dois cliques no Finder, ou rode `scripts/subir-apolo.command [--writes] [--autodev]`.
# Os argumentos vão direto para o `npm start`.

set -euo pipefail
cd "$(dirname "$0")/.."

# Node instalado pelo Homebrew ou pelo nvm, mesmo fora de um terminal com perfil.
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null; fi

if ! command -v node >/dev/null; then
  echo "Node não encontrado. Rode 'npm run setup' depois de instalar o Node ≥ 20."
  exit 1
fi

INTERFACE="https://localhost:${PORT:-5173}"
abrir_interface() {
  open -na "Google Chrome" --args \
    --user-data-dir="$HOME/.apolo/chrome" \
    --app="$INTERFACE" \
    --autoplay-policy=no-user-gesture-required \
    --no-first-run --no-default-browser-check 2>/dev/null || open "$INTERFACE"
}

if pgrep -f "fenix/fenix.mjs" >/dev/null; then
  echo "O A.P.O.L.O. já está no ar. Abrindo a interface."
  abrir_interface
  exit 0
fi

[ -d node_modules ] || npm install

# Abre a interface assim que o Vite responder (até 2 min).
(
  for _ in $(seq 1 120); do
    if curl -sk -o /dev/null "$INTERFACE"; then
      abrir_interface
      exit 0
    fi
    sleep 1
  done
  echo "A interface não respondeu em 2 minutos; veja o log acima."
) &

exec npm start -- "$@"
