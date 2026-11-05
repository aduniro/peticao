#!/usr/bin/env bash
# Liga o host do webhook do SNS (bounces/reclamações do SES) ao Caddy. Idempotente.
# eventos.magisteriofederal.org -> só POST /api/ses/eventos chega ao app (como se fosse sancionaintegral.org); o resto dá 404.
# HTTPS no servidor com certificado interno do Caddy (a zona usa SSL "Full": a Cloudflare aceita e o tráfego segue criptografado).
# Uso na VPS:  sudo bash 08-eventos-ses.sh
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Rode com sudo: sudo bash $0"; exit 1; }
CF=/etc/caddy/Caddyfile; H=eventos.magisteriofederal.org; APP=sancionaintegral.org
[ -s "$CF" ] || { echo "Sem $CF: rode antes o ativar-dominio.sh."; exit 1; }
if grep -q "^$H {" "$CF"; then echo "Bloco de $H já existe no Caddyfile."; else
  cp -a "$CF" "$CF.bak-$(date +%Y%m%d%H%M%S)"
  cat >> "$CF" <<CFG

# Webhook do SNS (SES): somente POST /api/ses/eventos; a assinatura do SNS é conferida pelo app
$H {
    tls internal
    @sns {
        method POST
        path /api/ses/eventos
    }
    handle @sns {
        reverse_proxy 127.0.0.1:3000 {
            header_up Host $APP
        }
    }
    handle {
        respond "não encontrado" 404
    }
    header -Server
}
CFG
fi
caddy validate --config "$CF" --adapter caddyfile
systemctl reload caddy
sleep 2
echo "Teste local (esperado 404 para GET e 400/403/503 para POST sem corpo válido):"
curl -sk --resolve "$H:443:127.0.0.1" -o /dev/null -w "  GET  / -> %{http_code}\n" "https://$H/"
curl -sk --resolve "$H:443:127.0.0.1" -o /dev/null -w "  POST /api/ses/eventos -> %{http_code}\n" -X POST --data '{}' "https://$H/api/ses/eventos"
