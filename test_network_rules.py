import unittest
import subprocess
import tempfile
from pathlib import Path
from network_rules import authorization,listener_config,client_config,known_hosts,guard_commands

KEY='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'


class NetworkRules(unittest.TestCase):
    def test_ipv6_expansion_preserves_constraints_and_is_idempotent(self):
        old='from="100.80.18.81",no-port-forwarding '+KEY+' legacy\n# retained\n'
        m={'100.80.18.81':'fd7a:115c:a1e0::3e2f:1252'}
        new=authorization(old,m,[])
        self.assertIn('from="100.80.18.81,fd7a:115c:a1e0::3e2f:1252",no-port-forwarding',new)
        self.assertIn('# retained',new);self.assertEqual(new,authorization(new,m,[]))
    def test_new_key_remains_exact_source_bound(self):
        item=dict(key=KEY,sources=['100.122.224.82','fd7a:115c:a1e0::322f:e053'],label='civo-test')
        new=authorization('',{},[item]);self.assertEqual(new,authorization(new,{},[item]))
        self.assertNotIn('100.64.0.0/10',new)
    def test_listener_keeps_forwarding_policy_and_ipv4(self):
        old='Port 2224\nAddressFamily inet\nListenAddress 100.74.19.123\nAllowTcpForwarding no\n'
        new=listener_config(old,'fd7a:115c:a1e0::4c2f:137c',2224)
        self.assertIn('ListenAddress 100.74.19.123\n',new);self.assertIn('AllowTcpForwarding no\n',new)
        self.assertEqual(new,listener_config(new,'fd7a:115c:a1e0::4c2f:137c',2224))
        with self.assertRaises(ValueError):listener_config(old,'::1',22)
    def test_firewall_only_hooks_ssh_and_never_flushes_other_rules(self):
        for v6 in [False,True]:
            c=guard_commands(v6,['181.220.194.57','2804:14d:cc84:8308::1666'])
            self.assertTrue(all('-F' not in x for x in c));self.assertEqual(c[-1][-4:],['--dport','22','-j','PETICAO_CIVO_SSH'])
            self.assertTrue(any('tailscale0' in x for x in c));self.assertTrue(any('lo' in x for x in c))
            self.assertFalse(any('OUTPUT' in x or 'FORWARD' in x for x in c))
    def test_routes_have_exact_identity_and_pinned_host_keys(self):
        node=dict(name='civo',hostname='peticao-civo',user='civo',port=22,ipv4='100.122.224.82',ipv6='fd7a:115c:a1e0::322f:e053',dns='peticao-civo.tail1a6d71.ts.net',host_key=KEY)
        text=client_config([node],'/root/.ssh/node');self.assertIn('cluster-civo-root-ipv6',text)
        self.assertIn('StrictHostKeyChecking yes',text);self.assertIn(node['dns'],known_hosts([node]))
    def test_generated_alias_overrides_legacy_host_key_alias(self):
        node=dict(name='sp',hostname='peticao-sp',user='adunir',port=2224,ipv4='100.109.6.122',ipv6='fd7a:115c:a1e0::8e2f:67b',dns='peticao-sp.tail1a6d71.ts.net',host_key=KEY)
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/'config'
            p.write_text(client_config([node],'/tmp/test-client')+'\nHost cluster-sp-ipv6\n  HostKeyAlias admin-mesh-sp\n')
            out=subprocess.run(['ssh','-G','-F',str(p),'cluster-sp-ipv6'],capture_output=True,text=True,check=True).stdout
            alias='['+node['dns']+']:2224'
            self.assertIn('hostkeyalias '+alias+'\n',out)
            self.assertIn('hostname '+node['ipv6']+'\n',out)
            keys=Path(directory)/'known_hosts';keys.write_text(known_hosts([node]))
            found=subprocess.run(['ssh-keygen','-F',alias,'-f',str(keys)],capture_output=True,text=True,check=True).stdout
            self.assertIn(KEY,found)


if __name__=='__main__':unittest.main()
