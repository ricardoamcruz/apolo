#!/bin/bash
# Abre a interface numa janela própria do Chrome (perfil ~/.apolo/chrome), que é a
# única em que a música do bom dia toca sem clique. Com --de-novo, fecha antes a que
# estiver aberta nesse perfil: é o que a F.Ê.N.I.X. roda quando a voz não volta
# (docs/adr/0035). O Chrome do dia a dia não é tocado.
set -uo pipefail
INTERFACE="https://localhost:${PORT:-5173}"
PERFIL="$HOME/.apolo/chrome"

if [ "${1:-}" = "--de-novo" ]; then
  # Só o processo principal deste perfil; os auxiliares saem com ele.
  NOSSO="/Contents/MacOS/Google Chrome --user-data-dir=$PERFIL "
  pkill -f "$NOSSO" || true
  for _ in $(seq 1 20); do
    pgrep -f "$NOSSO" >/dev/null || break
    sleep 0.5
  done
  pkill -9 -f "$NOSSO" || true
fi

open -na "Google Chrome" --args \
  --user-data-dir="$PERFIL" \
  --app="$INTERFACE" \
  --autoplay-policy=no-user-gesture-required \
  --no-first-run --no-default-browser-check 2>/dev/null || open "$INTERFACE"
