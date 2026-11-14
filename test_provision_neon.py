import json
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import provision_neon as n


class NeonProvisionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        for name, value in [('BASE', root), ('RECEIPT', root/'receipt.json'), ('INTENT', root/'intent.json')]:
            patcher = patch.object(n, name, value); patcher.start(); self.addCleanup(patcher.stop)
        self.project = dict(id='test-project', name=n.NAME, region_id=n.REGION,
                            org_id=n.ORG, pg_version=17, created_at='2099-01-01T00:00:00Z')
        self.compute = dict(id='test-endpoint', branch_id='test-branch',
                            autoscaling_limit_min_cu=0.25, autoscaling_limit_max_cu=0.25,
                            suspend_timeout_seconds=0)
        self.bucket = dict(name='infra-artefatos', access_level='private')
        self.calls, self.gates = [], 0
        self.bucket_exists = False

    def gate(self):
        self.gates += 1

    def runner(self, args):
        self.calls.append(args)
        if args == ['api', '/organizations/' + n.ORG]:
            return {'id':n.ORG, 'plan':'free'}
        if args[:2] == ['api', '/projects/test-project/endpoints']:
            return {'endpoints': [self.compute]}
        if args[:2] == ['bucket', 'list']:
            return [self.bucket] if self.bucket_exists else []
        if args[:2] == ['bucket', 'create']:
            self.bucket_exists = True
        if args[:2] == ['projects', 'create']:
            return {'project': self.project}
        if args and args[0]=='status':
            return {'project':{'id':'test-project'}, 'branch':{'id':'test-branch'}, 'config':{}}
        if args and args[-1].endswith('/realtime'):
            return {'enabled':False}
        return {}

    def own_intent(self):
        n.save(n.INTENT, {'at':'2026-11-14T11:00:00+00:00', 'absent_before_create':True})

    def own_receipt(self):
        n.save(n.RECEIPT, {'project_id':self.project['id'], 'creation_response_bound':True,
                           'endpoint_id':'test-endpoint', 'branch_id':'test-branch'})

    def test_pagination_reads_final_empty_page(self):
        pages = [{'projects':[self.project], 'pagination':{'cursor':'one'}}, {'projects':[]}]
        with patch.object(n, 'run', side_effect=pages) as run:
            self.assertEqual(n.projects(), [self.project])
            self.assertEqual(run.call_count, 2)

    def test_partial_or_repeated_listing_never_allows_create(self):
        for pages in [[{'projects':[], 'unavailable':['some-project']}],
                      [{'projects':[self.project], 'pagination':{'cursor':'one'}}]*2]:
            with self.subTest(pages=pages), patch.object(n, 'run', side_effect=pages):
                with self.assertRaises(RuntimeError): n.projects()

    def test_duplicate_or_sao_paulo_name_rejected(self):
        for rows in [[self.project, self.project], [self.project|{'region_id':'aws-sa-east-1'}]]:
            with self.subTest(rows=rows), self.assertRaises(RuntimeError): n.select(rows)

    def test_existing_unowned_project_is_never_adopted(self):
        with patch.object(n, 'run', side_effect=self.runner):
            with self.assertRaises(RuntimeError): n.apply(self.project, self.gate)
        self.assertEqual(self.calls, [['api', '/organizations/' + n.ORG]])

    def test_create_and_resume_do_not_duplicate_project_or_bucket(self):
        with patch.object(n, 'run', side_effect=self.runner), patch.object(n, 'projects', return_value=[self.project]):
            first = n.apply(None, self.gate)
            second = n.apply(self.project, self.gate)
        self.assertTrue(first['bucket_private_verified'])
        self.assertEqual(first, second)
        self.assertEqual(sum(c[:2]==['projects','create'] for c in self.calls), 1)
        self.assertEqual(sum(c[:2]==['bucket','create'] for c in self.calls), 1)
        self.assertEqual(n.RECEIPT.stat().st_mode & 0o777, 0o600)

    def test_uncertain_create_without_provider_project_is_not_repeated(self):
        self.own_intent()
        with patch.object(n, 'run', side_effect=self.runner):
            with self.assertRaises(RuntimeError): n.apply(None, self.gate)
        self.assertEqual(self.calls, [['api', '/organizations/' + n.ORG]])

    def test_existing_public_bucket_preserved_and_rejected(self):
        self.own_intent(); self.own_receipt(); self.bucket_exists=True; self.bucket['access_level']='public_read'
        with patch.object(n, 'run', side_effect=self.runner):
            with self.assertRaises(RuntimeError): n.apply(self.project, self.gate)
        self.assertFalse(any(c[:2]==['bucket','create'] for c in self.calls))
        self.assertFalse(any('delete' in c for c in self.calls))

    def test_expired_or_wrong_lease_blocks_before_mutation(self):
        def denied(): raise RuntimeError('expired lease')
        with patch.object(n, 'run', side_effect=self.runner):
            with self.assertRaises(RuntimeError): n.apply(None, denied)
        self.assertFalse(n.INTENT.exists())
        self.assertEqual(self.calls, [['api', '/organizations/' + n.ORG]])

    def test_nonfixed_or_never_suspend_compute_preserved_not_accepted(self):
        self.own_intent(); self.own_receipt()
        for update in [dict(autoscaling_limit_max_cu=2), dict(suspend_timeout_seconds=-1)]:
            original = self.compute.copy(); self.compute.update(update)
            with patch.object(n, 'run', side_effect=self.runner):
                with self.assertRaises(RuntimeError): n.apply(self.project, self.gate)
            self.compute=original
        self.assertFalse(any('delete' in c for c in self.calls))

    def test_paid_plan_blocks_creation(self):
        with patch.object(n, 'run', return_value={'id':n.ORG, 'plan':'launch'}):
            with self.assertRaises(RuntimeError): n.apply(None, self.gate)
        self.assertFalse(n.INTENT.exists())

    def test_same_name_created_after_intent_is_not_ownership(self):
        self.own_intent()
        with patch.object(n, 'run', side_effect=self.runner):
            with self.assertRaises(RuntimeError): n.apply(self.project, self.gate)
        self.assertFalse(n.RECEIPT.exists())

    def test_returned_project_id_must_match_reconciled_id(self):
        def wrong_id(args):
            if args[:2] == ['projects','create']:
                return {'project':self.project|{'id':'other-id'}}
            return self.runner(args)
        with patch.object(n, 'run', side_effect=wrong_id), patch.object(n, 'projects', return_value=[self.project]):
            with self.assertRaises(RuntimeError): n.apply(None, self.gate)
        self.assertEqual(json.loads(n.RECEIPT.read_text())['project_id'], 'other-id')
        self.assertFalse(any(c[:2] == ['bucket','create'] for c in self.calls))

    def test_intent_exclusive_and_file_directory_fsynced(self):
        with patch.object(n.os, 'fsync', wraps=n.os.fsync) as sync:
            n.save_exclusive(n.INTENT, {'absent_before_create':True})
            self.assertEqual(sync.call_count, 2)
        before=n.INTENT.read_bytes()
        with self.assertRaises(FileExistsError): n.save_exclusive(n.INTENT, {'overwrite':True})
        self.assertEqual(before,n.INTENT.read_bytes())

    def test_changed_endpoint_or_branch_is_never_adopted_or_suspended(self):
        self.own_receipt()
        for compute in [self.compute|{'id':'replacement'}, self.compute|{'branch_id':'foreign'}]:
            with self.subTest(compute=compute), self.assertRaises(RuntimeError):
                n.verify_compute_ownership(compute)

    def test_unexpected_auxiliary_service_is_not_silently_accepted(self):
        for view in [{'auth':True}, {'dataApi':True}, {'preview':{'functions':{'f':{}}}}]:
            envelope={'project':{'id':'test-project'},'branch':{'id':'test-branch'},'config':view}
            with self.subTest(view=view), patch.object(n, 'run', return_value=envelope):
                with self.assertRaises(RuntimeError): n.verify_auxiliary_services('test-project','test-branch')

    def test_empty_or_foreign_status_frame_does_not_prove_disabled(self):
        for result in [{}, {'project':{'id':'foreign'},'branch':{'id':'test-branch'},'config':{}},
                       {'project':{'id':'test-project'},'branch':{'id':'foreign'},'config':{}},
                       {'project':{'id':'test-project'},'branch':{'id':'test-branch'}}]:
            with self.subTest(result=result), patch.object(n,'run',return_value=result):
                with self.assertRaises(RuntimeError): n.verify_auxiliary_services('test-project','test-branch')

    def test_manifest_binds_commit_and_every_reviewed_file(self):
        files=['provision_neon.py','test_provision_neon.py','NEON-PROCEDURE.md',
               'budget_policy.py','test_budget_policy.py','WORKER-PROFILES.json']
        for name in files:(n.BASE/name).write_text(name)
        notice={'data':{'manifest':{'commit':'a'*40,'files':files},
                         'file_sha256':{f:hashlib.sha256((n.BASE/f).read_bytes()).hexdigest() for f in files}}}
        n.verify_source_pin(notice,'a'*40)
        with self.assertRaises(RuntimeError):n.verify_source_pin(notice,'b'*40)
        (n.BASE/'WORKER-PROFILES.json').write_text('drift')
        with self.assertRaises(RuntimeError):n.verify_source_pin(notice,'a'*40)


if __name__ == '__main__': unittest.main()
