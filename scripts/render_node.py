#!/usr/bin/env python3
"""Render node-specific files; never changes a host or prints enrollment secrets."""
import argparse
import ipaddress
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
POD_CIDR = '10.240.0.0/16'
SERVICE_CIDR = '10.241.0.0/16'
PEERS = ['100.80.18.81', '100.105.193.63', '100.109.6.122']


def render(name, mem_total, cpu_total, routes):
    cluster = json.loads((ROOT / 'cluster.json').read_text())
    node = cluster['nodes'][name]
    # Ignore default routes, but reject overlaps with any actual routed network.
    for route in routes:
        destination = route.get('dst', 'default')
        if destination == 'default':
            continue
        network = ipaddress.ip_network(destination, strict=False)
        if network.version == 4 and network.prefixlen:
            for cidr in (POD_CIDR, SERVICE_CIDR):
                if network.overlaps(ipaddress.ip_network(cidr)):
                    raise ValueError(f'{name}: {cidr} overlaps {destination}')
    reserve_cpu = max(0.75 if name == 'santiago' else 0.5, cpu_total - node['max_cpu'])
    reserve_memory = max(1792 if name == 'santiago' else 1536,
                         (mem_total // 2**20) - node['max_memory_gib'] * 1024)
    config = {
        'data-dir': '/var/lib/peticao-k3s',
        'node-name': 'peticao-' + name,
        'node-ip': node['ip'],
        'flannel-iface': 'tailscale0',
        'node-label': ['peticao.dev/worker=' + name],
        # Admission is closed until namespace restrictions and coordinator are ready.
        'node-taint': ['peticao.dev/admission=pending:NoSchedule'],
        'kubelet-arg': [
            'address=' + node['ip'], 'read-only-port=0', 'fail-swap-on=false',
            f'system-reserved=cpu={int(reserve_cpu*1000)}m,memory={reserve_memory}Mi',
            'eviction-hard=memory.available<512Mi,nodefs.available<15%,imagefs.available<15%',
            'max-pods=24',
        ],
    }
    role = 'server' if name == 'santiago' else 'agent'
    if role == 'server':
        config.update({
            'cluster-init': True, 'cluster-cidr': POD_CIDR,
            'service-cidr': SERVICE_CIDR, 'cluster-dns': '10.241.0.10',
            'bind-address': node['ip'], 'advertise-address': node['ip'],
            'tls-san': [node['ip'], 'peticao-santiago'], 'tls-san-security': True,
            'write-kubeconfig-mode': '0600',
            'token-file': '/etc/rancher/peticao-k3s/server-token',
            'agent-token-file': '/etc/rancher/peticao-k3s/agent-token',
            'disable': ['traefik', 'servicelb', 'local-storage'],
            'flannel-backend': 'vxlan', 'secrets-encryption': True,
            'etcd-snapshot-schedule-cron': '*/15 * * * *',
            'etcd-snapshot-retention': 96,
            'kube-apiserver-arg': ['anonymous-auth=false', 'service-node-port-range=32000-32010'],
        })
    else:
        config.update({'server': 'https://100.80.18.81:6443',
                       'token-file': '/etc/rancher/peticao-k3s/agent-token'})
    # Only new Kubernetes ports are guarded here. Existing SSH/dashboard rules remain intact.
    peers = ', '.join(PEERS)
    firewall = f'''table inet peticao_k3s_guard {{
 chain input {{
  type filter hook input priority -10; policy accept;
  iifname "lo" accept
  iifname "tailscale0" ip saddr {{ {peers} }} tcp dport {{ 6443, 10250, 5443, 9444 }} accept
  iifname "tailscale0" ip saddr {{ {peers} }} udp dport 8472 accept
  tcp dport {{ 2379, 2380, 6443, 10250, 5443, 9444 }} drop
  udp dport 8472 drop
 }}
}}
'''
    service = f'''[Unit]
Description=Peticao isolated K3s {role}
Wants=network-online.target
After=network-online.target tailscaled.service peticao-k3s-guard.service
Requires=peticao-k3s-guard.service

[Service]
Type=notify
User=root
ExecStart=/usr/local/lib/peticao-k3s/k3s {role} --config /etc/rancher/peticao-k3s/config.yaml
KillMode=process
Delegate=yes
LimitNOFILE=1048576
LimitNPROC=infinity
TasksMax=infinity
TimeoutStartSec=180
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
'''
    guard = '''[Unit]
Description=Private ingress guard for Peticao K3s ports
Before=peticao-k3s.service
After=network-pre.target
Wants=network-pre.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/sbin/nft -f /etc/rancher/peticao-k3s/guard.nft

[Install]
WantedBy=multi-user.target
'''
    return {'config.yaml': json.dumps(config, indent=2) + '\n',
            'guard.nft': firewall, 'peticao-k3s.service': service,
            'peticao-k3s-guard.service': guard}


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('node', choices=['local', 'santiago', 'sp'])
    p.add_argument('--memory-bytes', type=int, required=True)
    p.add_argument('--cpus', type=int, required=True)
    p.add_argument('--routes', type=Path, required=True)
    args = p.parse_args()
    out = ROOT / 'manifests' / args.node
    out.mkdir(parents=True, exist_ok=True)
    for filename, contents in render(args.node, args.memory_bytes, args.cpus,
                                     json.loads(args.routes.read_text())).items():
        (out / filename).write_text(contents)
    print(out)
