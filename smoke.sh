#!/bin/bash
# Manual, isolated DEV smoke; no application or production data.
set -Eeuo pipefail
umask 077
[[ $# == 1 && "$1" == --run ]] || { echo 'Usage: /opt/peticao-toolchain/source/smoke.sh --run' >&2; exit 64; }
[[ $EUID != 0 && "$(/usr/bin/id -un)" == builder ]] || { echo 'Run as builder after a new login' >&2; exit 77; }
[[ "$(/bin/hostname -s)" == peticao-azure-dev-01 ]] || { echo 'Wrong hostname' >&2; exit 78; }
source /etc/os-release
[[ "$ID" == debian && "$VERSION_ID" == 13 && "$(/usr/bin/dpkg --print-architecture)" == amd64 ]] || exit 78
readonly BASE=/opt/peticao-toolchain
readonly RUNTIME=/mnt/apps/peticao-final/.runtime/azure-dev-toolchain
export TMPDIR="$RUNTIME/builder-work"
[[ -d "$TMPDIR" && ! -L "$TMPDIR" && -O "$TMPDIR" ]] || exit 78
/bin/bash "$BASE/source/bootstrap.sh" --validate-pins "$BASE/pins.json" >/dev/null
SMOKE_IMAGE=$(/usr/bin/python3 -c 'import json; print(json.load(open("/opt/peticao-toolchain/pins.json"))["smoke_image"])')
/usr/bin/docker pull "$SMOKE_IMAGE"
/usr/bin/docker run --rm --pull=never --network=none --read-only --cap-drop=ALL --security-opt=no-new-privileges --user=65534:65534 --pids-limit=64 --memory=128m "$SMOKE_IMAGE" /bin/sh -c 'printf "isolated Docker smoke OK\n"'
OUTPUT=$(/usr/bin/mktemp -d "$TMPDIR/smoke.XXXXXXXX")
export PLAYWRIGHT_BROWSERS_PATH="$RUNTIME/ms-playwright" SMOKE_OUTPUT="$OUTPUT"
/usr/local/bin/node22 <<'JS'
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('/opt/peticao-toolchain/playwright/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>DEV fictício</title><h1>Teste fictício DEV</h1><p>Nenhum dado real.</p></html>');
    if (await page.title() !== 'DEV fictício') throw new Error('Unexpected title');
    const output = path.join(process.env.SMOKE_OUTPUT, 'chromium-fictitious.png');
    await page.screenshot({ path: output });
    if (fs.statSync(output).size < 100) throw new Error('Empty screenshot');
    console.log(output);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
JS
