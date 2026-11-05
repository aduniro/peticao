#!/usr/bin/env bash
# Instala em /mnt/dev/peticao o histórico UNIFICADO da conversa (antigo + novo, sem perder nada),
# para `claude --resume` nesta pasta abrir a versão completa.
#
# COMO USAR
#   1. Saia de TODAS as sessões do Claude que usem /mnt/dev/peticao ou /media/barre/Expansion/peticao (/exit).
#   2. Num terminal comum (fora do Claude):   /mnt/dev/peticao/instalar-historico.sh
#   3. Depois:  cd /mnt/dev/peticao && claude --resume
#
# Para desfazer (restaura o arquivo que estava no projeto novo antes da instalação):
#   /mnt/dev/peticao/instalar-historico.sh --desfazer
#
# O que ele faz: regenera o arquivo unificado a partir do estado ATUAL dos dois históricos, guarda backup
# de ambos, instala o unificado e confere o resultado. Não apaga nem altera o histórico antigo.
set -euo pipefail

S="c05e97b0-15d1-48e2-b109-1fe5a480851c"
OLD="$HOME/.claude/projects/-media-barre-Expansion-peticao/$S.jsonl"
NEW_DIR="$HOME/.claude/projects/-mnt-dev-peticao"
NEW="$NEW_DIR/$S.jsonl"
UNI_DIR="/mnt/dev/peticao/.cache/history-unificado"
UNI="$UNI_DIR/$S.jsonl"
BK_ROOT="/mnt/dev/peticao/.cache/history-backup"
MERGE="/mnt/dev/peticao/tools/merge-claude-history.py"

die() { echo "ERRO: $*" >&2; exit 1; }

# --- nenhuma sessão do Claude pode estar usando estes projetos ---
busy=0
for p in $(pgrep -x claude || true); do
  cwd="$(readlink "/proc/$p/cwd" 2>/dev/null || true)"
  case "$cwd" in
    /mnt/dev/peticao|/mnt/dev/peticao/*|/media/barre/Expansion/peticao|/media/barre/Expansion/peticao/*)
      echo "Sessão do Claude ainda aberta: PID $p (pasta: $cwd)" >&2; busy=1 ;;
  esac
done
[ "$busy" = 0 ] || die "feche essas sessões com /exit e rode de novo (se esta for a que você está usando, rode o script em OUTRO terminal)."

# --- modo desfazer ---
if [ "${1:-}" = "--desfazer" ]; then
  last="$(ls -1d "$BK_ROOT"/instalacao-* 2>/dev/null | sort | tail -n1 || true)"
  [ -n "$last" ] && [ -f "$last/novo.jsonl" ] || die "nenhum backup de instalação encontrado em $BK_ROOT"
  cp -p "$last/novo.jsonl" "$NEW"
  echo "Restaurado: $NEW  <- $last/novo.jsonl"
  exit 0
fi

[ -f "$OLD" ] || die "histórico antigo não encontrado: $OLD"
[ -f "$NEW" ] || die "histórico novo não encontrado: $NEW"
[ -f "$MERGE" ] || die "script de unificação não encontrado: $MERGE"

# --- 1) regenera o unificado com o estado atual (não altera nenhum histórico existente) ---
echo "== Gerando o arquivo unificado..."
mkdir -p "$UNI_DIR"
python3 "$MERGE" "$S" --out "$UNI"

# --- 2) backups de segurança ---
B="$BK_ROOT/instalacao-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$B"
cp -p "$NEW" "$B/novo.jsonl"
cp -p "$OLD" "$B/antigo.jsonl"
cmp -s "$NEW" "$B/novo.jsonl" && cmp -s "$OLD" "$B/antigo.jsonl" || die "backup não confere; nada foi instalado."
echo "== Backups em $B"

# --- 3) instala (cópia para um temporário na mesma pasta e troca atômica) ---
cp -p "$UNI" "$NEW.instalando"
chmod 600 "$NEW.instalando"
mv -f "$NEW.instalando" "$NEW"

# --- 4) confere ---
n_old=$(wc -l < "$B/antigo.jsonl")
n_new_bk=$(wc -l < "$B/novo.jsonl")
n_uni=$(wc -l < "$NEW")
head -n "$n_old" "$NEW" | cmp - "$B/antigo.jsonl" || die "início do instalado difere do antigo! Restaure com --desfazer."
dif=$(diff <(tail -n +860 "$B/novo.jsonl") <(tail -n +"$((n_old + 1))" "$NEW") | grep -c '^[<>]' || true)
[ "$dif" -le 2 ] || die "linhas do ramo novo divergem além do esperado ($dif). Restaure com --desfazer."

echo
echo "OK. Histórico instalado em: $NEW"
echo "   antigo: $n_old linhas | novo (antes): $n_new_bk linhas | unificado: $n_uni linhas"
echo "   (a única linha alterada é o parentUuid da 1ª mensagem do ramo novo, que agora aponta para a ponta do antigo)"
echo
echo "Agora:  cd /mnt/dev/peticao && claude --resume"
echo "Para desfazer:  /mnt/dev/peticao/instalar-historico.sh --desfazer"
