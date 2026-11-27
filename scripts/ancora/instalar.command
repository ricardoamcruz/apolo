#!/bin/bash
# Instala o protocolo Â.N.C.O.R.A. (docs/adr/0041) e congela a primeira âncora.
# Dois cliques, ou: bash scripts/ancora/instalar.command
# Pede a sua senha (sudo) e a palavra-senha do Atalho do iPhone.
set -euo pipefail
cd "$(dirname "$0")/../.."
NODE="$(command -v node)"
echo "Â.N.C.O.R.A. — Agora Nós Conheceremos O Retrocesso Automático"
echo
sudo "$NODE" scripts/ancora/ancora.mjs instalar
echo
echo "Congelando a âncora a partir da main do GitHub (clona e roda npm ci; leva alguns minutos)."
sudo /usr/local/bin/ancora --atualizar main
echo
/usr/local/bin/ancora --estado
read -n 1 -s -r -p "Pronto. Pressione uma tecla para fechar."
