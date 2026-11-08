import test from "node:test";
import assert from "node:assert/strict";
import { adminMirrorEnabled, mirrorRequestAllowed } from "./admin-mirror";

test("mirror flag is opt-in and cannot be enabled by a truthy string", () => {
  const previous = process.env.ADMIN_MIRROR_MODE;
  try {
    for (const value of [undefined, "", "0", "true", "1"]) {
      if (value === undefined) delete process.env.ADMIN_MIRROR_MODE;
      else process.env.ADMIN_MIRROR_MODE = value;
      assert.equal(adminMirrorEnabled(), value === "1");
    }
  } finally {
    if (previous === undefined) delete process.env.ADMIN_MIRROR_MODE;
    else process.env.ADMIN_MIRROR_MODE = previous;
  }
});

test("mirror denies every mutation, including writes to otherwise allowed paths", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "CONNECT"]) {
    for (const path of ["/admin", "/api/admin/dashboard", "/api/admin/emails/sincronizar", "/api/sign"]) {
      assert.equal(mirrorRequestAllowed(method, path), false, `${method} ${path}`);
    }
  }
});

test("mirror allows reviewed reads and bundled frontend assets", () => {
  for (const method of ["GET", "HEAD"]) {
    for (const path of ["/admin", "/admin/assinaturas", "/_next/static/chunks/app.js", "/favicon.ico", "/api/admin/dashboard", "/api/admin/assinaturas/explorar", "/api/admin/lotes/19/pdf", "/api/admin/monitor/visitante/abc-123"]) {
      assert.equal(mirrorRequestAllowed(method, path), true, `${method} ${path}`);
    }
  }
});

test("GET cannot invoke cron, provider polling, terminal, AI generation or new APIs", () => {
  for (const path of ["/", "/api/cron", "/api/admin/terminal", "/api/admin/emails/sincronizar", "/api/admin/ia/gerar", "/api/admin/unknown", "/api/admin/lotes/19/aprovar", "/api/admin/dashboard/extra", "/api/admin/lotes/0/pdf"]) {
    assert.equal(mirrorRequestAllowed("GET", path), false, path);
  }
});
