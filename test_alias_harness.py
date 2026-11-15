import copy
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

import fixture_core as core
import qualification_contract as q
import review_gate as gate


class AliasHarnessTests(unittest.TestCase):
    def test_root_window_exact_and_bounded(self):
        execution = {'source_notice': 123, 'qualification_operation': {'operation_id': 'a'*32}}
        window = dict(root_thread='01a1cad7-4a65-7d43-b8c2-f0b50a90a580', operator_session=gate.SESSION,
                      resource=gate.RESOURCE, operation_id='a'*32, source_notice=123,
                      scope='isolated-short-alias-test', production_access=False, queue_cutover=False,
                      opens_at=1000, closes_at=2500)
        self.assertTrue(gate.validate_window(window, execution, now=1100))
        for name, value in [('resource','deploy:other'), ('operation_id','b'*32), ('source_notice',124),
                            ('production_access',0), ('queue_cutover',True), ('opens_at',True),
                            ('opens_at',1200), ('closes_at',1800), ('closes_at',5000), ('closes_at',float('nan'))]:
            with self.subTest(name=name,value=value), self.assertRaises(PermissionError):
                gate.validate_window({**window,name:value},execution,now=1100)

    def test_proof_read_is_bounded_regular_private_and_no_links(self):
        with tempfile.TemporaryDirectory() as raw:
            root=Path(raw);p=root/'proof';p.write_text('{"uid":123}');p.chmod(0o600)
            self.assertEqual(core.alias_read(p), {'uid':123})
            link=root/'sym';link.symlink_to(p)
            with self.assertRaises(OSError):core.alias_read(link)
            os.link(p,root/'hard')
            with self.assertRaises(PermissionError):core.alias_read(p)
            (root/'hard').unlink();p.chmod(0o644)
            with self.assertRaises(PermissionError):core.alias_read(p)
            p.chmod(0o600);p.write_text('x'*16385)
            with self.assertRaises(PermissionError):core.alias_read(p)

    def test_actual_process_namespace_and_uid_not_self_report_only(self):
        # Local process evidence only; not a DynamicUser/native systemd claim.
        pid=os.getpid();mnt=Path('/proc/self/ns/mnt').stat().st_ino;net=Path('/proc/self/ns/net').stat().st_ino
        child={'mount_namespace':mnt,'network_namespace':net,'uid':os.geteuid()}
        host={'network_namespace':net+1}
        if os.geteuid()>0:self.assertTrue(core.alias_identity(child,host,pid))
        for value in ({**child,'network_namespace':True},{**child,'mount_namespace':mnt+1},{**child,'uid':0}):
            with self.assertRaises(PermissionError):core.alias_identity(value,host,pid)
        with self.assertRaises(PermissionError):core.alias_identity(child,{'network_namespace':net},pid)

    def test_payload_barrier_precedes_exit_and_parent_precedes_wait_finish(self):
        root=Path(__file__).parent
        payload=(root/'qualification_job.py').read_text();helper=(root/'qualification_helper.py').read_text()
        self.assertLess(payload.index('alias_probe.main('), payload.index("Path('host-observed.json').exists()"))
        self.assertLess(helper.index('core.alias_during(context,modules,m)'),helper.index('before=core.wait_for('))
        self.assertLess(helper.index('core.alias_after('),helper.index("'state':'NATIVE_SHORT_ALIAS_PASS'"))

    def test_generated_systemd_command_has_fixed_private_alias(self):
        runtime=Path(__file__).parent/'runtime'
        with mock.patch.object(sys,'path',[str(runtime),*sys.path]):
            spec=importlib.util.spec_from_file_location('alias_adapter_fixture',runtime/'systemd_adapter.py')
            module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        adapter=module.SystemdAdapter()
        m={'job_id':'a'*32,'generation':1};r={'unit':q.unit('a'*32)}
        descriptor={'name':'fixture-pass','python_path':'/usr/bin/python3','program':str(q.PUBLIC/'qualification_job.py')}
        command=adapter.unit_argv(m,r,descriptor)
        self.assertIn('--property=TemporaryFileSystem=/run:rw',command)
        self.assertIn('--property=BindPaths=/var/lib/peticao-dev-job-'+'a'*32+'-g1:/run/peticao-dev-work',command)
        self.assertIn('--property=WorkingDirectory=/run/peticao-dev-work',command)
        self.assertIn('TMPDIR=/run/peticao-dev-work/t',command)
        self.assertIn('HOME=/run/peticao-dev-work/h',command)
        self.assertEqual(command[-1],m['job_id'])
        self.assertIn('--property=DynamicUser=yes',command)
        self.assertIn('--property=PrivateNetwork=yes',command)

    def test_all_python_sources_parse_and_original_A_paths_are_absent(self):
        import ast
        root=Path(__file__).parent
        self.assertEqual(str(q.PRIVATE),'/mnt/apps/peticao-final/.runtime/civo-short-alias-native-20261115-attempt1')
        for path in root.rglob('*.py'):
            text=path.read_text()
            ast.parse(text,filename=str(path))
            if path.name != 'test_alias_harness.py':
                self.assertNotIn('civo-worker-broker-qual-20261115-attempt1',text)

    def test_actual_preparation_template_pins_entire_public_closure(self):
        import hashlib
        root=Path(__file__).parent
        template=json.loads((root/'OPERATION.template.json').read_text())
        q.operation(template,execution=False)
        self.assertIs(template['execute'],False)
        for field,prefix in [('runtime_sha256','runtime/'),('broker_sha256','broker/'),('harness_sha256','')]:
            for name,sha in template[field].items():
                self.assertEqual(hashlib.sha256((root/(prefix+name)).read_bytes()).hexdigest(),sha)

    def test_public_pin_sets_cover_alias_code_and_match_installer(self):
        import qualification_client as client
        self.assertTrue({'alias_contract.py','alias_probe.py'} <= q.HARNESS)
        self.assertEqual(q.HARNESS,set(core.HARNESS))
        for name in q.HARNESS:self.assertIn(name,client.INSTALLER)


if __name__=='__main__':unittest.main()
