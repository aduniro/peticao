#!/bin/bash
set -Eeuo pipefail
role=${1:?primary or standby}
[[ "$role" == primary || "$role" == standby ]] || exit 2
if [[ "$role" == primary ]]; then expected=sonda-verifica3; ip=100.80.18.81; root=/srv/admin-v2-coordinator; else expected=peticao-sp; ip=100.109.6.122; root=/srv/admin-v2-coordinator-standby; fi
[[ "$(hostname -s)" == "$expected" ]] || exit 3
getent group admin-v2-exec >/dev/null || groupadd --system admin-v2-exec
id vigia-coord >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash --groups admin-v2-exec vigia-coord
usermod -p '*' vigia-coord
install -d -m 700 -o vigia-coord -g vigia-coord /home/vigia-coord/.ssh
install -d -m 750 -o root -g admin-v2-exec /opt/admin-v2-cluster
install -d -m 2770 -o vigia-coord -g admin-v2-exec "$root"
if [[ "$role" == primary ]]; then
 id vigia-worker >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash --groups admin-v2-exec vigia-worker
 install -d -m 2770 -o vigia-coord -g admin-v2-exec /srv/admin-v2-worker /srv/admin-v2-worker/jobs
 printf 'vigia-worker ALL=(ALL:ALL) NOPASSWD: ALL\n' > /etc/sudoers.d/admin-v2-worker
 printf 'vigia-coord ALL=(root) NOPASSWD: /usr/local/libexec/admin-v2-launch *\n' > /etc/sudoers.d/admin-v2-coordinator
 chmod 440 /etc/sudoers.d/admin-v2-worker /etc/sudoers.d/admin-v2-coordinator
 visudo -cf /etc/sudoers.d/admin-v2-worker
 visudo -cf /etc/sudoers.d/admin-v2-coordinator
fi
cat > /etc/ssh/sshd_config_admin_v2 <<EOF
Port 2222
ListenAddress $ip
HostKey /etc/ssh/ssh_host_ed25519_key
PidFile /run/sshd-admin-v2.pid
AuthorizedKeysFile .ssh/authorized_keys
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitEmptyPasswords no
PermitRootLogin no
UsePAM yes
AllowUsers vigia-coord
AllowTcpForwarding no
AllowAgentForwarding no
X11Forwarding no
PermitTTY no
PermitTunnel no
ClientAliveInterval 30
ClientAliveCountMax 3
LogLevel VERBOSE
ForceCommand /usr/bin/python3 /opt/admin-v2-cluster/gateway.py
EOF
/usr/sbin/sshd -t -f /etc/ssh/sshd_config_admin_v2
cat > /etc/systemd/system/admin-v2-ssh.service <<EOF
[Unit]
Description=Private SSH gateway for admin-v2 coordination
After=network-online.target tailscaled.service
Requires=tailscaled.service
[Service]
ExecStartPre=/usr/bin/install -d -m 0755 /run/sshd
ExecStart=/usr/sbin/sshd -D -f /etc/ssh/sshd_config_admin_v2
Restart=on-failure
RestartSec=10
[Install]
WantedBy=multi-user.target
EOF
printf 'ADMIN_CLUSTER_ROOT=%s\nADMIN_WORKER_ROOT=/srv/admin-v2-worker\n' "$root" > /etc/admin-v2-cluster.env
chmod 644 /etc/admin-v2-cluster.env
python3 - "$root" "$role" <<'PYS'
import pathlib,json,sys
root=pathlib.Path(sys.argv[1]);p=root/'authority.json'
if not p.exists():
 p.write_text(json.dumps({'role':sys.argv[2],'generation':1,'armed_boot_id':pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip() if sys.argv[2]=='primary' else None}))
 p.chmod(0o644)
PYS
systemctl daemon-reload
printf 'Base %s preparada em %s\n' "$role" "$(hostname -s)"
