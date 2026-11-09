import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { geoDbStatus, lookupIp } from "./geo";

test("geolocalização: falha ao abrir as bases não fica guardada para sempre", async () => {
  const antes = { dir: process.env.GEO_DIR, retry: process.env.GEO_RETRY_MS };
  try {
    process.env.GEO_RETRY_MS = "0";
    process.env.GEO_DIR = mkdtempSync(join(tmpdir(), "geo-vazio-"));
    assert.deepEqual(await geoDbStatus(), { city: false, asn: false });
    assert.equal((await lookupIp("8.8.4.4")).city, null);
    process.env.GEO_DIR = antes.dir ?? join(process.cwd(), "geo-data"); // base real: a próxima consulta reabre sozinha
    const st = await geoDbStatus();
    assert.equal(st.city, true);
    assert.equal((await lookupIp("8.8.4.4")).city, "Mountain View");
  } finally {
    if (antes.dir === undefined) delete process.env.GEO_DIR; else process.env.GEO_DIR = antes.dir;
    if (antes.retry === undefined) delete process.env.GEO_RETRY_MS; else process.env.GEO_RETRY_MS = antes.retry;
  }
});
