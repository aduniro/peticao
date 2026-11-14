/** Canonical QA supervision inside one isolated unit; no installation or deployment. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, createWriteStream, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = '/mnt/apps/peticao-final/.qt1';
export const APP_PORT = 3184;
export const PG_PORT = 54524;
export const CHROMIUM = '/mnt/apps/peticao-final/.tools/host-civo/playwright/chromium-1234/chrome-linux64/chrome';
const PYTHON = ROOT + '/p/bin/python';
const BASE = 'http://127.0.0.1:' + APP_PORT;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function assertBackendTap(text) {
  const counts = {};
  for (const field of ['tests', 'pass', 'fail']) {
    const matches = [...text.matchAll(new RegExp('^# ' + field + ' (\\d+)\\s*$', 'gm'))];
    assert.equal(matches.length, 1, 'Expected one backend TAP summary: ' + field);
    counts[field] = Number(matches[0][1]);
  }
  assert.deepEqual(counts, { tests: 43, pass: 43, fail: 0 });
  return 43;
}

export function assertCheckReport(value, expected, statusField = 'ok') {
  assert.equal(value[statusField], statusField === 'status' ? 'PASS' : true);
  assert.equal(value.checks.length, expected);
  if (Array.isArray(value.pageErrors)) assert.equal(value.pageErrors.length, 0);
  if (Array.isArray(value.blockedWrites)) assert.equal(value.blockedWrites.length, 0);
  return expected;
}

export function cleanEnv() {
  return {
    PATH: '/usr/local/bin:/usr/bin:/bin', HOME: ROOT + '/e',
    TMPDIR: ROOT + '/t', TMP: ROOT + '/t', TEMP: ROOT + '/t',
    XDG_CACHE_HOME: ROOT + '/c', XDG_CONFIG_HOME: ROOT + '/g', XDG_RUNTIME_DIR: ROOT + '/r',
    PYTHONDONTWRITEBYTECODE: '1', NEXT_TELEMETRY_DISABLED: '1',
    PLAYWRIGHT_NODEJS_PATH: '/usr/local/bin/node',
    NODE_OPTIONS: '--require=' + ROOT + '/network-guard.cjs --max-old-space-size=1536',
  };
}

function jsonFile(path) { return JSON.parse(readFileSync(path, 'utf8')); }

function launch(command, args, name, detached = false) {
  const log = createWriteStream(ROOT + '/logs/' + name + '.log', { mode: 0o600, flags: 'wx' });
  const child = spawn(command, args, { cwd: ROOT, env: cleanEnv(), detached, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  let ended = false;
  let logError = false;
  log.once('error', () => { logError = true; child.kill('SIGTERM'); });
  const done = new Promise(resolve => {
    const complete = result => {
      if (ended) return; ended = true;
      log.end(() => resolve({ ...result, logError }));
    };
    child.once('error', () => complete({ code: null, signal: null, spawnError: true }));
    child.once('close', (code, signal) => complete({ code, signal, spawnError: false }));
  });
  return { child, done, get ended() { return ended; } };
}

async function waitDone(handle, timeout) {
  const deadline = Date.now() + timeout;
  while (!handle.ended && Date.now() < deadline) await pause(100);
  return handle.ended;
}

async function stopOwned(handle) {
  if (!handle) return { stopped: true, forced: false };
  let forced = false;
  if (!handle.ended) {
    handle.child.kill('SIGTERM');
    if (!await waitDone(handle, 20000)) {
      forced = true;
      // Only this explicitly detached supervisor's own process group is targeted.
      try { process.kill(-handle.child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      assert.ok(await waitDone(handle, 5000), 'Owned process group did not exit');
    }
  }
  const result = await handle.done;
  return { stopped: true, forced, exitCode: result.code, signal: result.signal, logError: result.logError };
}

async function stage(runtime, command, args, name, timeout) {
  assert.ok(!runtime.ended, 'Runtime exited before ' + name);
  const current = launch(command, args, name, true);
  let result;
  try {
    result = await Promise.race([
      current.done,
      runtime.done.then(() => { throw Error('Runtime exited during ' + name); }),
      (async () => { const deadline = Date.now() + timeout; while (!current.ended && Date.now() < deadline) await pause(100); if (!current.ended) throw Error('Stage timed out: ' + name); return current.done; })(),
    ]);
    assert.equal(result.spawnError, false, 'Stage executable unavailable: ' + name);
    assert.equal(result.logError, false, 'Private stage log unavailable: ' + name);
    assert.equal(result.code, 0, 'Stage failed: ' + name);
  } finally {
    if (!current.ended) await stopOwned(current);
  }
  assert.ok(!runtime.ended, 'Runtime exited after ' + name);
}

async function waitReady(runtime) {
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    assert.ok(!runtime.ended, 'Runtime exited before readiness');
    try {
      const fixturePath = ROOT + '/fixture.private.json';
      assert.equal(statSync(fixturePath).mode & 0o777, 0o600);
      const fixture = jsonFile(fixturePath);
      assert.equal(fixture.fictionalOnly, true);
      const response = await fetch(BASE + '/api/internal/ready', { headers: { cookie: 'adm=' + fixture.token }, redirect: 'error', signal: AbortSignal.timeout(1500) });
      if (response.status === 200) return;
    } catch { /* Private fixture and compiled server may still be starting. */ }
    await pause(300);
  }
  throw Error('Readiness deadline exceeded');
}

export async function main() {
  assert.equal(dirname(fileURLToPath(import.meta.url)), ROOT);
  assert.match(process.version, /^v20\./, 'Node20 must be bound inside the unit');
  process.umask(0o077);
  const summary = { status: 'FAIL', backend: 0, backendSmoke: 0, browser: 0, maps: 0, httpReset: 0, refreshed: false, fictionalOnly: true, operationalReady: false, cleanup: null };
  let runtime;
  let interrupted = false;
  const onSignal = () => { interrupted = true; runtime?.child.kill('SIGTERM'); };
  process.on('SIGTERM', onSignal); process.on('SIGINT', onSignal);
  try {
    runtime = launch(process.execPath, [ROOT + '/qa-runtime.mjs'], 'supervisor', true);
    await waitReady(runtime);
    assert.ok(!interrupted, 'Interrupted');
    summary.backend = assertBackendTap(readFileSync(ROOT + '/backend-tests.log', 'utf8'));
    await stage(runtime, process.execPath, [ROOT + '/backend-smoke.mjs'], 'backend-smoke', 60000);
    summary.backendSmoke = assertCheckReport(jsonFile(ROOT + '/BACKEND-SMOKE.json'), 7);
    chmodSync(ROOT + '/fixture.private.json', 0o600);
    await stage(runtime, PYTHON, ['-B', ROOT + '/signature-explorer-r1-browser.py', '--base', BASE, '--mode', 'compiled-next', '--cookies-file', ROOT + '/fixture.private.json', '--chromium', CHROMIUM, '--output-dir', ROOT + '/results/browser40'], 'browser40', 420000);
    summary.browser = assertCheckReport(jsonFile(ROOT + '/results/browser40/RESULTADO.json'), 40, 'status');
    await stage(runtime, PYTHON, ['-B', ROOT + '/real-map-browser.py', '--cookies-file', ROOT + '/fixture.private.json', '--chromium', CHROMIUM, '--output-dir', ROOT + '/results/maps2'], 'maps2', 180000);
    const mapReport = jsonFile(ROOT + '/results/maps2/RESULTADO.json');
    assert.equal(mapReport.explorerMocked, false);
    summary.maps = assertCheckReport(mapReport, 2);
    // Reset revokes the initial fake cookie: execute only after both browser suites.
    await stage(runtime, process.execPath, [ROOT + '/http-regression.mjs'], 'http-reset', 90000);
    summary.httpReset = assertCheckReport(jsonFile(ROOT + '/HTTP-REGRESSION.json'), 8);
    await stage(runtime, process.execPath, [ROOT + '/refresh-fixture-session.mjs'], 'refresh-session', 30000);
    assert.equal(statSync(ROOT + '/fixture.private.json').mode & 0o777, 0o600);
    assert.equal(jsonFile(ROOT + '/fixture.private.json').fictionalOnly, true);
    summary.refreshed = true;
    assert.ok(!interrupted, 'Interrupted');
    summary.status = 'PASS';
  } catch {
    // Details remain in private per-stage logs; never copy cookies or fixture values to summary.
    summary.status = 'FAIL';
  } finally {
    try {
      summary.cleanup = await stopOwned(runtime);
      if (summary.cleanup.forced || summary.cleanup.logError || summary.cleanup.exitCode !== 0) summary.status = 'FAIL';
    } catch { summary.cleanup = { stopped: false, forced: true }; summary.status = 'FAIL'; }
    process.off('SIGTERM', onSignal); process.off('SIGINT', onSignal);
    writeFileSync(ROOT + '/logs/QA-SUMMARY.json', JSON.stringify(summary, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify(summary));
    if (summary.status !== 'PASS') process.exitCode = 1;
  }
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
