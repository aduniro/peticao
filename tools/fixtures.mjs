import { query } from "/app/src/lib/db.ts";
import { createHmac } from "node:crypto";
if (process.env.PREVIEW_MODE !== "1" || !process.env.HASH_PEPPER?.startsWith("QA-LAB-") || !process.env.DATABASE_URL?.includes("QA-LAB-DB-FICTITIOUS")) throw new Error("Not a fictitious lab database");
const keep = new Set(["institutional_domains", "world_universities", "settings"]);
const tables = (await query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.map(r => r.tablename).filter(n => !keep.has(n));
if (tables.length) await query("TRUNCATE " + tables.map(n => '"' + n.replaceAll('"','""') + '"').join(",") + " RESTART IDENTITY CASCADE");
const h = value => createHmac("sha256", process.env.HASH_PEPPER).update(value).digest("hex");
const fixed = "2026-11-08T12:00:00.000Z";
for (const [i, category, institution, city, uf] of [
  [1, "servidor", "UNIR", "Porto Velho", "RO"], [2, "servidor", "UFAM", "Manaus", "AM"],
  [3, "apoiador", null, "São Paulo", "SP"], [4, "apoiador", null, "Belém", "PA"],
]) {
  const email = "fixture-" + i + "@example.invalid";
  await query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,institution,role,city,uf,text_version,consent_at,status,confirmed_at,created_at,cpf_name_check) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'LAB-FICTITIOUS',$10,'confirmed',$10,$10,'match')",
    ["Pessoa Fictícia " + i, email, h(email), h("lab-fixture-"+i), category, institution, category === "servidor" ? "tae" : null, city, uf, fixed]);
}
console.log("LAB_FIXTURES_OK: four fictitious confirmed signatures");
process.exit(0);
