#!/bin/bash
# Instala o protocolo Â.N.C.O.R.A. (docs/adr/0041) e congela a primeira âncora.
# Dois cliques, ou: bash scripts/ancora/instalar.command
# Passo a passo e a palavra-senha explicados em scripts/ancora/README.md.
set -euo pipefail
cd "$(dirname "$0")/../.."

falha() {
  echo
  echo "✖ $1"
  read -n 1 -s -r -p "Nada foi instalado. Pressione uma tecla para fechar."
  exit 1
}

echo "Â.N.C.O.R.A. — Agora Nós Conheceremos O Retrocesso Automático"
echo

# ------------------------------------------------------------ antes de começar
echo "Conferindo antes de começar…"
NODE="$(command -v node)" || falha "Não achei o Node. Instale o Node ≥ 20 e rode de novo."
echo "  ✔ Node: $NODE ($("$NODE" --version))"

BRANCH="$(git branch --show-current)"
[ "$BRANCH" = "main" ] || falha "O repositório está na branch '$BRANCH'. A âncora se instala a partir da main: rode 'git switch main && git pull' e abra este arquivo de novo."
git fetch -q origin main || falha "Não consegui buscar a main no GitHub. Confira a internet e rode de novo."
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || falha "A main deste Mac está diferente da do GitHub. Rode 'git pull' e abra este arquivo de novo."
echo "  ✔ main em dia com o GitHub ($(git rev-parse --short HEAD))"

if grep -q '^APOLO_NTFY_TOPICO=.' .env.local 2>/dev/null; then
  echo "  ✔ tópico do ntfy no .env.local (o Atalho do iPhone vai funcionar)"
else
  echo "  ! Falta APOLO_NTFY_TOPICO no .env.local: sem ele, o Atalho do iPhone não aciona nada."
  read -r -p "    Continuar mesmo assim? (s/N) " resposta
  [ "$resposta" = "s" ] || falha "Ponha o APOLO_NTFY_TOPICO no .env.local e rode de novo."
fi

if [ -f /usr/local/ancora/ancora.conf ]; then
  echo "  ✔ já instalada antes: as âncoras congeladas ficam; a palavra-senha será trocada pela nova"
fi

# ------------------------------------------------------------ 1. instalar
cat <<'TEXTO'

[1/3] Instalar o programa, o vigia do iPhone e o Âncora.command

  Primeiro o macOS pede a SUA senha do Mac (sudo): a âncora fica com o root,
  para que nenhum programa seu, nem o próprio A.P.O.L.O., consiga mudá-la.

  Depois vem a PALAVRA-SENHA DO ATALHO. Ela é nova, inventada agora, e não é a
  senha do Mac:
    • só serve para o Atalho do iPhone provar que o pedido é seu;
    • fica guardada em dois lugares: neste Mac e dentro do Atalho;
    • nunca é enviada pela internet (vai só um código que muda a cada minuto);
    • mínimo de 8 caracteres; não aparece enquanto você digita;
    • não use uma senha que você usa em outro lugar.
  Anote-a: você vai digitá-la de novo ao criar o Atalho.

TEXTO
sudo "$NODE" scripts/ancora/ancora.mjs instalar || falha "A instalação parou (o motivo está acima)."

# ------------------------------------------------------------ 2. congelar
echo
echo "[2/3] Congelar a âncora a partir da main do GitHub"
echo "  Clona a main, roda npm ci e gera o manifesto. Leva alguns minutos."
echo
sudo /usr/local/bin/ancora --atualizar main || falha "Não consegui congelar a âncora (o motivo está acima). O programa já está instalado: rode 'sudo ancora --atualizar main' depois."

# ------------------------------------------------------------ 3. conferir
echo
echo "[3/3] Conferindo"
/usr/local/bin/ancora --estado

cat <<'TEXTO'

✔ Pronto. Falta só o Atalho do iPhone:
  1. Crie o Atalho "Âncora" seguindo scripts/ancora/README.md ("O Atalho do iPhone").
  2. Para conferir, rode `ancora --testar-atalho` no Mac e o Atalho em modo de teste
     no mesmo minuto: os dois códigos têm de ser iguais.

TEXTO
read -n 1 -s -r -p "Pressione uma tecla para fechar."
