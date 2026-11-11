'use strict';
// This file connects only when explicitly launched inside the approved local QA run.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
function password(p){const salt=crypto.randomBytes(16);return `scrypt$16384$8$1$${salt.toString('hex')}$${crypto.scryptSync(p,salt,32,{N:16384,r:8,p:1,maxmem:256*1024*1024}).toString('hex')}`;}
async function main(){
 if(process.env.MATERIALS_HTTP_FIXTURE!=='materials-next-real-140ce-local-v1')throw Error('explicit fixture admission');
 const run=process.env.RUNTIME_SMOKE_RUN,runtime=process.env.QA_RUNTIME;
 if(!runtime||!run||process.env.DATABASE_URL!=='postgres://fixture_only:fixture_only@127.0.0.1:55498/fixture_only')throw Error('fixed fixture/runtime required');
 const {Client}=require(path.join(runtime,'node_modules/pg')),c=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000});
 try{await c.connect();const id=(await c.query("SELECT current_setting('server_version_num') version,current_database() database,current_setting('cluster_name') nonce,current_setting('data_directory') data_directory,inet_server_port() port")).rows[0];
 if(id.version!=='170011'||id.database!=='fixture_only'||id.nonce!==process.env.FUNCTIONAL_NONCE||id.data_directory!=='/var/lib/postgresql/data'||id.port!==5432)throw Error('owned PG17 identity');
 const action=process.argv[2];
 if(action==='seed'){
  const existing=(await c.query("SELECT count(*)::int n FROM pg_namespace WHERE nspname NOT IN('public','pg_catalog','information_schema')AND nspname NOT LIKE 'pg_toast%'AND nspname NOT LIKE 'pg_temp_%'")).rows[0].n;
  if(existing!==0)throw Error('fresh fixture namespaces only');
  const relations=(await c.query("SELECT count(*)::int n FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN('r','p','v','m','S')")).rows[0].n;if(relations!==0)throw Error('empty fixture before DDL');
  const pins=JSON.parse(fs.readFileSync(path.join(__dirname,'schema-source-manifest.json'),'utf8'));
  if(pins.sourceCommit!=='140ce6b98af23045849335693a82b426fdc9c826')throw Error('source identity');
  for(const [n,pin]of Object.entries(pins.files)){
   const raw=fs.readFileSync(path.join(__dirname,'schema-sources',n),'utf8');if(crypto.createHash('sha256').update(raw).digest('hex')!==pin)throw Error('schema pin');
   const m=raw.match(n==='db.ts'?/const SCHEMA_SQL = (`[\s\S]*?`);/:/export const \w+ = ((?:String.raw)?`[\s\S]*?`);/);
   if(!m||m[1].includes('${'))throw Error('closed literal DDL');
   const sql=vm.runInNewContext('('+m[1]+')',Object.create(null),{timeout:1000});if(typeof sql!=='string')throw Error('DDL literal only');await c.query(sql);
  }
  await c.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash,trocar_senha)VALUES(1,'editor@fixture.invalid','QA Editor','edicao',$1,false),(2,'reader@fixture.invalid','QA Reader','leitura',$2,false)",[password('Fixture-Editor-Only-92837465'),password('Fixture-Reader-Only-92837465')]);
  for(const table of ['campaign_materials','campaign_material_versions','campaign_material_requests'])if((await c.query('SELECT count(*)::int n FROM '+table)).rows[0].n!==0)throw Error('no material seeded');
  console.log(JSON.stringify({seededUsers:2,seededMaterials:0,seededVersions:0,seededReceipts:0,externalIdentityVerified:false,fixtureOnly:true}));
 }else if(action==='inspect'){
  const expected=JSON.parse(fs.readFileSync(path.join(run,'protocol-result.json'),'utf8'));
  const versions=(await c.query('SELECT id,material_id,ordinal,sha256,archived,author_id FROM campaign_material_versions ORDER BY ordinal')).rows;
  if(versions.length!==3||versions.some((v,i)=>v.id!==expected.versions[i].id||v.material_id!==expected.versions[i].materialId||v.ordinal!==i+1||v.sha256!==expected.versions[i].sha256||v.archived!==(i===2)||v.author_id!==1))throw Error('exact versions and authors');
  const heads=(await c.query('SELECT id,revision,current_version,archived,created_by,updated_by FROM campaign_materials')).rows;
  if(heads.length!==1||heads[0].id!==expected.versions[0].materialId||heads[0].revision!==3||heads[0].current_version!==expected.versions[2].id||!heads[0].archived||heads[0].created_by!==1||heads[0].updated_by!==1)throw Error('head CAS effects');
  const receipts=(await c.query('SELECT actor_id,request_id,version_id FROM campaign_material_requests ORDER BY created_at')).rows;
  if(receipts.length!==3||receipts.some((r,i)=>r.actor_id!==1||r.request_id!==expected.requestIds[i]||r.version_id!==expected.versions[i].id))throw Error('three durable scoped receipts');
  const audits=(await c.query("SELECT event FROM audit_log WHERE event LIKE 'campaign_material_%' ORDER BY id")).rows.map(v=>v.event);if(JSON.stringify(audits)!==JSON.stringify(['campaign_material_create','campaign_material_revise','campaign_material_archive']))throw Error('one audit per admitted mutation');
  const zero={};for(const n of ['signatures','batches','batch_document_versions','batch_a1_jobs','batch_a1_validations','president_own_document_artifacts','mail_messages','mail_message_attempts','mail_outbox','batch_sends']){zero[n]=(await c.query('SELECT count(*)::int n FROM '+n)).rows[0].n;if(zero[n]!==0)throw Error('unexpected non-Materials effect');}
  const namespaces=(await c.query("SELECT nspname FROM pg_namespace WHERE nspname NOT IN('public','pg_catalog','information_schema')AND nspname NOT LIKE 'pg_toast%'AND nspname NOT LIKE 'pg_temp_%'")).rows;if(namespaces.length)throw Error('unexpected namespace');
  console.log(JSON.stringify({heads:1,versions:3,receipts:3,materialAuditEvents:3,zeroEffects:zero,unexpectedNamespaces:0}));
 }else throw Error('unknown fixture action');
 }finally{await c.end();}
}
if(require.main===module)main().catch(()=>{console.error('MATERIALS_HTTP_FIXTURE_FAILED');process.exitCode=1;});
module.exports={password};
