#!/usr/bin/env bash
# Instala o botão "Publicar" do painel (rode como root na VPS). NÃO publica nada e NÃO mexe no site em execução.
#   scp /mnt/dev/peticao-parcial/deploy/21-publicar.sh /mnt/dev/peticao-parcial/deploy/peticao-publicar-executar.sh peticao-root:/root/ && ssh peticao-root 'bash /root/21-publicar.sh'
# Como funciona: o painel (nível Total + confirmação extra) grava /var/lib/peticao/publicar.pedido; a unidade peticao-publicar.path vê o arquivo e dispara
# peticao-publicar.service, que roda peticao-publicar-executar (root), que roda SEMPRE o mesmo /usr/local/sbin/peticao-deploy. O resultado fica em /var/lib/peticao-publicar/.
# Remover:  bash 21-publicar.sh --remover
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Rode como root."; exit 1; }
if [ "${1:-}" = "--remover" ]; then
  systemctl disable --now peticao-publicar.path 2>/dev/null || true
  rm -f /etc/systemd/system/peticao-publicar.path /etc/systemd/system/peticao-publicar.service /usr/local/sbin/peticao-publicar-executar /var/lib/peticao/publicar.pedido
  systemctl daemon-reload; echo "Botão Publicar removido (a pasta /var/lib/peticao-publicar fica, com o histórico)."; exit 0
fi
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$AQUI/peticao-publicar-executar.sh" ] || { echo "Falta $AQUI/peticao-publicar-executar.sh (copie os dois arquivos juntos)."; exit 1; }
[ -x /usr/local/sbin/peticao-deploy ] || { echo "Não achei /usr/local/sbin/peticao-deploy: instale o app primeiro (03-instalar-app.sh)."; exit 1; }
install -m 755 -o root -g root "$AQUI/peticao-publicar-executar.sh" /usr/local/sbin/peticao-publicar-executar
install -d -m 755 -o root -g root /var/lib/peticao-publicar
[ -d /var/lib/peticao ] || install -d -m 750 -o peticao -g peticao /var/lib/peticao   # já existe na instalação normal: não muda as permissões dele
cat > /etc/systemd/system/peticao-publicar.service <<'CFG'
[Unit]
Description=Publicar a versão que está no peticao-stage (pedido feito pelo painel)
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/peticao-publicar-executar
TimeoutStartSec=1500
CFG
cat > /etc/systemd/system/peticao-publicar.path <<'CFG'
[Unit]
Description=Vigia o pedido de publicação do painel
[Path]
PathExists=/var/lib/peticao/publicar.pedido
Unit=peticao-publicar.service
[Install]
WantedBy=multi-user.target
CFG
systemctl daemon-reload; systemctl enable --now peticao-publicar.path
echo "== botão Publicar instalado (nada foi publicado)."
systemctl is-active peticao-publicar.path
