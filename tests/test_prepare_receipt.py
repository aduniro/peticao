"""Full CLI regression using real temporary Git and ledger databases, never live state."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('prepare_receipt', ROOT / 'scripts/prepare_receipt.py')
receipt = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(receipt)
COORD = ROOT.parent / 'coordenacao-dupla/tools/coord.py'
CSPEC = importlib.util.spec_from_file_location('fixture_coord', COORD)
coord = importlib.util.module_from_spec(CSPEC)
CSPEC.loader.exec_module(coord)


class ReceiptTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.root = base / 'infra'
        self.root.mkdir()
        (self.root / 'private').mkdir()
        (self.root / '.gitignore').write_text('/private/\n')
        (self.root / 'cluster.json').write_text(json.dumps({'nodes': {'local': {'ip': '100.105.193.63'}}}))
        self.hashes = {}
        for name in ['config.yaml', 'guard.nft', 'apply_guard.py', 'peticao-k3s.service', 'peticao-k3s-guard.service']:
            path = self.root / 'manifests/local' / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('Reviewed synthetic fixture: ' + name + '\n')
            self.hashes[name] = hashlib.sha256(path.read_bytes()).hexdigest()
        env = {**os.environ, 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null'}
        git = ['git', '-C', str(self.root), '-c', 'core.hooksPath=/dev/null',
               '-c', 'user.name=Fixture', '-c', 'user.email=fixture@invalid']
        for argv in [['init', '-q', '-b', 'fixture'], ['add', '.'], ['commit', '-qm', 'fixture']]:
            subprocess.run(git + argv, check=True, capture_output=True, env=env)
        head = subprocess.check_output(git + ['rev-parse', 'HEAD'], text=True, env=env).strip()
        self.db = base / 'coord.sqlite'
        self.ledger = coord.Ledger(self.db)
        for actor, session in [('apoio', 'fixture-a'), ('admin', 'fixture-b'), ('admin-recuperacao', 'fixture-c')]:
            self.ledger.register(actor, session, [str(self.root)])
        notice = self.ledger.announce('admin-recuperacao', 'Fixture handoff', ['coord:actors'],
                                     {'actor_handoff': {'prior': 'admin', 'replacement': 'admin-recuperacao',
                                                        'session': 'fixture-c', 'owner_reference': 'Synthetic owner fixture'}})
        self.ledger.ack('apoio', notice['seq'])
        self.ledger.handoff('admin-recuperacao', 'admin', notice['seq'])
        notice = self.ledger.announce('admin-recuperacao', 'Fixture reviewed provision', ['coord:k3s/local'],
                                     {'provision': {'node': 'local', 'destination': '100.105.193.63:/etc/rancher/peticao-k3s',
                                                    'source_root': str(self.root), 'owner_reference': 'Synthetic fixture',
                                                    'commit': head, 'manifest_sha256': self.hashes}})
        self.event = notice['seq']
        self.ledger.ack('apoio', self.event)
        # The CLI's loader gets the actual Ledger implementation, bound only to this temp DB.
        self.bridge = base / 'coord_bridge.py'
        self.bridge.write_text('import importlib.util\n'
                              f's=importlib.util.spec_from_file_location("original",{str(COORD)!r})\n'
                              'm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\n'
                              f'def Ledger(): return m.Ledger({str(self.db)!r})\n')

    def tearDown(self):
        self.tmp.cleanup()

    def issue(self, lease):
        path = self.root / 'private/lease.json'
        path.write_text(json.dumps(lease))
        argv = ['prepare_receipt.py', '--node', 'local', '--manifest-event', str(self.event), '--lease-file', str(path)]
        with patch.object(receipt, 'ROOT', self.root), patch.object(receipt, 'COORD', self.bridge), patch('sys.argv', argv), contextlib.redirect_stdout(io.StringIO()):
            receipt.main()
        return json.loads((self.root / 'private/local-install-receipt.json').read_text())

    def test_forging_only_lease_file_scope_does_not_issue_receipt(self):
        lease = self.ledger.acquire('admin-recuperacao', ['coord:unrelated-review-fixture'], ttl=3600)
        lease['resources'] = ['coord:k3s/local']
        with self.assertRaises(PermissionError): self.issue(lease)
        self.assertFalse((self.root / 'private/local-install-receipt.json').exists())

    def test_authoritative_scope_is_used_even_when_file_metadata_is_wrong(self):
        lease = self.ledger.acquire('admin-recuperacao', ['coord:k3s/local'], ttl=3600)
        lease['resources'] = ['coord:unrelated-review-fixture']
        lease['expires'] = 0
        issued = self.issue(lease)
        self.assertEqual(issued['lease_resources'], ['coord:k3s/local'])
        self.assertEqual(issued['lease_id'], lease['lease'])
        self.assertGreater(issued['lease_expires_at'], time.time() + 300)

    def test_forged_expiry_cannot_extend_real_lease_margin(self):
        lease = self.ledger.acquire('admin-recuperacao', ['coord:k3s/local'], ttl=3600)
        with self.ledger.db(True) as db:
            db.execute('UPDATE leases SET expires=? WHERE id=?', (time.time() + 250, lease['lease']))
        lease['expires'] = time.time() + 100000
        with self.assertRaises(PermissionError): self.issue(lease)
        self.assertFalse((self.root / 'private/local-install-receipt.json').exists())

    def test_wrong_token_cannot_use_authoritative_scope(self):
        lease = self.ledger.acquire('admin-recuperacao', ['coord:k3s/local'], ttl=3600)
        lease['token'] = 'wrong-token'
        with self.assertRaises(PermissionError): self.issue(lease)
