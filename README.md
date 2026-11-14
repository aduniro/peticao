# Azure DEV toolchain — reviewed source only

Target: peticao-azure-dev-01, builder, EastUS. No app deployment, jobs, queue, GUI, mesh/root access expansion, credentials copy or temporaryNVMe formatting.

Install source bundle under /opt/peticao-toolchain/source; strict hostname/Debian13amd64/Python3.13 guards. Docker official apt exact versions, Node20.19.2 default app runtime, separate Node22 wrappers, Playwright1.62.1 aligned with Civo, bundled Chromium. Hashchecked Node archives and Docker signing key. Playwright install-deps can update required individual libraries; no distribution upgrade. Adding builder to docker group gives root-equivalent access on this isolated worker. No Docker ports published; daemon standard forwarding/NAT chains will be created. No other machine firewall is modified.

Caller uses own normal reviewed deploy lease, source commit/hash closure and fresh Azure VM ownership/IP verification, existing approved SSH key consumed by SSH only and existing pinned public server host key. It ignores ambient SSH config. Durable exclusive pending journal forbids blind replay after timeout/uncertainty. SSH files contain only reviewed public source/pins. Never copy OAuth/A1/application secrets.

Phases: install, smoke. Smoke as builder after fresh login: digestpinned Alpine with networknone/read-only/capdropALL, then Chromium with sandbox rendering a fictitious static page and screenshot; browser external routing blocked. No real workload/jobs qualified by these tests.

Offline checks: /usr/bin/python3 -B -m unittest -q test_bootstrap test_operator from /mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/azure-dev-toolchain/source .

API credentials, leases and runtime logs remain outside Git source. This local Git has no remote or hooks. KeepRunningduring actual Infra qualification; Infra explicitly owns idle coordination and approved10minidle deallocation afterward.

Sources: https://docs.docker.com/engine/install/debian/ ; https://nodejs.org/dist/index.json ; https://playwright.dev/docs/browsers .
