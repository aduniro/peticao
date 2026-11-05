#!/usr/bin/env bash
# Fixa o IPv6 que o Vultr atribuiu a esta instância (o automático "temporário" muda). Rode na VPS:  sudo bash 00-ipv6.sh
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Rode com sudo: sudo bash $0"; exit 1; }
ADDR="${1:-2001:19f0:b800:266e:5400:6ff:fefd:6233}"   # endereço da instância (conferir com: vultr.mjs instancia:ver <id>)
IFACE="$(ip -o -4 route show default | awk '{print $5; exit}')"
[ -n "$IFACE" ] || { echo "Não achei a interface de rede."; exit 1; }
echo "Interface: $IFACE  | IPv6 a fixar: $ADDR/64"
# 1) agora (sem reiniciar a rede, para não derrubar o SSH)
ip -6 addr show dev "$IFACE" | grep -q "$ADDR" || ip -6 addr add "$ADDR/64" dev "$IFACE"
# 2) permanente (vale no próximo boot)
cat > /etc/network/interfaces.d/ipv6 <<CFG
# IPv6 fixo atribuído pelo Vultr (gerado por 00-ipv6.sh)
iface $IFACE inet6 static
    address $ADDR
    netmask 64
    accept_ra 2
    privext 0
CFG
# endereços temporários (privacidade) desligados: o endereço público fica estável
cat > /etc/sysctl.d/60-peticao-ipv6.conf <<CFG
net.ipv6.conf.all.use_tempaddr = 0
net.ipv6.conf.default.use_tempaddr = 0
net.ipv6.conf.$IFACE.use_tempaddr = 0
CFG
sysctl --system >/dev/null
echo "--- endereços IPv6 globais:"; ip -6 -o addr show scope global | awk '{print $2, $4}'
echo "--- saída IPv6 (deve ser um endereço 2001:19f0:...):"; curl -6 -s --max-time 8 https://api6.ipify.org; echo
echo "OK. Se quiser testar o arquivo permanente, reinicie com 'sudo reboot' (a instância volta em ~1 min)."
