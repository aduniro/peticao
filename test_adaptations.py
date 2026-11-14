"""Static provenance and pure helper tests; never starts app, PostgreSQL or browsers."""
import ast
import hashlib
from pathlib import Path
import subprocess
import unittest

HERE = Path(__file__).resolve().parent
CANONICAL = Path('/mnt/apps/peticao-final/_ops/admin-v2-query-r1-20261114/phase2')
BROWSER = Path('/mnt/apps/peticao-final/_ops/drafts/admin-query-r1-20261114/tools/admin-qa/signature-explorer-r1-browser.py')
PINS = {
    'qa-runtime.mjs': '2f811426ef55a240fb33b4d3da8c979b8a38ff15fe272ab356d40ffeab7c7ff2',
    'fixture.ts': 'd3bbfc5afb2f76886a4f2e0c1f7bb38775b82f0e16581b7ce89712b988f8ddd9',
    'backend-smoke.mjs': '09464c21ee3b4f3873d8ca20e8f9f71e613fb2d318c03ab4bfac065c8d93882e',
    'http-regression.mjs': 'f60d422fb565d26e1b3e10d7f8c3ff094ebe63b4d7838d2f7e8419021d797dc3',
    'network-guard.cjs': 'bcd61a16e6006842b0c9489e32dbac6216dbc4754754eaf9d5f1e86c8d8a780d',
    'refresh-fixture-session.mjs': '5e00c63ac4efdc951fa992ffec79cbf8714dffb9e387df5b757c96f1978cb823',
    'real-map-browser.py': '9f92403eb5288ee7294bc61174dc1a57e60e62842f7214dccd9c627deba0d1bc',
    'signature-explorer-r1-browser.py': '6ab3f61322d29346e530be7491fe7b352a92fda0511fab842a4744e051895665',
}


class AdaptationTests(unittest.TestCase):
    def source(self, name):
        return BROWSER if name == BROWSER.name else CANONICAL / name

    def expected(self, name):
        text = self.source(name).read_text()
        if name == BROWSER.name:
            return text.replace('3171', '3184')
        text = text.replace('/opt/peticao-qa/admin-query-r1-20261114-retry1/qa', '/mnt/apps/peticao-final/.qt1').replace('54511', '54524').replace('3171', '3184').replace("root+'/tmp", "root+'/t").replace("root+'/empty", "root+'/e")
        if name == 'qa-runtime.mjs':
            text = text.replace("['pg-http','empty','tmp','outbox']", "['pg-http','e','t','outbox']")
            text = text.replace('const common={PATH:', "const common={HOME:root+'/e',XDG_CACHE_HOME:root+'/c',XDG_CONFIG_HOME:root+'/g',XDG_RUNTIME_DIR:root+'/r',TMP:root+'/t',TEMP:root+'/t',PATH:")
        return text

    def test_exact_frozen_provenance_and_only_authorized_substitutions(self):
        for name, sha in PINS.items():
            with self.subTest(name=name):
                self.assertEqual(hashlib.sha256(self.source(name).read_bytes()).hexdigest(), sha)
                self.assertEqual((HERE / name).read_text(), self.expected(name))

    def test_syntax_without_executing_qa(self):
        for name in [*PINS, 'qa-driver.mjs']:
            with self.subTest(name=name):
                if name.endswith('.py'):
                    ast.parse((HERE / name).read_text())
                elif name.endswith(('.mjs', '.cjs')):
                    result = subprocess.run(['/usr/bin/node', '--check', str(HERE / name)], capture_output=True, text=True)
                    self.assertEqual(result.returncode, 0, result.stderr)

    def test_actual_map_assertions_and_browser_modes_preserved(self):
        maps = (HERE / 'real-map-browser.py').read_text()
        for assertion in ["assert data['total'] == 22 and len(data['linhas']) == 22", "assert response.status == 200", "expect(page.locator('.leaflet-container')).to_be_visible(timeout=30000)", "assert result['pageErrors'] == []", "'explorerMocked': False"]:
            self.assertIn(assertion, maps)
        browser = (HERE / BROWSER.name).read_text()
        self.assertIn('parsed_base.port == 3184', browser)
        self.assertIn('if args.mode == "compiled-next":', browser)
        self.assertIn('assert not results["blockedWrites"]', browser)
        self.assertIn('assert not results["pageErrors"]', browser)

    def test_driver_preserves_order_private_cookie_and_finally_cleanup(self):
        text = (HERE / 'qa-driver.mjs').read_text()
        sequence = ["summary.backend = assertBackendTap", "'/backend-smoke.mjs'", "'/signature-explorer-r1-browser.py'", "'/real-map-browser.py'", "'/http-regression.mjs'", "'/refresh-fixture-session.mjs'"]
        positions = [text.index(item) for item in sequence]
        self.assertEqual(positions, sorted(positions))
        self.assertIn("'--mode', 'compiled-next'", text)
        self.assertIn("'--cookies-file', ROOT + '/fixture.private.json'", text)
        self.assertIn('} finally {\n    try {\n      summary.cleanup = await stopOwned(runtime);', text)
        self.assertIn("handle.child.kill('SIGTERM')", text)
        self.assertIn('waitDone(handle, 20000)', text)
        self.assertIn("process.kill(-handle.child.pid, 'SIGKILL')", text)
        self.assertIn('summary.cleanup.forced', text)
        self.assertIn("console.log(JSON.stringify(summary))", text)
        self.assertNotIn('console.log(fixture', text)
        self.assertNotIn('console.log(jsonFile', text)
        self.assertNotIn('...process.env', text)
        self.assertNotIn('console.error', text)
        self.assertIn('0o600', text)
        refresh = (HERE / 'refresh-fixture-session.mjs').read_text()
        self.assertIn('token not printed.', refresh)
        self.assertNotIn('console.log(token)', refresh)

    def test_node_pure_helpers_reject_count_or_assertion_failures(self):
        uri = (HERE / 'qa-driver.mjs').as_uri()
        code = """
import assert from 'node:assert/strict';
import {assertBackendTap, assertCheckReport, cleanEnv} from 'DRIVER_URI';
assert.equal(assertBackendTap('# tests 43\\n# pass 43\\n# fail 0\\n'), 43);
for (const text of ['# tests 42\\n# pass 42\\n# fail 0\\n', '# tests 43\\n# pass 42\\n# fail 1\\n', '# tests 43\\n# pass 43\\n# fail 0\\n# fail 0\\n']) assert.throws(() => assertBackendTap(text));
assert.equal(assertCheckReport({ok:true,checks:Array(7)},7),7);
assert.equal(assertCheckReport({status:'PASS',checks:Array(40),pageErrors:[],blockedWrites:[]},40,'status'),40);
assert.throws(() => assertCheckReport({ok:false,checks:Array(7)},7));
assert.throws(() => assertCheckReport({ok:true,checks:Array(6)},7));
assert.throws(() => assertCheckReport({ok:true,checks:Array(2),pageErrors:['failure']},2));
const env=cleanEnv();
assert.equal(env.HOME,'/mnt/apps/peticao-final/.qt1/e');
assert.equal(env.TMPDIR,'/mnt/apps/peticao-final/.qt1/t');
assert.equal(env.XDG_RUNTIME_DIR,'/mnt/apps/peticao-final/.qt1/r');
assert.equal(env.SECRET_FROM_CALLER,undefined);
assert.equal(env.QA_PLAYWRIGHT_PYTHON_PATH,undefined);
assert.equal(env.PLAYWRIGHT_NODEJS_PATH,'/usr/local/bin/node');
""".replace('DRIVER_URI', uri)
        result = subprocess.run(['/usr/bin/node', '--input-type=module', '-e', code], capture_output=True, text=True, env={'PATH': '/usr/bin:/bin', 'SECRET_FROM_CALLER': 'must-not-propagate'}, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, '')

    def test_all_fake_runtime_paths_use_short_root_and_loopback(self):
        text = (HERE / 'qa-runtime.mjs').read_text()
        self.assertIn('const port=54524, appPort=3184;', text)
        self.assertIn("postgresFlags:['-k',root+'/t','-h','127.0.0.1']", text)
        self.assertIn("TMPDIR:root+'/t'", text)
        self.assertNotIn("root+'/tmp", text)
        self.assertNotIn("root+'/empty", text)
        guard = (HERE / 'network-guard.cjs').read_text()
        self.assertIn("const root='/mnt/apps/peticao-final/.qt1'", guard)
        self.assertIn("startsWith(root+'/t/')", guard)
        self.assertIn('QA_EXTERNAL_NETWORK_BLOCKED', guard)
        self.assertIn("app.kill('SIGTERM')", text)
        self.assertIn('await pg.stop()', text)


if __name__ == '__main__':
    unittest.main()
