import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
process.env.MAIL_OUTBOX_DIR = join(tmpdir(), `peticao-outbox-bf-${process.pid}`);
process.env.BATCH_SIZE = "3";
process.env.SIGNER = "none";

async function add(dbmod: typeof import("./db"), i: number, f: Record<string, unknown>) {
  const { hmac } = await import("./security");
  const cols = { name: `Pessoa Teste ${i}`, email: `q${i}@x.org`, email_hash: hmac(`e${i}`), cpf_hash: f.category === "estrangeiro" ? null : hmac(`c${i}`), text_version: "v", consent_at: "2026-10-29T00:00:00Z", status: "confirmed", confirmed_at: new Date(2026, 9, 29, 12, 0, i).toISOString(), ...f };
  const k = Object.keys(cols);
  await dbmod.query(`INSERT INTO signatures(${k.join(",")}) VALUES(${k.map((_, j) => `$${j + 1}`).join(",")})`, Object.values(cols));
}

test("lotes acumulados com estrangeiros: PDF com duas partes, contagens e lista pública com bandeira e primeiro nome", async () => {
  const dbmod = await import("./db");
  await dbmod._openForTests("t_lotes_foreign");
  const b = await import("./batches");
  const { counts } = await import("./signatures");
  const { recentSignatures } = await import("./public-feed");
  await add(dbmod, 1, { category: "servidor", institution: "UNIR", ifes_acronym: "UNIR", role: "docente", campus: "Porto Velho" });
  await add(dbmod, 2, { category: "apoiador", city: "Manaus", uf: "AM" });
  await add(dbmod, 3, { category: "estrangeiro", country: "PT", university: "Universidade de Lisboa" });
  const t = await b.tick();
  assert.equal(t.created.length, 1);
  const one = (await b.getBatch(t.created[0]))!;
  assert.deepEqual([one.n_servidor, one.n_apoiador, one.n_estrangeiro], [1, 1, 1]);
  const pdf = (await dbmod.query<{ pdf: Buffer }>("SELECT pdf FROM batches WHERE id=$1", [one.id])).rows[0].pdf;
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");

  // segundo parcial é acumulado: inclui as 3 anteriores e as 3 novas
  await add(dbmod, 4, { category: "servidor", institution: "UFAC", ifes_acronym: "UFAC", role: "tae" });
  await add(dbmod, 5, { category: "estrangeiro", country: "DE", university: "Universität Hamburg" });
  await add(dbmod, 6, { category: "estrangeiro", country: "DE", university: "Universität Hamburg" });
  const t2 = await b.tick();
  const two = (await b.getBatch(t2.created[0]))!;
  assert.deepEqual([two.n_servidor, two.n_apoiador, two.n_estrangeiro], [2, 1, 3]);

  const c = await counts();
  assert.deepEqual(c, { servidor: 2, apoiador: 1, estrangeiro: 3, total: 6 });

  const feed = await recentSignatures(10);
  const lisb = feed.find((i) => i.who === "Pessoa")!;
  assert.ok(lisb);
  const ger = feed.filter((i) => i.kind === "estrangeiro").map((i) => i.flag).sort();
  assert.deepEqual(ger, ["de", "de", "pt"]);
  assert.equal(feed.find((i) => i.kind === "servidor" && i.ifes === "UFAC")?.flag, "br");
  assert.equal(JSON.stringify(feed).includes("Teste"), false); // sobrenome não vaza
  await dbmod._closeDbForTests();
});
