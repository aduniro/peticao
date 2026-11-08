import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("credencial SMTP do systemd: lê JSON válido; ignora ausente, vazio e malformado", async () => {
  const { readSmtpCredential, sesSmtpOptions } = await import("./mail/smtp-credential");
  const dir = mkdtempSync(join(tmpdir(), "cred-"));
  try {
    assert.equal(readSmtpCredential(undefined), null);
    assert.equal(readSmtpCredential(dir), null); // sem arquivo
    writeFileSync(join(dir, "ses-smtp"), "isto não é json");
    assert.equal(readSmtpCredential(dir), null);
    writeFileSync(join(dir, "ses-smtp"), JSON.stringify({ user: "AKIAX", pass: "" }));
    assert.equal(readSmtpCredential(dir), null);
    writeFileSync(join(dir, "ses-smtp"), JSON.stringify({ user: "AKIAX", pass: "p+/=ss" }));
    const c = readSmtpCredential(dir)!;
    assert.deepEqual(c, { user: "AKIAX", pass: "p+/=ss" });
    const o = sesSmtpOptions(c, "sa-east-1");
    assert.equal(o.host, "email-smtp.sa-east-1.amazonaws.com");
    assert.equal(o.port, 465); assert.equal(o.secure, true);
    assert.deepEqual(o.auth, { user: "AKIAX", pass: "p+/=ss" }); // sem codificação de URL: caracteres especiais passam intactos
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
