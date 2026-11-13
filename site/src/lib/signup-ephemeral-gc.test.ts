import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as db from './db';
import { purgeSignupEphemera } from './signup-ephemeral-gc';
test('housekeeping removes only old expired intentions/receipts and preserves evidence/history/candidates',async()=>{
 await db._openForTests('t_ncpf_gc');
 try{
  const id=randomUUID();
  const sig=(await db.query("INSERT INTO signatures(name,email,email_hash,category,text_version,consent_at) VALUES('Fixture Person','fixture@example.invalid','fixture','apoiador','fixture',now()::text) RETURNING id")).rows[0].id;
  await db.query("INSERT INTO ncpf_evidence(id,cpf_hash,payload,document_sha256,document_bytes,fetched_at,expires_at,last_verified_at) VALUES($1,'fixture','encrypted-fixture',$2,$3,now()-interval '60 days',now()-interval '30 days',now()-interval '60 days')",[id,'a'.repeat(64),Buffer.from('%PDF-fixture')]);
  await db.query("INSERT INTO signature_name_history(signature_id,previous_name,selected_name,evidence_id) VALUES($1,'Fixture Old','Fixture Person',$2)",[sig,id]);
  await db.query("INSERT INTO ncpf_candidates(signature_id,cpf_hash,payload) VALUES($1,'fixture','encrypted-fixture')",[sig]);
  for(const [label,age]of [['old',"now()-interval '3 days'"],['recent',"now()-interval '1 minute'"],['live',"now()+interval '1 hour'"]]){
   await db.query(`INSERT INTO ncpf_intents(id,token_hash,binding_hash,cpf_hash,declared_name,visitor_hash,security_passed,expires_at) VALUES($1,$2,'fixture','fixture','Fixture','fixture',false,${age})`,[randomUUID(),label]);
   await db.query(`INSERT INTO signup_receipts(request_hash,binding_hash,state,lease_until,expires_at) VALUES($1,'fixture','done',now(),${age})`,[label]);
   await db.query(`INSERT INTO confirmation_receipts(token_hash,signature_id,expires_at) VALUES($1,$2,${age})`,[label,sig]);
  }
  await purgeSignupEphemera(true);
  for(const table of ['ncpf_intents','signup_receipts','confirmation_receipts'])assert.equal((await db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,2);
  for(const table of ['ncpf_evidence','signature_name_history','ncpf_candidates','signatures'])assert.equal((await db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,1);
 }finally{await db._closeDbForTests();}
});
