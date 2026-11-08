import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";
import { exigirNivel } from "./admin-api";
import { refreshProviderStatus, refreshReplies, syncMail } from "./mail/status";

test("mirror middleware and API guard deny mutations before session or database access", async () => {
  const old = process.env.ADMIN_MIRROR_MODE;
  process.env.ADMIN_MIRROR_MODE = "1";
  try {
    const req = new NextRequest("http://localhost:3031/api/admin/emails/sincronizar", { method: "POST" });
    assert.equal(middleware(req).status, 403);
    assert.equal((await exigirNivel(req, "total"))?.status, 403);
    const read = middleware(new NextRequest("http://localhost:3031/api/admin/dashboard"));
    assert.equal(read.headers.get("x-middleware-next"), "1");
  } finally {
    if (old === undefined) delete process.env.ADMIN_MIRROR_MODE;
    else process.env.ADMIN_MIRROR_MODE = old;
  }
});

test("production mode keeps existing routing while mirror mode prevents provider calls", async () => {
  const old = process.env.ADMIN_MIRROR_MODE;
  try {
    delete process.env.ADMIN_MIRROR_MODE;
    const req = new NextRequest("http://localhost:3000/api/sign", { method: "POST" });
    assert.equal(middleware(req).headers.get("x-middleware-next"), "1");
    process.env.ADMIN_MIRROR_MODE = "1";
    const noNetwork: typeof fetch = async () => { throw new Error("Unexpected external request"); };
    await refreshProviderStatus(noNetwork, { brevo: "fictitious", sendpulse: null, mailersend: null, mailrelayP: null });
    await refreshReplies(noNetwork, "fictitious");
    assert.deepEqual(await syncMail(true), { ran: false });
  } finally {
    if (old === undefined) delete process.env.ADMIN_MIRROR_MODE;
    else process.env.ADMIN_MIRROR_MODE = old;
  }
});
