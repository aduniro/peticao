"""Offline adapter regression; native3401 is namespace-only, not V6 qualification."""
import unittest
from unittest import mock
import profile_contract as p
from systemd_adapter import SystemdAdapter
from test_real_profiles import descriptor
ALIAS='/run/peticao-dev-work'

def fixture(name='fixture-pass'):
    return {'name':name,'program':'/opt/peticao-dev-worker/fixture_job.py','python_path':'/usr/bin/python3',**{k:'a'*64 for k in ('program_sha256','python_sha256','source_sha256','dependencies_sha256','artifact_policy_sha256')}}

def command(d,job='a'*32,generation=1):
    return SystemdAdapter().unit_argv({'job_id':job,'generation':generation},{'unit':'admin-dev-'+job+'-g'+str(generation)+'.service'},d)

def properties(argv):return dict(x[len('--property='):].split('=',1)for x in argv if x.startswith('--property='))

class NamespaceV6Tests(unittest.TestCase):
    def check(self,argv,job='a'*32,generation=1):
        props=properties(argv)
        self.assertEqual(props['WorkingDirectory'],ALIAS);self.assertEqual(props['TemporaryFileSystem'],'/run:rw')
        self.assertEqual(props['BindPaths'],'/var/lib/peticao-dev-job-'+job+'-g'+str(generation)+':'+ALIAS)
        for k,value in {'DynamicUser':'yes','StateDirectoryMode':'0700','PrivateNetwork':'yes','PrivateTmp':'yes','PrivateDevices':'yes','ProtectHome':'tmpfs','ProtectSystem':'strict','CapabilityBoundingSet':'','AmbientCapabilities':'','NoNewPrivileges':'yes'}.items():self.assertEqual(props[k],value)
        for path in ('/mnt/apps/peticao-final/.runtime','/tmp','/var/tmp'):self.assertIn(path,props['InaccessiblePaths'].split())
        self.assertIn('HOME='+ALIAS+'/h',argv);self.assertIn('TMPDIR='+ALIAS+'/t',argv)
        return props
    def test_three_real_profiles_two_plans_keep_limits_security_and_flags(self):
        for name in sorted(p.REAL):
            for heavy in (False,True):
                with self.subTest(name=name,heavy=heavy):
                    d=descriptor(name,heavy=heavy);argv=command(d);props=self.check(argv)
                    for k,value in p.systemd_properties(d).items():self.assertEqual(props[k],value)
                    self.assertEqual(argv[-5:],['-I','-S','-B',p.PROGRAM,name]);self.assertIn('-i',argv)
                    self.assertFalse(any('LD_PRELOAD'in x or'KAGGLE'in x for x in argv))
    def test_fixture_names_keep_fixed_argument_contract_and_alias(self):
        for name in ('fixture-pass','fixture-fail'):
            argv=command(fixture(name));self.check(argv);self.assertEqual(argv[-5:],['-s','-E','-B',fixture()['program'],name]);self.assertEqual(properties(argv)['MemoryMax'],'512M')
    def test_alias_constant_but_job_generation_bind_sources_distinct(self):
        sources=[]
        for job,generation in [('a'*32,1),('b'*32,1),('a'*32,2)]:sources.append(self.check(command(fixture(),job,generation),job,generation)['BindPaths'])
        self.assertEqual(len(set(sources)),3)
    def test_bad_identity_cannot_enter_bind_property(self):
        for job,generation in [('../evil',1),('a'*32+'\n',1),('a'*32,True),('a'*32,0)]:
            with self.subTest(job=job,generation=generation),self.assertRaises((ValueError,PermissionError)):command(fixture(),job,generation)
    def test_command_planning_never_calls_manager(self):
        adapter=SystemdAdapter()
        with mock.patch.object(adapter,'command',side_effect=AssertionError('unexpected manager execution')):argv=adapter.unit_argv({'job_id':'a'*32,'generation':1},{'unit':'admin-dev-'+'a'*32+'-g1.service'},descriptor())
        self.assertEqual(argv[0],'/usr/bin/systemd-run');self.check(argv)
if __name__=='__main__':unittest.main()
