#!/usr/bin/env node
// Contagens somente leitura: nenhum CPF, hash, nome ou segredo aparece na saída.
import { execFileSync } from "node:child_process";
import { createDecipheriv, createHash, createHmac } from "node:crypto";

try {
  const key = createHash("sha256").update(process.env.CPF_CACHE_ENCRYPTION_KEY.trim()).digest();
  const hash = cpf => createHmac("sha256", process.env.HASH_PEPPER).update(cpf).digest("hex");
  const sql = `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
    SELECT json_build_object('at',now(),'signatures',
      (SELECT json_agg(json_build_object('status',status,'category',category,'hash',cpf_hash,'check',cpf_name_check)) FROM signatures),
      'cache',(SELECT coalesce(json_agg(to_jsonb(c)),'[]') FROM cpf_lookup_cache c WHERE expires_at>now() AND fetched_at>now()-interval '30 days'));
    COMMIT;`;
  const data = JSON.parse(execFileSync("runuser",["-u","postgres","--","psql","-X","-qAt","-d","peticao","-v","ON_ERROR_STOP=1"],
    {input:sql,encoding:"utf8",maxBuffer:40*1024*1024,stdio:["pipe","pipe","pipe"]}));
  const historic = JSON.parse(execFileSync("python3",["-c",`
import sqlite3,json
from pathlib import Path
base=Path('/root/peticao-recovery')
c=sqlite3.connect((base/'validacao-cpf-brasil-cache.sqlite').as_uri()+'?mode=ro',uri=True);c.row_factory=sqlite3.Row
lookups=[dict(r) for r in c.execute('SELECT cpf,status,name,birth,mother,sex FROM lookups')];c.close()
recovered=[]
for path in (base/'consolidacoes/consolidacao-20261106T104518Z/backup/fontes').glob('*.sqlite'):
 c=sqlite3.connect(path.as_uri()+'?mode=ro',uri=True)
 if c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='signatures'").fetchone():
  recovered.extend(c.execute('SELECT cpf,cpf_hash FROM signatures WHERE cpf IS NOT NULL').fetchall())
 c.close()
print(json.dumps({'lookups':lookups,'recovered':recovered}))
`],{encoding:"utf8",maxBuffer:30*1024*1024,stdio:["ignore","pipe","pipe"]}));
  const recovered = new Set(), lookups = new Map(), active = new Map(), notFound = new Set();
  for (const [cpf,digest] of historic.recovered) {
    if (hash(cpf)!==digest) throw new Error("Mapping mismatch");
    recovered.add(digest);
  }
  for (const row of historic.lookups) {
    if(row.status==="ok")lookups.set(hash(row.cpf),{nome:row.name,nasc:row.birth,mae:row.mother,sexo:row.sex});
    else if(row.status==="nao_encontrado")notFound.add(hash(row.cpf));
  }
  for (const row of data.cache) {
    const [version,iv,tag,body]=row.payload.split(".");if(version!=="v1")throw new Error("Version");
    const cipher=createDecipheriv("aes-256-gcm",key,Buffer.from(iv,"base64url"));
    cipher.setAAD(Buffer.from(`cpf-cache:v1:${row.cpf_hash}`));cipher.setAuthTag(Buffer.from(tag,"base64url"));
    const record=JSON.parse(Buffer.concat([cipher.update(Buffer.from(body,"base64url")),cipher.final()]).toString("utf8"));
    active.set(row.cpf_hash,record);
  }
  const result={at:data.at,total_signatures:data.signatures.length,without_cpf:0,with_cpf:0,
    active_cache_records:active.size,historic_success_records:lookups.size,historic_recovered_cpfs:recovered.size,
    current_with_active_cache:0,current_with_historic_success:0,current_with_recovered_number:0,
    neither_active_cache_nor_historic_success:0,neither_cache_nor_recovered_number:0,
    cpf_number_not_recovered:0,prior_not_found_still_without_data:0,
    missing_fields:{nome:0,nasc:0,mae:0,sexo:0},missing_fields_among_available:{nome:0,nasc:0,mae:0,sexo:0},by_status:{}};
  for(const signature of data.signatures){
    if(!signature.hash){result.without_cpf++;continue;}
    result.with_cpf++;
    const cache=active.has(signature.hash),previous=lookups.has(signature.hash),number=recovered.has(signature.hash);
    const record=active.get(signature.hash)??lookups.get(signature.hash);
    const status=result.by_status[signature.status]??={with_cpf:0,with_data:0,no_data:0,no_data_already_match:0,neither_cache_nor_recovered_number:0};
    status.with_cpf++;
    result.current_with_active_cache+=Number(cache);result.current_with_historic_success+=Number(previous);
    result.current_with_recovered_number+=Number(number);result.cpf_number_not_recovered+=Number(!number);
    if(record)status.with_data++;
    else{
      result.neither_active_cache_nor_historic_success++;status.no_data++;
      if(signature.check==="match")status.no_data_already_match++;
      if(notFound.has(signature.hash))result.prior_not_found_still_without_data++;
    }
    if(!cache&&!number){result.neither_cache_nor_recovered_number++;status.neither_cache_nor_recovered_number++;}
    for(const field of ['nome','nasc','mae','sexo']){
      const present=typeof record?.[field]==="string"&&record[field].trim().length>0;
      if(!present){result.missing_fields[field]++;if(record)result.missing_fields_among_available[field]++;}
    }
  }
  console.log(JSON.stringify(result,null,2));
}catch{
  console.error("Read-only coverage inspection failed; private details omitted.");process.exitCode=1;
}
