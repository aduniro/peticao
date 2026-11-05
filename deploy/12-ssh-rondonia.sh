#!/usr/bin/env bash
# Limita o SSH (porta 22) a IPs de RONDÔNIA, à tailnet e a IPs extras, pelo firewall do próprio servidor (nftables).
# A Vultr só aceita IPs/faixas (poucas dezenas de regras); as ~470 faixas IPv4 e ~1.300 IPv6 de Rondônia (base DB-IP) cabem aqui.
# Antes de usar, a regra de SSH do firewall da Vultr precisa permitir a internet (0.0.0.0/0 e ::/0): o filtro por estado passa a ser este.
# Uso (root na VPS):
#   bash 12-ssh-rondonia.sh aplicar [minutos]   aplica e REVERTE sozinho em N minutos (padrão 5) se você não confirmar
#   bash 12-ssh-rondonia.sh confirmar           torna permanente (depois de testar o SSH em outra janela)
#   bash 12-ssh-rondonia.sh remover             desfaz tudo
#   bash 12-ssh-rondonia.sh status
# IPs extras (fora de Rondônia) que também podem entrar:  SSH_EXTRA_IPS="203.0.113.5,2001:db8::/48" bash 12-ssh-rondonia.sh aplicar
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Rode como root."; exit 1; }
DIR="$(cd "$(dirname "$0")" && pwd)"; F=/etc/nftables.d/peticao-geo.nft; UNIT=peticao-geo-rollback
case "${1:-status}" in
  aplicar)
    MIN="${2:-5}"
    [ -s "$DIR/ro-v4.txt" ] && [ -s "$DIR/ro-v6.txt" ] || { echo "Faltam ro-v4.txt/ro-v6.txt ao lado do script."; exit 1; }
    command -v nft >/dev/null || apt-get install -y nftables >/dev/null
    EX4="100.64.0.0/10"; EX6="fd7a:115c:a1e0::/48"
    IFS=',' read -ra X <<< "${SSH_EXTRA_IPS:-}"; for x in "${X[@]:-}"; do x="${x// /}"; [ -z "$x" ] && continue; if [[ "$x" == *:* ]]; then EX6="$EX6, $x"; else EX4="$EX4, $x"; fi; done
    mkdir -p /etc/nftables.d
    { echo "table inet peticao_geo {"
      echo "  set ro4 { type ipv4_addr; flags interval; auto-merge; elements = { $(paste -sd, "$DIR/ro-v4.txt") } }"
      echo "  set ro6 { type ipv6_addr; flags interval; auto-merge; elements = { $(paste -sd, "$DIR/ro-v6.txt") } }"
      echo "  set extra4 { type ipv4_addr; flags interval; elements = { $EX4 } }"
      echo "  set extra6 { type ipv6_addr; flags interval; elements = { $EX6 } }"
      echo "  chain input { type filter hook input priority -50; policy accept;"
      echo "    tcp dport 22 ct state established,related accept"
      echo "    tcp dport 22 ip saddr @ro4 accept"; echo "    tcp dport 22 ip saddr @extra4 accept"
      echo "    tcp dport 22 ip6 saddr @ro6 accept"; echo "    tcp dport 22 ip6 saddr @extra6 accept"
      echo "    tcp dport 22 drop"
      echo "  }"; echo "}"; } > "$F.new"
    nft -c -f "$F.new" || { echo "Arquivo de regras inválido: nada foi aplicado."; rm -f "$F.new"; exit 1; }
    nft delete table inet peticao_geo 2>/dev/null || true
    nft -f "$F.new"; mv "$F.new" "$F"
    systemctl stop "$UNIT.timer" 2>/dev/null || true
    systemd-run --unit="$UNIT" --on-active="${MIN}min" /usr/sbin/nft delete table inet peticao_geo >/dev/null
    echo "Filtro aplicado. Ele será DESFEITO sozinho em ${MIN} min. Teste agora o SSH em OUTRA janela;"
    echo "se funcionar, rode:  bash $0 confirmar" ;;
  confirmar)
    systemctl stop "$UNIT.timer" 2>/dev/null || true
    grep -qs 'nftables.d' /etc/nftables.conf || echo 'include "/etc/nftables.d/*.nft"' >> /etc/nftables.conf
    systemctl enable --now nftables >/dev/null 2>&1 || true
    nft list table inet peticao_geo >/dev/null 2>&1 || nft -f "$F"
    echo "Filtro permanente (reaplicado no boot pelo nftables)." ;;
  remover)
    systemctl stop "$UNIT.timer" 2>/dev/null || true; nft delete table inet peticao_geo 2>/dev/null || true; rm -f "$F"; echo "Filtro removido." ;;
  *) nft list table inet peticao_geo 2>/dev/null | grep -E "dport 22|elements" | cut -c1-110 | head -8 || echo "Filtro não está ativo."; systemctl list-timers "$UNIT.timer" --no-pager 2>/dev/null | sed -n 1,3p ;;
esac
