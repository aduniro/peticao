import test from "node:test";
import assert from "node:assert/strict";
import { mailQueueScope, mailQueueTable, queuedMessageKey } from "./queue-scope";

test("IDs iguais em filas diferentes não compartilham identidade e o legado conserva suas chaves", () => {
  const previous = { scope: process.env.MAIL_QUEUE_SCOPE, runtime: process.env.PETICAO_RUNTIME };
  try {
    delete process.env.MAIL_QUEUE_SCOPE;
    delete process.env.PETICAO_RUNTIME;
    assert.equal(mailQueueTable(), "mail_outbox");
    assert.equal(queuedMessageKey(1), "outbox:1");
    process.env.MAIL_QUEUE_SCOPE = "v2";
    process.env.PETICAO_RUNTIME = "admin-v2";
    assert.equal(mailQueueTable(), "mail_outbox_v2");
    assert.equal(queuedMessageKey(1), "outbox:v2:1");
    process.env.MAIL_QUEUE_SCOPE = "legacy";
    assert.throws(() => mailQueueScope(), /requires_isolated/);
    process.env.MAIL_QUEUE_SCOPE = "v2; DROP TABLE mail_outbox";
    assert.throws(() => mailQueueTable(), /invalid_mail_queue_scope/);
  } finally {
    if (previous.scope === undefined) delete process.env.MAIL_QUEUE_SCOPE; else process.env.MAIL_QUEUE_SCOPE = previous.scope;
    if (previous.runtime === undefined) delete process.env.PETICAO_RUNTIME; else process.env.PETICAO_RUNTIME = previous.runtime;
  }
});
