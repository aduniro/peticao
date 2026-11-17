// SQL ownership rehearsal only: no signing, approval transport or provider calls.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const configFile=process.argv[2],fixture=JSON.parse(readFileSync(configFile,"utf8"));
const privateRoot="/mnt/apps/peticao-final/_ops/releases-admin-publico/integracao-20261112/";
assert.ok(realpathSync(configFile).startsWith(privateRoot));
assert.ok(realpathSync(fixture.socket).startsWith(privateRoot));
assert.match(fixture.database,/^fixture_batch_[0-9]+$/);
assert.equal(fixture.user,"fixture_app");assert.equal(fixture.runtimeUser,"fixture_runtime");assert.equal(fixture.migrationUser,"fixture");
const require=createRequire(resolve(fixture.dependencies,"../package.json")),{Pool}=require("pg");
const pools=new Map();
function pool(user){if(!pools.has(user))pools.set(user,new Pool({host:fixture.socket,database:fixture.database,user,password:user===fixture.user?fixture.password:user===fixture.runtimeUser?fixture.runtimePassword:fixture.migrationPassword,max:1}));return pools.get(user);}
const legacy=pool(fixture.user),modern=pool(fixture.runtimeUser),migration=pool(fixture.migrationUser);
const load=async name=>{const m=await import(resolve(fixture.current,"site/src/lib/"+name+".ts"));return m.default??m;};
const evidence={scope:"batch ownership database guards, no provider/signing workflows",productionTouched:false,checks:[],errors:[]};
function inputs(source){
 const files=execFileSync("git",["-C",source,"ls-files","--cached","--others","--exclude-standard","-z"],{encoding:"utf8"}).split("\0").filter(Boolean).sort();
 return{commit:execFileSync("git",["-C",source,"rev-parse","HEAD"],{encoding:"utf8"}).trim(),files:Object.fromEntries(files.map(name=>[name,createHash("sha256").update(readFileSync(resolve(source,name))).digest("hex")]))};
}
function bootstrap(source,label){
 const url=`postgresql://${fixture.user}:${fixture.password}@localhost/${fixture.database}?host=${encodeURIComponent(fixture.socket)}`;
 const env={PATH:"/usr/bin:/bin",HOME:fixture.empty,NODE_ENV:"test",DATABASE_URL:url,HASH_PEPPER:"FICTIONAL_BOOTSTRAP_PEPPER_NOT_PRODUCTION_00000000",ADMIN_PASSWORD:"Fixture-Only-123",APP_URL:"https://public.fixture.invalid",MAIL_PROVIDER:"dev",MAIL_PROVIDERS:"dev",WHATSAPP_ENABLED:"0",SECRETS_DIR:fixture.empty,PETICAO_CONFIG_DIR:fixture.empty,CREDENTIALS_DIRECTORY:fixture.empty,NODE_OPTIONS:"--max-old-space-size=384",PGOPTIONS:"-c statement_timeout=30000 -c lock_timeout=3000"};
 const body=`const m=await import(${JSON.stringify(resolve(source,"site/src/lib/db.ts"))});const db=m.default??m;try{await db.query('SELECT 1')}finally{await db._closeDbForTests()}`;
 const p=spawnSync(process.execPath,["--import",fixture.loader,"--input-type=module","-e",body],{cwd:resolve(source,"site"),env,encoding:"utf8",timeout:180000,maxBuffer:1024*1024});
 writeFileSync(resolve(fixture.output,label+".log"),(p.stdout??"")+(p.stderr??""));assert.equal(p.status,0,label);
}
async function denied(label,operation){await assert.rejects(operation,error=>error.code==="42501");evidence.checks.push(label);}
async function oldRows(){return(await legacy.query("SELECT id,seq,status,pdf,pdf_sha256,approved_at,created_at FROM batches ORDER BY id")).rows;}
try{
 evidence.inputs={legacy:inputs(fixture.legacy),current:inputs(fixture.current)};
 evidence.postgres=(await migration.query("SHOW server_version_num")).rows[0].server_version_num;assert.ok(Number(evidence.postgres)>=170000&&Number(evidence.postgres)<180000);
 bootstrap(fixture.current,"current-schema-before-ownership");
 const before=await oldRows();
 const ownership=await load("batch-runtime-ownership"),readiness=await load("db-schema-readiness");
 const roles={legacy:fixture.user,v2:fixture.runtimeUser,migration:fixture.migrationUser};
 const client=await migration.connect();
 try{evidence.installation=await ownership.installBatchRuntimeOwnership(client,roles);}finally{client.release();}
 assert.deepEqual(await oldRows(),before);evidence.checks.push("installation-preserves-all-original-batch-fields");
 assert.equal((await legacy.query("SELECT runtime_owner FROM batches WHERE id=1")).rows[0].runtime_owner,"legacy");
 await migration.query("GRANT USAGE ON SCHEMA public TO fixture_runtime; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO fixture_runtime; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO fixture_runtime; REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON mail_outbox,application_runtime_roles,batch_runtime_control FROM fixture_runtime");
 const frozen=await readiness.schemaFingerprint(legacy);await readiness.verifyRuntimeSchema(modern,frozen);
 bootstrap(fixture.legacy,"legacy-restart-after-ownership");
 assert.equal(await readiness.schemaFingerprint(legacy),frozen);assert.deepEqual(await oldRows(),before);
 evidence.checks.push("legacy-restart-preserves-ownership-schema-and-original-records");
 const repeated=await migration.connect();try{await ownership.installBatchRuntimeOwnership(repeated,roles);}finally{repeated.release();}
 assert.equal(await readiness.schemaFingerprint(legacy),frozen);evidence.checks.push("ownership-installation-is-idempotent");
 const fresh=(await modern.query("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,list_hash,runtime_owner) VALUES(2,'partial','prepared',0,1,'fixture-v2','legacy') RETURNING id,runtime_owner")).rows[0];
 assert.equal(fresh.runtime_owner,"v2");
 const old=(await legacy.query("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,list_hash,runtime_owner) VALUES(3,'partial','prepared',0,1,'fixture-legacy','v2') RETURNING id,runtime_owner")).rows[0];
 assert.equal(old.runtime_owner,"legacy");evidence.checks.push("inserts-use-authenticated-role-not-requested-owner");
 await legacy.query("UPDATE batches SET approved_by='Fixture legacy actor' WHERE id=1");
 await modern.query("UPDATE batches SET approved_by='Fixture v2 actor' WHERE id=$1",[fresh.id]);
 evidence.checks.push("each-runtime-updates-its-own-batches");
 await denied("legacy-blocked-before-v2-approval-write",()=>legacy.query("UPDATE batches SET approved_at='2026-11-12T00:00:00Z' WHERE id=$1",[fresh.id]));
 await denied("v2-blocked-before-legacy-approval-write",()=>modern.query("UPDATE batches SET approved_at='2026-11-12T00:00:00Z' WHERE id=1"));
 await denied("ownership-transfer-refused",()=>modern.query("UPDATE batches SET runtime_owner='legacy' WHERE id=$1",[fresh.id]));
 await denied("batch-identity-change-refused",()=>modern.query("UPDATE batches SET id=9999 WHERE id=$1",[fresh.id]));
 await denied("legacy-cannot-write-v2-send-receipt",()=>legacy.query("INSERT INTO batch_sends(batch_id,recipient,ok,at) VALUES($1,'qa@fixture.invalid',true,'2026-11-12T00:00:00Z')",[fresh.id]));
 await denied("v2-cannot-write-legacy-send-receipt",()=>modern.query("INSERT INTO batch_sends(batch_id,recipient,ok,at) VALUES(1,'qa@fixture.invalid',true,'2026-11-12T00:00:00Z')"));
 await modern.query("UPDATE signatures SET batch_id=$1 WHERE id=1",[fresh.id]);
 await denied("legacy-cannot-unbind-v2-signature",()=>legacy.query("UPDATE signatures SET batch_id=NULL WHERE id=1"));
 await legacy.query("UPDATE signatures SET name='Fictional public update' WHERE id=1");
 assert.equal((await modern.query("SELECT name FROM signatures WHERE id=1")).rows[0].name,"Fictional public update");
 evidence.checks.push("public-signature-fields-remain-updatable-without-rebinding");
 await denied("v2-cannot-bind-signature-to-legacy-batch",()=>modern.query("UPDATE signatures SET batch_id=1 WHERE id=2"));
 await denied("runtime-cannot-reassign-role-bindings",()=>modern.query("UPDATE application_runtime_roles SET role_name='fixture' WHERE runtime_role='v2'"));
 await migration.query("GRANT UPDATE ON application_runtime_roles TO fixture_runtime");
 await denied("binding-trigger-denies-even-an-accidental-dml-grant",()=>modern.query("UPDATE application_runtime_roles SET role_name='fixture_runtime' WHERE runtime_role='v2'"));
 await assert.rejects(readiness.verifyRuntimeSchema(modern,frozen),/runtime_role_has_ddl_authority/);
 await migration.query("REVOKE UPDATE ON application_runtime_roles FROM fixture_runtime");
 await readiness.verifyRuntimeSchema(modern,frozen);evidence.checks.push("readiness-refuses-unsafe-binding-authority");
 await denied("legacy-cannot-truncate-shared-batches",()=>legacy.query("TRUNCATE batches CASCADE"));
 await denied("v2-cannot-delete-batch-history",()=>modern.query("DELETE FROM batches WHERE id=$1",[fresh.id]));
 assert.equal((await legacy.query("SELECT count(*)::int n FROM batches")).rows[0].n,3);
 assert.equal((await modern.query("SELECT count(*)::int n FROM batches")).rows[0].n,3);evidence.checks.push("both-runtimes-retain-read-access-to-shared-history");
 assert.equal(await readiness.schemaFingerprint(legacy),frozen);evidence.schemaFingerprint=frozen;
 const snapshot=(await legacy.query("SELECT to_jsonb(b) value FROM batches b ORDER BY id")).rows;
 const activate=await migration.connect();try{await ownership.installBatchRuntimeOwnership(activate,roles,{controller:"v2"});}finally{activate.release();}
 assert.deepEqual((await legacy.query("SELECT to_jsonb(b) value FROM batches b ORDER BY id")).rows,snapshot);
 evidence.checks.push("central-control-activation-preserves-every-batch-field-and-provenance");
 await modern.query("UPDATE batches SET approved_by='Fixture adopted actor' WHERE id=1");
 evidence.checks.push("v2-manages-existing-legacy-batch-after-explicit-activation");
 await denied("legacy-cannot-alter-adopted-batch",()=>legacy.query("UPDATE batches SET approved_by='denied' WHERE id=1"));
 await denied("legacy-cannot-create-batch-after-handoff",()=>legacy.query("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,list_hash) VALUES(4,'partial','prepared',0,1,'denied')"));
 await denied("v2-cannot-reassign-controller",()=>modern.query("UPDATE batch_runtime_control SET controller='split'"));
 await denied("legacy-cannot-reassign-controller",()=>legacy.query("UPDATE batch_runtime_control SET controller='split'"));
 await migration.query("GRANT UPDATE ON batch_runtime_control TO fixture_runtime");
 await denied("controller-trigger-denies-accidental-web-dml-grant",()=>modern.query("UPDATE batch_runtime_control SET controller='split'"));
 await assert.rejects(readiness.verifyRuntimeSchema(modern,frozen,{batchController:"v2"}),/runtime_role_has_ddl_authority/);
 await migration.query("REVOKE UPDATE ON batch_runtime_control FROM fixture_runtime");
 await readiness.verifyRuntimeSchema(modern,frozen,{batchController:"v2"});
 await assert.rejects(readiness.verifyRuntimeSchema(modern,frozen,{batchController:"split"}),/runtime_batch_controller_configuration_mismatch/);
 await legacy.query("UPDATE signatures SET name='Public remains writable after handoff' WHERE id=1");
 evidence.checks.push("public-signature-update-and-history-read-survive-central-handoff");
 const revert=await migration.connect();try{await ownership.installBatchRuntimeOwnership(revert,roles,{controller:"split"});}finally{revert.release();}
 await legacy.query("UPDATE batches SET approved_by='Fixture reverted actor' WHERE id=1");
 await denied("rollback-restores-exclusive-split-control",()=>modern.query("UPDATE batches SET approved_by='denied' WHERE id=1"));
 await readiness.verifyRuntimeSchema(modern,frozen,{batchController:"split"});
 evidence.checks.push("explicit-controller-rollback-preserves-data-and-restores-original-authority");
 assert.deepEqual(inputs(fixture.legacy),evidence.inputs.legacy);assert.deepEqual(inputs(fixture.current),evidence.inputs.current);evidence.checks.push("all-source-inputs-unchanged");
 evidence.exit=0;
}catch(error){evidence.errors.push(String(error.stack??error));evidence.exit=1;process.exitCode=1;}
finally{await Promise.all([...pools.values()].map(p=>p.end()));writeFileSync(resolve(fixture.output,"batch-ownership-result.json"),JSON.stringify(evidence,null,2)+"\n");console.log(JSON.stringify({exit:evidence.exit,checks:evidence.checks.length,result:resolve(fixture.output,"batch-ownership-result.json")}));}
