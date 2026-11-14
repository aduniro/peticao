import {query,getPool} from './source/site/src/lib/db';
import {schemaFingerprint} from './source/site/src/lib/db-schema-readiness';
import {hashSenha} from './source/site/src/lib/senha';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';

async function main(){
 await query('SELECT 1');
 const p=getPool();
 await p.query("ALTER TABLE batches ADD COLUMN IF NOT EXISTS runtime_owner TEXT NOT NULL DEFAULT 'v2'");
 for(let i=1;i<=22;i++){
  await p.query(`INSERT INTO signatures(name,email,email_hash,cpf_hash,category,institution,role,city,uf,text_version,consent_at,status,confirmed_at,seq,verify_code,email_domain_kind,cpf_name_check)
   VALUES($1,$2,$3,$4,$5,$6,'docente','Porto Velho','RO','qa-only',now()::text,$7,$8,$9,$10,'ifes','match')`,
   [i%3===0?'Maria de Albuquerque e Vasconcelos Nome Muito Extenso de Teste '+i:'Pessoa Fictícia de Teste '+i,'qa'+i+'@example.invalid','email-qa-'+i,'cpf-qa-'+i,i%2?'servidor':'apoiador','Universidade Federal Fictícia de Nome Extenso para Testes de Interface',i%4?'confirmed':'pending',i%4?new Date().toISOString():null,i%4?i:null,'fixture'+String(i).padStart(8,'0')]);
  await p.query("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,list_hash,pdf_sha256,signature_kind) VALUES($1,'partial','prepared',$2,$3,$4,$5,'none')",[i,i*400,i*100,'a'.repeat(64),'b'.repeat(64)]);
  await p.query("INSERT INTO mail_log(kind,provider,to_addr,status,error) VALUES('confirmation','dev',$1,$2,$3)",['qa'+i+'@example.invalid',i%3?'sent':'failed',i%3?null:'Erro fictício com descrição extensa para avaliação da tabela e das mensagens ao administrador.']);
  if(i<=8)await p.query("INSERT INTO contact_messages(name,email,kind,message) VALUES($1,$2,'duvida',$3)",['Pessoa Fictícia '+i,'contato'+i+'@example.invalid','Solicitação fictícia para avaliar controles, assunto longo e legibilidade sem dados pessoais reais. '.repeat(3)]);
 }
 const user=await p.query("INSERT INTO admin_users(email,nome,nivel,senha_hash) VALUES('qa@example.invalid','Administrador de Teste','total',$1) RETURNING id",[hashSenha('QaOnlyPassword-20261113')]);
 const token=randomBytes(32).toString('base64url');
 await p.query("INSERT INTO admin_sessions(token_hash,user_id,expira_em,stepup_ate,ip_hash) VALUES($1,$2,now()+interval '1 hour',now()+interval '1 hour','qa-only')",[createHash('sha256').update(token).digest('hex'),user.rows[0].id]);
 await p.query("CREATE ROLE qa_ui_runtime LOGIN PASSWORD 'qa-local-only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
 await p.query("CREATE TABLE IF NOT EXISTS application_runtime_roles(runtime_role TEXT PRIMARY KEY,role_name TEXT NOT NULL UNIQUE)");
 await p.query("INSERT INTO application_runtime_roles VALUES('v2','qa_ui_runtime'),('legacy','qa_legacy_unused'),('worker','qa_worker_unused')");
 await p.query("CREATE TABLE IF NOT EXISTS batch_runtime_control(singleton BOOLEAN PRIMARY KEY DEFAULT true,controller TEXT NOT NULL)");
 await p.query("INSERT INTO batch_runtime_control VALUES(true,'v2')");
 await p.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
 await p.query('GRANT USAGE ON SCHEMA public TO qa_ui_runtime');
 await p.query('GRANT SELECT ON ALL TABLES IN SCHEMA public TO qa_ui_runtime');
 await p.query('CREATE TABLE IF NOT EXISTS mail_outbox_v2 (LIKE mail_outbox INCLUDING ALL)');
 await p.query('GRANT SELECT ON ALL TABLES IN SCHEMA public TO qa_ui_runtime');
 await p.query('GRANT UPDATE ON admin_users,admin_sessions TO qa_ui_runtime');
 await p.query('GRANT UPDATE ON admin_reset TO qa_ui_runtime');
 await p.query('GRANT INSERT,DELETE ON admin_sessions TO qa_ui_runtime');
 await p.query('GRANT INSERT ON audit_log TO qa_ui_runtime');
 await p.query('GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO qa_ui_runtime');
 const hash=await schemaFingerprint(p);
 writeFileSync(new URL('./fixture.private.json',import.meta.url),JSON.stringify({schemaSha256:hash,token,userId:user.rows[0].id,fictionalOnly:true}),{mode:0o600});
 console.log(JSON.stringify({ok:true,signatures:22,batches:22,contacts:8,db:'isolated QA54524',schemaSha256:hash}));
 await p.end();
}
main().catch(e=>{console.error(e);process.exit(1)});
