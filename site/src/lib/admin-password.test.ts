import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

test("senha do painel pelo arquivo de hash (trocada sem reiniciar) e volta para ADMIN_PASSWORD sem arquivo", async () => {
  const dir = mkdtempSync(join(tmpdir(), "admpw-"));
  const f = join(dir, "admin-password.hash");
  process.env.ADMIN_PASSWORD_FILE = f;
  const { passwordOk } = await import("./admin");
  assert.equal(passwordOk("admin-dev"), true); // sem arquivo: ADMIN_PASSWORD (padrão de dev)
  const mk = (pw: string) => execFileSync("node", ["-e", `const c=require("node:crypto");const s=c.randomBytes(16);const h=c.scryptSync(process.argv[1],s,32,{N:32768,r:8,p:1,maxmem:256*1024*1024});process.stdout.write("scrypt$32768$8$1$"+s.toString("hex")+"$"+h.toString("hex"))`, pw]).toString();
  writeFileSync(f, mk("Nova-senha-1") + "\n");
  assert.equal(passwordOk("Nova-senha-1"), true);
  assert.equal(passwordOk("admin-dev"), false);
  await new Promise((r) => setTimeout(r, 20));
  writeFileSync(f, mk("Outra-senha-2"));
  assert.equal(passwordOk("Outra-senha-2"), true);
  assert.equal(passwordOk("Nova-senha-1"), false);
  rmSync(dir, { recursive: true });
  assert.equal(passwordOk("admin-dev"), true);
  delete process.env.ADMIN_PASSWORD_FILE;
});
