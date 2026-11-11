# Authenticated document-history browser QA — prepared, not executed

Driver: /mnt/dev/.peticao-r0005-auth-history-browser-qa-20261111/history-browser.cjs
Test source: /mnt/dev/.peticao-r0005-auth-history-browser-qa-20261111/history-browser.test.cjs

For a future reviewed R4 hook after its19HTTP checks, before final snapshot and cleanup. Requires its explicit private browser-config.json containing the existing owner session from real fixture HTTP login (not a real user); stepup remains seeded, no OTP homologation. Browser login UI is not tested. Reuses the same2sessions; makes only browser GET/HEAD requests.

Config path must be /mnt/dev/.peticao-r0004-local-history-http-qa-20261111/runs/<12hexnonce>/browser-config.json,0600 owned by current UID, no symlink; source f555, port31385, same exact bounded local user unit/cgroup. Fields: run,sourceCommit,origin,cgroup,cookie,syntheticSession:true,stepupSeeded:true,batchId:1,fixtures:[ordinal1,ordinal2] with PDFid,filename,sha256,bytes. Cookie remains Secure/HttpOnly/SameSiteStrict; no app policy altered. Never export this config.

Chromium binary is SHA-pinned, sandbox enabled, fresh context, service workers blocked, external dead proxy + context same-origin read-only allowlist. Observes browser-context application requests only, not global OS/packet isolation. Driver must run with clean env, no NODE_OPTIONS from app guard; PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK=1, HOME/TMPDIR own empty/tmp.

Checks selected batch page, closed dialog, explicit metadata fetch, newest-first versions, exact hashes/URLs/download bytes and attachment names, Escape/focus, no JS exceptions or application mutation. Screenshot and sanitized history-browser-result.json go to same fixture run. Root collection must additionally prove all process groups/cgroup drain and retained systemd ExecMainStatus/Result; driver result alone insufficient.

Four policy tests passed with local Node20.19.2. No browser/Docker/app/PG executed while preparing. These policy tests do not prove integration. No installation, upload, signature, approval, sending or deployment.
