"""Real local process/socket lifetime with fake refs; no native fencing proof."""
import json
import os
from pathlib import Path
import signal
import select
import socket
import subprocess
import sys
import tempfile
import textwrap
import unittest
import hashlib
import ast
from unittest import mock

import fence_server as server
import fence_wire as wire
import legacy_fence as core
import test_bootstrap_fencing as baseline

HERE = Path(__file__).resolve().parent


class FakeRefs(baseline.FakeRefs):
    def __init__(self, events):
        super().__init__(events)
        self.records, self.lost, self.closed = {}, False, False
    def acquire(self, unit, invocation):
        super().acquire(unit, invocation)
        self.records[unit] = {'state': 'held', 'invocation_id': invocation}
    def release(self, unit, invocation):
        value = super().release(unit, invocation)
        self.records[unit]['state'] = 'released'
        return value
    def close(self):
        if any(row['state'] != 'released' for row in self.records.values()):
            raise PermissionError('fixture refuses close while held')
        self.closed = True


def controller(context):
    refs = FakeRefs(context.events)
    context.fence.refs = None
    owner = server.Controller(context.fence, context.journal, lambda: refs,
                              lambda request: None, native=False)
    return owner, refs


class OwnerTests(baseline.FileContext, unittest.TestCase):
    def setUp(self):
        self.ctx = baseline.FencingTests()
        self.ctx.setUp()
        self.owner, self.refs = controller(self.ctx)

    def tearDown(self):
        self.ctx.journal.close()
        self.ctx.tearDown()

    def test_one_shot_core_never_opens_native_references(self):
        with mock.patch.object(core, 'references') as factory:
            with self.assertRaises(PermissionError):
                core.main({'action': 'fence'})
            factory.assert_not_called()

    def test_known_stop_fault_keeps_owner_and_references_for_readonly(self):
        self.ctx.manager.fail_stop = True
        with self.assertRaises(TimeoutError):
            self.owner.handle({'action': 'fence'})
        self.assertTrue(self.owner.quarantined)
        self.assertEqual(len(self.refs.held), 2)
        self.assertFalse(self.refs.closed)
        self.assertEqual(self.owner.handle({'action': 'observe'})['state'], 'uncertain')
        with self.assertRaises(PermissionError):
            self.owner.handle({'action': 'fence'})
        with self.assertRaises(PermissionError):
            self.owner.handle({'action': 'shutdown'})
        with self.assertRaises(PermissionError):
            self.owner.close_if_safe()
        self.assertFalse(self.refs.closed)

    def test_clean_completion_then_shutdown_is_explicit_and_safe(self):
        self.assertEqual(self.owner.handle({'action': 'fence'})['state'], 'fenced')
        self.assertFalse(self.owner.unsafe_references())
        self.assertEqual(self.owner.handle({'action': 'shutdown'})['state'], 'shutdown_ready')
        self.owner.close_if_safe()
        self.assertTrue(self.refs.closed)

    def test_sigterm_or_stop_request_during_uncertainty_does_not_drop_bus(self):
        self.ctx.manager.fail_stop = True
        with self.assertRaises(TimeoutError):
            self.owner.handle({'action': 'fence'})
        self.assertFalse(self.owner.signal_stop())
        self.assertFalse(self.owner.shutdown_requested)
        self.assertFalse(self.refs.closed)

    def test_fresh_process_never_rearms_interrupted_journal(self):
        self.ctx.journal.record('fence-intent.json', {'operation_id': baseline.OP})
        factory = mock.Mock()
        owner = server.Controller(self.ctx.fence, self.ctx.journal, factory, lambda _: None, native=False)
        self.assertTrue(owner.recovered_readonly)
        with self.assertRaises(PermissionError):
            owner.handle({'action': 'fence'})
        factory.assert_not_called()
        self.assertEqual(owner.handle({'action': 'observe'})['state'], 'uncertain')

    def test_controlled_cancellation_interrupts_next_mutation_without_closing_held_refs(self):
        original = self.ctx.manager.stop
        def stop_then_terminate(unit):
            original(unit)
            self.owner.signal_stop()
        self.ctx.manager.stop = stop_then_terminate
        with self.assertRaises(RuntimeError):
            self.owner.handle({'action': 'fence'})
        self.assertTrue(self.owner.quarantined)
        self.assertFalse(self.owner.shutdown_requested)
        self.assertFalse(self.refs.closed)
        self.assertEqual(sum(kind == 'stop' for kind, _ in self.ctx.events), 1)
        self.assertEqual(len(self.refs.held), 2)

    def test_parent_directory_swap_after_held_receipt_blocks_before_any_unref(self):
        original = self.ctx.journal.record
        def swapped(name, value):
            digest = original(name, value)
            if name == 'fenced-held.json':
                root = self.ctx.journal.root
                root.rename(root.with_name(root.name + '-retained-fixture'))
                root.mkdir(mode=0o700)
            return digest
        self.ctx.journal.record = swapped
        with self.assertRaises(PermissionError):
            self.owner.handle({'action': 'fence'})
        self.assertEqual(len(self.refs.held), 2)
        self.assertFalse(any(kind == 'unref' for kind, _ in self.ctx.events))
        self.assertTrue(self.owner.quarantined)

    def test_journal_anchor_rejects_mode_inode_or_parent_reachability_changes(self):
        original = self.ctx.journal.root
        original.chmod(0o755)
        with self.assertRaises(PermissionError):
            self.ctx.journal.read('fence-intent.json')
        original.chmod(0o700)
        original.rename(original.with_name(original.name + '-moved'))
        original.mkdir(mode=0o700)
        with self.assertRaises(PermissionError):
            self.ctx.journal.record('fence-intent.json', {'operation_id': baseline.OP})


class WireTests(unittest.TestCase):
    def test_core_pin_matches_server_and_proxy_before_unvalidated_compile(self):
        expected = hashlib.sha256((HERE / 'legacy_fence.py').read_bytes()).hexdigest()
        for name in ('fence_server.py', 'fence_proxy.py'):
            assignments = [node for node in ast.parse((HERE / name).read_bytes()).body if isinstance(node, ast.Assign)]
            values = [node.value.value for node in assignments if any(isinstance(target, ast.Name) and target.id == 'CORE_SHA256' for target in node.targets)]
            self.assertEqual(values, [expected])

    def test_real_unix_peer_rejects_foreign_uid_before_receive(self):
        left, right = socket.socketpair()
        try:
            with mock.patch.object(wire, 'receive') as receive:
                with self.assertRaises(PermissionError):
                    wire.peer(right, owner=os.geteuid() + 1)
                receive.assert_not_called()
        finally:
            left.close()
            right.close()

    def test_bounded_framing_over_real_local_socket(self):
        left, right = socket.socketpair()
        try:
            wire.send(left, {'action': 'observe'})
            self.assertEqual(wire.receive(right), {'action': 'observe'})
            self.assertEqual(wire.peer(right, owner=os.geteuid())[1], os.geteuid())
            if os.geteuid() != 0:
                with self.assertRaises(PermissionError):
                    wire.peer(right)
        finally:
            left.close()
            right.close()

    def test_oversized_frame_refused_without_reading_body(self):
        left, right = socket.socketpair()
        try:
            left.sendall((wire.LIMIT + 1).to_bytes(4, 'big'))
            with self.assertRaises(ValueError):
                wire.receive(right)
        finally:
            left.close()
            right.close()


CHILD = r'''
import os,signal,socket,sys
from pathlib import Path
sys.path.insert(0,sys.argv[1])
import fence_server,fence_wire
import test_bootstrap_fencing as b
from test_persistent_owner import controller
ctx=b.FencingTests();ctx.setUp();ctx.manager.fail_stop=True
owner,refs=controller(ctx)
signal.signal(signal.SIGTERM,owner.signal_stop)
sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);sock.bind('s');sock.listen(4)
print('READY_FAKE_REFERENCE_OWNER',flush=True)
fence_server.run_owner(sock,owner,fence_wire,lambda connection:fence_wire.peer(connection,owner=os.geteuid()))
'''


class ProcessLifetimeTests(unittest.TestCase):
    def test_actual_process_survives_fault_disconnect_sigterm_and_shutdown_refusal(self):
        # Child's fake reference backend is explicit. This tests the previously
        # missing CLI/process-exit boundary without touching systemd/SD-bus.
        with tempfile.TemporaryDirectory(prefix='keeper-process-', dir=HERE) as folder:
            process = subprocess.Popen([sys.executable, '-s', '-E', '-B', '-u', '-c', CHILD, str(HERE)],
                                       cwd=folder, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                       text=True, env={'PATH': '/usr/bin:/bin'})
            def call(action):
                cwd = os.open('.', os.O_RDONLY | os.O_DIRECTORY)
                sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                sock.settimeout(3)
                try:
                    os.chdir(folder)
                    sock.connect('s')
                    wire.send(sock, {'action': action})
                    return wire.receive(sock)
                finally:
                    os.fchdir(cwd)
                    os.close(cwd)
                    sock.close()
            try:
                self.assertTrue(select.select([process.stdout], [], [], 5)[0], 'fixture owner startup timed out')
                self.assertEqual(process.stdout.readline().strip(), 'READY_FAKE_REFERENCE_OWNER')
                self.assertFalse(call('fence')['ok'])
                self.assertIsNone(process.poll())
                result = call('observe')
                self.assertEqual(result['result']['state'], 'uncertain')
                self.assertTrue(result['result']['references_unreleased_or_uncertain'])
                os.kill(process.pid, signal.SIGTERM)
                self.assertTrue(call('observe')['ok'])
                self.assertFalse(call('shutdown')['ok'])
                self.assertIsNone(process.poll())
            finally:
                # Only an explicitly fake local fixture is killed for teardown.
                # Production owners must never be force-killed to clear state.
                if process.poll() is None:
                    process.kill()
                out, err = process.communicate(timeout=5)
                self.assertEqual(err, '')


if __name__ == '__main__':
    unittest.main()
