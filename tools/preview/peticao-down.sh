#!/usr/bin/env bash
# Desliga o Funnel do Tailscale (a página sai da internet) e para o servidor da petição.
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tailscale funnel --https=443 off 2>&1 || true
bash "$DIR/preview.sh" stop
echo; tailscale funnel status 2>&1 | head -3
echo "Petição fora do ar."
