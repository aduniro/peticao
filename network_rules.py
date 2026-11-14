"""Deterministic SSH mesh configuration; no credentials or network I/O."""
import ipaddress
import re


def validate_key(value):
    parts=value.split()
    if len(parts)<2 or parts[0]!='ssh-ed25519' or not re.fullmatch(r'[A-Za-z0-9+/=]+',parts[1]):
        raise ValueError('Expected Ed25519 public key')
    return parts[0]+' '+parts[1]


def authorization(old,ipv6_map,additions):
    """Preserve existing keys/options, adding exact corresponding IPv6 sources."""
    lines=[]
    replacements={validate_key(x['key']).split()[1]:x for x in additions}
    used=set()
    for line in old.splitlines():
        match=re.search(r'ssh-ed25519 ([A-Za-z0-9+/=]+)',line)
        if match and match[1] in replacements:
            x=replacements[match[1]];line=entry(x);used.add(match[1])
        else:
            def expand(match):
                addresses=match[1].split(',')
                for address in list(addresses):
                    if address in ipv6_map and ipv6_map[address] not in addresses:
                        addresses.append(ipv6_map[address])
                return 'from="'+','.join(addresses)+'"'
            line=re.sub(r'from="([^"]+)"',expand,line)
        lines.append(line)
    for blob,x in replacements.items():
        if blob not in used:lines.append(entry(x))
    return '\n'.join(lines)+'\n'


def entry(value):
    addresses=value['sources']
    if not addresses:raise ValueError('Empty source binding')
    for address in addresses:ipaddress.ip_address(address)
    label=value['label']
    if not re.fullmatch(r'[a-zA-Z0-9_.-]+',label):raise ValueError('Unsafe key label')
    return ('from="'+','.join(addresses)+'",no-agent-forwarding,no-X11-forwarding '
            +validate_key(value['key'])+' '+label)


def listener_config(old,ipv6,port):
    ipaddress.IPv6Address(ipv6)
    if port!=2224:raise ValueError('Only dedicated existing mesh daemon may be changed')
    lines=old.splitlines();result=[];added=False
    target='ListenAddress ['+ipv6+']:2224'
    for line in lines:
        if line.strip().lower().startswith('addressfamily '):line='AddressFamily any'
        result.append(line)
        if line.strip().lower().startswith('listenaddress ') and not added:
            if target not in lines:result.append(target)
            added=True
    if not added:raise ValueError('Existing private listener absent')
    if not any(l.strip().lower().startswith('addressfamily ') for l in lines):result.insert(0,'AddressFamily any')
    return '\n'.join(result)+'\n'


def client_config(nodes,identity):
    if not identity.startswith('/'):raise ValueError('Absolute client identity required')
    result=[]
    for n in nodes:
        for root in [False,True]:
            stem='cluster-'+n['name']+('-root' if root else '')
            for route,host in [('dns',n['dns']),('ipv4',n['ipv4']),('ipv6',n['ipv6'])]:
                aliases=[stem+'-'+route]
                if route=='dns':
                    aliases.append(stem)
                    if not root:aliases.extend([n['hostname'],n['dns'],n['ipv4'],n['ipv6']])
                result.extend(['Host '+' '.join(aliases),'  HostName '+host,
                               '  User '+('root' if root else n['user']),'  Port '+str(n['port']),
                               '  IdentityFile '+identity,'  IdentitiesOnly yes',
                               '  HostKeyAlias '+n['dns'],
                               '  StrictHostKeyChecking yes',
                               '  UserKnownHostsFile ~/.ssh/known_hosts_peticao_mesh_v3',''])
    return '\n'.join(result)


def known_hosts(nodes):
    lines=[]
    for n in nodes:
        names=[n['ipv4'],n['ipv6'],n['dns'],n['hostname']]
        if n['port']!=22:names=['['+h+']:'+str(n['port']) for h in names]
        lines.append(','.join(names)+' '+validate_key(n['host_key']))
    return '\n'.join(lines)+'\n'


def guard_commands(ipv6,owner_addresses):
    """A separate INPUT chain affects only TCP22; never flush shared firewall."""
    binary='ip6tables' if ipv6 else 'iptables';chain='PETICAO_CIVO_SSH'
    sources=[]
    for address in owner_addresses:
        parsed=ipaddress.ip_address(address)
        if (parsed.version==6)==ipv6:sources.append(str(parsed))
    commands=[[binary,'-w','-N',chain],
              [binary,'-w','-A',chain,'-i','lo','-j','ACCEPT'],
              [binary,'-w','-A',chain,'-i','tailscale0','-j','ACCEPT']]
    for source in sources:commands.append([binary,'-w','-A',chain,'-s',source,'-j','ACCEPT'])
    commands.extend([[binary,'-w','-A',chain,'-j','DROP'],
                     [binary,'-w','-I','INPUT','1','-p','tcp','--dport','22','-j',chain]])
    return commands
