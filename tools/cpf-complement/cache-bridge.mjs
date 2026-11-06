import pg from "/opt/peticao/app/node_modules/pg/lib/index.js";
import { createCipheriv,createDecipheriv,createHash,randomBytes } from "node:crypto";
import readline from "node:readline";
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});
const key=createHash("sha256").update(process.env.CPF_CACHE_ENCRYPTION_KEY.trim()).digest();
let client=null;
const release=async()=>{if(client){await client.query("ROLLBACK");client.release();client=null;}};
function decode(r){
 if(!r||+new Date(r.expires_at)<=Date.now()||+new Date(r.fetched_at)+30*86400_000<=Date.now())return null;
 const [v,iv,tag,data]=r.payload.split(".");if(v!=="v1")return null;
 const d=createDecipheriv("aes-256-gcm",key,Buffer.from(iv,"base64url"));
 d.setAAD(Buffer.from(`cpf-cache:v1:${r.cpf_hash}`));d.setAuthTag(Buffer.from(tag,"base64url"));
 const x=JSON.parse(Buffer.concat([d.update(Buffer.from(data,"base64url")),d.final()]).toString());
 return {hash:r.cpf_hash,name:x.nome,mother:x.mae,birth:x.nasc,sex:x.sexo,queried_at:new Date(r.fetched_at).toISOString(),status:"ok"};
}
for await(const line of readline.createInterface({input:process.stdin})){
 try{
  const q=JSON.parse(line);let answer={ok:true};
  if(q.action==="dump"){
   const rows=(await pool.query("SELECT * FROM cpf_lookup_cache WHERE expires_at>now()")).rows;
   answer={records:rows.map(decode).filter(Boolean)};
  }else if(q.action==="begin"){
   await release();client=await pool.connect();await client.query("BEGIN");
   await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["cpf-cache:"+q.hash]);
   const row=(await client.query("SELECT * FROM cpf_lookup_cache WHERE cpf_hash=$1",[q.hash])).rows[0];
   const hit=decode(row);if(hit){await release();answer={record:hit};}else answer={record:null};
  }else if(q.action==="put"){
   if(!client)throw new Error("No transaction");
   const r=q.record,iv=randomBytes(12),c=createCipheriv("aes-256-gcm",key,iv);
   c.setAAD(Buffer.from(`cpf-cache:v1:${q.hash}`));
   const plain=JSON.stringify({nome:r.name,mae:r.mother??null,nasc:r.birth??null,sexo:r.sex??null});
   const data=Buffer.concat([c.update(plain),c.final()]);
   const payload=["v1",iv.toString("base64url"),c.getAuthTag().toString("base64url"),data.toString("base64url")].join(".");
   const at=new Date(r.queried_at),expires=new Date(+at+30*86400_000);
   await client.query("INSERT INTO cpf_lookup_cache VALUES($1,$2,$3,$4) ON CONFLICT(cpf_hash) DO UPDATE SET payload=EXCLUDED.payload,fetched_at=EXCLUDED.fetched_at,expires_at=EXCLUDED.expires_at WHERE cpf_lookup_cache.fetched_at<EXCLUDED.fetched_at",[q.hash,payload,at,expires]);
   await client.query("COMMIT");client.release();client=null;
  }else if(q.action==="release")await release();else throw new Error("Action");
  console.log(JSON.stringify(answer));
 }catch{await release().catch(()=>{});console.log(JSON.stringify({error:"CACHE_BRIDGE_FAILED"}));}
}
await release();await pool.end();
