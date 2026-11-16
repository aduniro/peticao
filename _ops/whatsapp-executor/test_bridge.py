import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('bridge', pathlib.Path(__file__).with_name('bridge.py'))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class BridgeTests(unittest.TestCase):
    def setUp(self):
        temporary_root = pathlib.Path('/mnt/apps/peticao-final/.tmp/whatsapp-tests')
        temporary_root.mkdir(parents=True, exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(dir=temporary_root)
        self.addCleanup(self.tmp.cleanup)
        state = pathlib.Path(self.tmp.name)
        self.cfg = {'executor': 'exec-test', 'vigia': 'vigia-test', 'owner_chat': 'test@c.us',
                    'owner_aliases': ['test@lid'], 'enabled_at': 100, 'vigia_enabled_at': 100, 'reports_enabled': False}
        self.p1 = patch.object(bridge, 'STATE', state)
        self.p2 = patch.object(bridge, 'config', return_value=self.cfg)
        self.p1.start()
        self.p2.start()
        self.addCleanup(self.p1.stop)
        self.addCleanup(self.p2.stop)
        bridge.initialize()
        self.message = {'id': 'm1', 'from': 'test@lid', 'fromMe': False, 'timestamp': 101, 'body': 'status'}

    def test_owner_only(self):
        for fields in [{'from': 'stranger@c.us'}, {'fromMe': True}, {'fromMe': None}, {'participant': 'member@c.us'},
                       {'timestamp': 99}, {'id': None}]:
            self.assertFalse(bridge.accept({**self.message, **fields}, 'exec-test'))
        self.assertFalse(bridge.accept(self.message, 'unknown-test'))
        self.assertTrue(bridge.accept(self.message, 'exec-test'))

    def test_duplicate_receipt_does_not_execute_twice(self):
        self.assertTrue(bridge.accept(self.message, 'exec-test'))
        self.assertFalse(bridge.accept(self.message, 'exec-test'))
        with bridge.db() as c:
            self.assertEqual(c.execute('SELECT count(*) FROM inbox').fetchone()[0], 1)

    def test_restart_preserves_uncertain_effects(self):
        bridge.accept(self.message, 'exec-test')
        with bridge.db() as c:
            c.execute("UPDATE inbox SET state='running'")
            c.execute("INSERT INTO sends(id,state,message_id,at) VALUES('s','sending',NULL,1)")
        bridge.initialize()
        with bridge.db() as c:
            self.assertEqual(c.execute('SELECT state FROM inbox').fetchone()[0], 'interrupted')
            self.assertEqual(c.execute('SELECT state FROM sends').fetchone()[0], 'uncertain')

    def test_uncertain_send_is_not_retried(self):
        with patch.object(bridge, 'request', side_effect=TimeoutError) as req:
            self.assertFalse(bridge.send_once('send-test', 'exec-test', 'hello'))
            self.assertFalse(bridge.send_once('send-test', 'exec-test', 'hello'))
            self.assertEqual(req.call_count, 1)

    def test_channels_accept_owner_and_have_separate_deduplication(self):
        self.assertTrue(bridge.accept(self.message, 'exec-test'))
        self.assertTrue(bridge.accept(self.message, 'vigia-test'))
        self.assertFalse(bridge.accept(self.message, 'vigia-test'))
        with bridge.db() as c:
            self.assertEqual(c.execute('SELECT count(DISTINCT session) FROM inbox').fetchone()[0], 2)
        self.assertFalse(bridge.accept({**self.message, 'id': 'foreign', 'from': 'stranger@c.us'}, 'vigia-test'))
        self.assertFalse(bridge.accept({**self.message, 'id': 'outbound', 'fromMe': True}, 'vigia-test'))

    def test_cutover_never_executes_old_vigia_history(self):
        self.cfg['vigia_enabled_at'] = 102
        self.assertFalse(bridge.accept(self.message, 'vigia-test'))
        self.assertTrue(bridge.accept({**self.message, 'timestamp': 103}, 'vigia-test'))

    def test_threads_are_exclusive_and_legacy_meta_preserved(self):
        bridge.setmeta('codex_thread', 'historical-tui-thread')
        bridge.setmeta(bridge.thread_key('exec-test'), 'executor-exclusive')
        bridge.setmeta(bridge.thread_key('vigia-test'), 'vigia-exclusive')
        self.assertNotEqual(bridge.thread_key('exec-test'), bridge.thread_key('vigia-test'))
        self.assertEqual(bridge.meta('codex_thread'), 'historical-tui-thread')
        self.assertEqual(bridge.meta(bridge.thread_key('vigia-test')), 'vigia-exclusive')

    def test_failed_history_is_not_queued_by_restart(self):
        bridge.accept(self.message, 'exec-test')
        with bridge.db() as c:
            c.execute("UPDATE inbox SET state='failed', result='preserved-job'")
        bridge.initialize()
        with bridge.db() as c:
            row = c.execute('SELECT state,result FROM inbox').fetchone()
            self.assertEqual(tuple(row), ('failed', 'preserved-job'))

    def test_long_vigia_response_is_escaped_html_and_correct_channel(self):
        text = '<script>alert(1)</script><img src=https://tracking.invalid/p>' + 'x' * 3600
        with patch.object(bridge, 'send_once', return_value=True) as send:
            bridge.respond('r1', text, 'vigia-test')
            self.assertEqual(send.call_args.args[1], 'vigia-test')
            f = send.call_args.kwargs['file']
            self.assertEqual(f.suffix, '.html')
            contents = f.read_text()
            self.assertNotIn('<script>', contents)
            self.assertNotIn('<img ', contents)
            self.assertIn('&lt;script&gt;', contents)
            self.assertIn('Content-Security-Policy', contents)

    def test_direct_vigia_report_upload_converts_text_to_html(self):
        f = pathlib.Path(self.tmp.name) / 'report.txt'
        f.write_text('Detailed <unsafe> report')
        with patch.object(bridge, 'request', return_value={'id': 'fake-upload'}) as request:
            bridge.send_once('html-only', 'vigia-test', file=f)
        upload = request.call_args.args[1]['file']
        self.assertTrue(upload['filename'].endswith('.html'))
        self.assertEqual(upload['mimetype'], 'text/html')

    def test_actual_worker_uses_channel_thread_and_reply(self):
        bridge.setmeta('codex_thread', 'DO-NOT-RESUME-TUI')
        bridge.setmeta(bridge.thread_key('vigia-test'), 'vigia-exclusive')
        bridge.accept(self.message, 'vigia-test')
        with bridge.db() as c:
            row = dict(c.execute('SELECT * FROM inbox').fetchone())
        captured = []
        class FakeProcess:
            returncode = 0
            def __init__(self, args, **kwargs):
                captured.extend(args)
                self.output = pathlib.Path(args[args.index('-o') + 1])
                kwargs['stdout'].write(json.dumps({'type': 'thread.started', 'thread_id': 'vigia-exclusive'}) + '\n')
                kwargs['stdout'].flush()
            def communicate(self, prompt):
                self.output.write_text('OK')
        with patch.object(bridge.subprocess, 'Popen', FakeProcess), patch.object(bridge, 'respond') as respond:
            bridge.Executor().run(row)
        self.assertIn('vigia-exclusive', captured)
        self.assertNotIn('DO-NOT-RESUME-TUI', captured)
        self.assertTrue(all(call.args[2] == 'vigia-test' for call in respond.call_args_list))
        self.assertEqual(bridge.meta('codex_thread'), 'DO-NOT-RESUME-TUI')
        with bridge.db() as c:
            self.assertEqual(c.execute('SELECT state FROM inbox').fetchone()[0], 'completed')

    def test_cancel_other_channel_does_not_interrupt_worker(self):
        worker = bridge.Executor()
        worker.session = 'exec-test'
        self.assertFalse(worker.cancel('vigia-test'))

    def test_credentials_never_follow_external_media(self):
        msg = {'hasMedia': True, 'media': {'url': 'https://attacker.invalid/api/files/a', 'mimetype': 'image/png'}}
        with self.assertRaisesRegex(ValueError, 'untrusted_media_origin'):
            bridge.download_media(msg, pathlib.Path(self.tmp.name))

    def test_path_not_trusted_even_on_localhost(self):
        msg = {'hasMedia': True, 'media': {'url': 'http://localhost/admin', 'mimetype': 'audio/ogg'}}
        with self.assertRaisesRegex(ValueError, 'untrusted_media_path'):
            bridge.download_media(msg, pathlib.Path(self.tmp.name))

    def test_message_id_object(self):
        self.assertEqual(bridge.message_id({'_serialized': 'serialized', 'id': 'inner'}), 'serialized')

    def test_report_is_complete_and_not_repeated(self):
        folder = pathlib.Path(self.tmp.name)
        report = folder / 'latest-report.txt'
        report.write_text('Relatório completo de teste com todas as etapas.')
        report.with_suffix('.html').write_text('<p>Relatório completo de teste.</p>')
        self.cfg['reports_enabled'] = True
        with patch.object(bridge, 'REPORT', report), patch.object(bridge, 'MONITOR', folder / 'absent.sqlite'), \
             patch.object(bridge, 'request', return_value={'id': 'fake-test-receipt'}) as req:
            bridge.mirror_reports()
            self.assertEqual(req.call_count, 2)
            uploads = [call.args[1]['file'] for call in req.call_args_list if call.args[0] == '/api/sendFile']
            self.assertEqual(len(uploads), 1)
            import base64
            rendered = base64.b64decode(uploads[0]['data']).decode()
            self.assertIn(report.read_text(), rendered)
            self.assertTrue(uploads[0]['filename'].endswith('.html'))
            bridge.mirror_reports()
            self.assertEqual(req.call_count, 2)

    def test_delivery_ack_is_checked_without_resending(self):
        with patch.object(bridge, 'request', return_value={'id': 'test-mid', 'ack': 0}):
            bridge.send_once('ack-test', 'vigia-test', 'test')
        with patch.object(bridge, 'request', return_value={'ack': 3}) as req:
            bridge.refresh_deliveries()
            self.assertEqual(req.call_count, 1)
            self.assertTrue(req.call_args.args[0].endswith('/messages/test-mid'))
        with bridge.db() as c:
            row = c.execute('SELECT state,ack FROM sends WHERE id=?', ('ack-test',)).fetchone()
            self.assertEqual((row['state'], row['ack']), ('read', 3))
        with patch.object(bridge, 'request') as req:
            bridge.refresh_deliveries()
            req.assert_not_called()

    def test_uncertain_sends_are_not_retried_by_delivery_audit(self):
        with patch.object(bridge, 'request', side_effect=TimeoutError):
            bridge.send_once('ack-uncertain', 'vigia-test', 'test')
        with patch.object(bridge, 'request') as req:
            bridge.refresh_deliveries()
            req.assert_not_called()


    def test_receiver_cutover_rejects_backlog(self):
        self.cfg['receiver_cutover_at'] = 102
        self.assertFalse(bridge.accept(self.message, 'exec-test'))
        self.assertTrue(bridge.accept({**self.message, 'timestamp': 103}, 'exec-test'))

    def test_forward_both_channels_once_preserves_old_threads(self):
        from types import SimpleNamespace
        self.cfg['coordinator_thread'] = '01a1cad7-4a65-7d43-b8c2-f0b50a90a580'
        bridge.setmeta('executor_thread', 'old-history')
        response = SimpleNamespace(returncode=0, stdout='Queued message 11111111-1111-1111-1111-111111111111', stderr='')
        with patch.object(bridge, 'respond', return_value=True), patch.object(bridge, 'download_media', return_value=(None, None)), patch.object(bridge.subprocess, 'run', return_value=response) as run:
            for session in ('exec-test', 'vigia-test'):
                bridge.accept(self.message, session)
                with bridge.db() as c:
                    row = c.execute('SELECT * FROM inbox WHERE session=?', (session,)).fetchone()
                bridge.Executor().run(row)
                bridge.Executor().run(row)
            self.assertEqual(run.call_count, 2)
            self.assertIn('--remote', run.call_args.args[0])
            self.assertNotIn('status', run.call_args.args[0])
        self.assertEqual(bridge.meta('executor_thread'), 'old-history')
        with bridge.db() as c:
            rows = c.execute('SELECT state,result FROM inbox').fetchall()
        self.assertTrue(all(r['state'] == 'forwarded' for r in rows))
        for row in rows:
            packet = json.loads((pathlib.Path(row['result']) / 'authenticated-request.json').read_text())
            self.assertEqual(packet['source'], 'owner_authenticated_whatsapp')
            self.assertEqual(packet['body'], 'status')

    def test_forward_failure_not_replayed_on_restart(self):
        self.cfg['coordinator_thread'] = '01a1cad7-4a65-7d43-b8c2-f0b50a90a580'
        bridge.accept(self.message, 'vigia-test')
        with bridge.db() as c:
            row = c.execute('SELECT * FROM inbox').fetchone()
        with patch.object(bridge, 'respond', return_value=True), patch.object(bridge, 'download_media', return_value=(None, None)), patch.object(bridge.subprocess, 'run', side_effect=TimeoutError) as run:
            bridge.Executor().run(row)
            bridge.initialize()
            bridge.Executor().run(row)
            self.assertEqual(run.call_count, 1)
        with bridge.db() as c:
            self.assertEqual(c.execute('SELECT state FROM inbox').fetchone()[0], 'failed')

    def test_coordinator_reply_stays_in_authenticated_channel(self):
        bridge.accept(self.message, 'vigia-test')
        with bridge.db() as c:
            row = c.execute('SELECT id FROM inbox').fetchone()
            c.execute("UPDATE inbox SET state='forwarded'")
        with patch.object(bridge, 'respond', return_value=True) as respond:
            self.assertTrue(bridge.coordinator_reply(row['id'], 'Resposta'))
            self.assertEqual(respond.call_args.args[2], 'vigia-test')
        with bridge.db() as c:
            self.assertEqual(c.execute('SELECT state FROM inbox').fetchone()[0], 'completed')
        with self.assertRaises(ValueError):
            bridge.coordinator_reply('foreign', 'Resposta')


    def test_readable_report_uses_sections_and_lists_without_raw_pre(self):
        destination = pathlib.Path(self.tmp.name) / 'layout.html'
        bridge.render_report('Acompanhamento', '# Decisões\n\nTexto **importante**.\n\n- Uma decisão\n- Outra decisão', destination)
        source = destination.read_text()
        self.assertIn('<h2>Decisões</h2>', source)
        self.assertIn('<strong>importante</strong>', source)
        self.assertIn('<ul><li>', source)
        self.assertNotIn('<pre>', source)
        self.assertIn('@media', source)


if __name__ == '__main__':
    unittest.main()
