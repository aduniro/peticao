#!/usr/bin/env node
// Verificação somente leitura: nunca imprime CPF, dados cadastrais ou chaves.
import { createDecipheriv, createHash, createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";

try {
  const raw = process.env.CPF_CACHE_ENCRYPTION_KEY?.trim();
  if (!raw || !process.env.HASH_PEPPER) throw new Error("Missing internal key");
  const key = createHash("sha256").update(raw).digest();
  const output = execFileSync("runuser",["-u","postgres","--","psql","-X","-qAt","-d","peticao","-v","ON_ERROR_STOP=1"],{
    input:"BEGIN READ ONLY; SELECT coalesce(json_agg(to_jsonb(c)),'[]') FROM cpf_lookup_cache c; COMMIT;",
    encoding:"utf8",maxBuffer:30*1024*1024,stdio:["pipe","pipe","pipe"]});
  const entries=JSON.parse(output);
  const source=JSON.parse(execFileSync("python3",["-c",`
import sqlite3,json
from pathlib import Path
p=Path('/root/peticao-recovery/validacao-cpf-brasil-cache.sqlite')
c=sqlite3.connect(p.as_uri()+'?mode=ro',uri=True);c.row_factory=sqlite3.Row
print(json.dumps([dict(r) for r in c.execute("SELECT cpf,name,mother,birth,sex,queried_at FROM lookups WHERE status='ok'")]))
c.close()
`],{encoding:"utf8",maxBuffer:30*1024*1024,stdio:["ignore","pipe","pipe"]}));
  const original=new Map(source.map(r=>[createHmac("sha256",process.env.HASH_PEPPER).update(r.cpf).digest("hex"),r]));
  let checked=0,originals=0,newer=0;
  for(const entry of entries){
    const [version,iv,tag,data]=entry.payload.split(".");if(version!=="v1")throw new Error("Version");
    const d=createDecipheriv("aes-256-gcm",key,Buffer.from(iv,"base64url"));
    d.setAAD(Buffer.from(`cpf-cache:v1:${entry.cpf_hash}`));d.setAuthTag(Buffer.from(tag,"base64url"));
    const record=JSON.parse(Buffer.concat([d.update(Buffer.from(data,"base64url")),d.final()]).toString("utf8"));
    if(!record.nome||![record.mae,record.nasc,record.sexo].every(v=>v===null||typeof v==="string"))throw new Error("Fields");
    if(Date.parse(entry.expires_at)-Date.parse(entry.fetched_at)!==30*86400_000)throw new Error("Lifetime");
    const prior=original.get(entry.cpf_hash);
    if(prior&&Date.parse(prior.queried_at)===Date.parse(entry.fetched_at)){
      const expected={nome:prior.name,mae:prior.mother??null,nasc:prior.birth??null,sexo:prior.sex??null};
      if(JSON.stringify(record)!==JSON.stringify(expected))throw new Error("Source mismatch");
      originals++;
    }else newer++;
    checked++;
  }
  console.log(JSON.stringify({decrypted_and_validated:checked,original_lookups_preserved:originals,newer_records:newer,lookup_lifetime_days:30,api_calls:0}));
}catch{
  console.error("Cache integrity verification failed; private details omitted.");process.exitCode=1;
}
