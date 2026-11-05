#!/usr/bin/env bash
# Atualiza, em /mnt/dev/peticao, a cópia do histórico de conversa do projeto antigo
# (/media/barre/Expansion/peticao), para `claude --resume` listar a sessão nessa pasta.
# Cópia fiel (sem editar o conteúdo). Só substitui o destino se a origem for maior,
# então nunca apaga progresso feito depois de retomar a sessão no destino.
# Uso: depois de sair do Claude Code (/exit), rode:  /mnt/dev/peticao/tools/sync-claude-history.sh
set -euo pipefail
SRC="$HOME/.claude/projects/-media-barre-Expansion-peticao"
DST="$HOME/.claude/projects/-mnt-dev-peticao"
[ -d "$SRC" ] || { echo "Origem não encontrada: $SRC"; exit 0; }
mkdir -p "$DST"
for f in "$SRC"/*.jsonl; do
  [ -e "$f" ] || continue
  name="$(basename "$f")"
  if [ ! -e "$DST/$name" ] || [ "$(stat -c %s "$f")" -gt "$(stat -c %s "$DST/$name")" ]; then
    cp -p "$f" "$DST/$name.tmp" && mv -f "$DST/$name.tmp" "$DST/$name"
    echo "atualizado: $name"
  fi
  [ -d "${f%.jsonl}" ] && cp -a --update=none "${f%.jsonl}" "$DST/" 2>/dev/null || true
done
echo "ok: $(ls "$DST"/*.jsonl | wc -l) sessão(ões) em $DST"
