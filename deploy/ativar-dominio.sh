#!/usr/bin/env bash
# Liga o domínio atrás da Cloudflare: HTTPS no servidor com o Certificado de Origem da Cloudflare (sem Let's Encrypt, só a porta 443).
# Antes: salve o certificado e a chave (Cloudflare > SSL/TLS > Origin Server > Create Certificate) em
#   /etc/caddy/certs/origin.pem  e  /etc/caddy/certs/origin.key      (veja o LEIAME.md)
# Uso na VPS:  sudo bash ativar-dominio.sh sancionaintegral.org
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Rode com sudo: sudo bash $0 dominio"; exit 1; }
D="${1:-}"; [[ "$D" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$ ]] || { echo "Uso: sudo bash $0 dominio.org"; exit 1; }
[ -s /etc/caddy/certs/origin.pem ] && [ -s /etc/caddy/certs/origin.key ] || { echo "Faltam /etc/caddy/certs/origin.pem e origin.key (veja o LEIAME.md)."; exit 1; }
chown -R root:caddy /etc/caddy/certs; chmod 750 /etc/caddy/certs; chmod 640 /etc/caddy/certs/origin.pem; chmod 640 /etc/caddy/certs/origin.key
cat > /etc/caddy/Caddyfile <<CFG
$D {
    tls /etc/caddy/certs/origin.pem /etc/caddy/certs/origin.key
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
    header -Server
}
www.$D {
    tls /etc/caddy/certs/origin.pem /etc/caddy/certs/origin.key
    redir https://$D{uri} permanent
}
# Webhook do SNS (SES): somente POST /api/ses/eventos (veja 08-eventos-ses.sh)
eventos.magisteriofederal.org {
    tls internal
    @sns {
        method POST
        path /api/ses/eventos
    }
    handle @sns {
        reverse_proxy 127.0.0.1:3000 {
            header_up Host $D
        }
    }
    handle {
        respond "não encontrado" 404
    }
    header -Server
}
# Teste local por túnel SSH
http://127.0.0.1:8080 {
    reverse_proxy 127.0.0.1:3000
}
CFG
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
# O app passa a confiar no IP que a Cloudflare informa (o firewall do Vultr só deixa a Cloudflare chegar na 443)
set_var() { tmp="$(mktemp)"; grep -v "^$1=" /etc/peticao/app.env > "$tmp" || true; printf "%s='%s'\n" "$1" "$2" >> "$tmp"; install -m 640 -o root -g peticao "$tmp" /etc/peticao/app.env; rm -f "$tmp"; }
set_var APP_URL "https://$D"; set_var ALLOWED_HOSTS "$D,www.$D"; set_var TRUST_CF_HEADER 1
systemctl reload caddy; systemctl restart peticao
echo "OK: https://$D (depois que o DNS da Cloudflare apontar para esta VPS, com o proxy laranja ligado)."
