#!/usr/bin/env bash
# Baixa/atualiza as bases DB-IP Lite (cidade e ASN/provedor). Gratuitas, sem conta, atualizadas todo mês.
# Licença CC BY 4.0: mantenha a atribuição "IP Geolocation by DB-IP" no painel.
set -euo pipefail
cd "$(dirname "$0")/../geo-data"
for back in 0 1 2; do
  ym="$(date -d "$(date +%Y-%m-15) -$back month" +%Y-%m)"
  ok=1
  for k in city asn; do
    curl -fsSL -m 900 -o "dbip-$k-lite.mmdb.gz.new" "https://download.db-ip.com/free/dbip-$k-lite-$ym.mmdb.gz" || { ok=0; break; }
  done
  if [ "$ok" = 1 ]; then
    for k in city asn; do gunzip -f "dbip-$k-lite.mmdb.gz.new" && mv -f "dbip-$k-lite.mmdb.gz" /dev/null 2>/dev/null || true; mv -f "dbip-$k-lite.mmdb.gz.new" "dbip-$k-lite.mmdb" 2>/dev/null || true; done
    echo "Bases de $ym instaladas."; exit 0
  fi
done
echo "Não foi possível baixar as bases." >&2; exit 1
