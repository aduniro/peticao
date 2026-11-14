import unittest
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


if __name__=='__main__':unittest.main()
