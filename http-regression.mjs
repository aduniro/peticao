import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import pg from './runtime/node_modules/pg/lib/index.js';
const root='/mnt/apps/peticao-final/.qt1';
const base='http://127.0.0.1:3184',ip='192.0.2.81',other='192.0.2.82';
const fixture=JSON.parse(readFileSync(root+'/fixture.private.json','utf8'));
const pool=new pg.Pool({connectionString:'postgres://peticao:peticao@127.0.0.1:54524/peticao'});
const checks=[];const result={checks,productionAccess:false,realMail:false};
async function post(path,fields,address=ip){
 const res=await fetch(base+path,{method:'POST',headers:{origin:base,'x-forwarded-for':address},body:new URLSearchParams(fields),redirect:'manual'});
 return {status:res.status,location:res.headers.get('location')??'',cookie:res.headers.get('set-cookie')??''};
}
const login=(password,address=ip,email='qa@example.invalid')=>post('/api/admin/login',{email,password},address);
const reset=token=>post('/api/admin/redefinir',{token,senha:'Mudanca-Segura-2026-AB',senha2:'Mudanca-Segura-2026-AB'});
async function token(expired=false){const raw=randomBytes(32).toString('base64url');await pool.query("INSERT INTO admin_reset(user_id,token_hash,expira_em) VALUES($1,$2,now()+$3::interval)",[fixture.userId,createHash('sha256').update(raw).digest('hex'),expired?'-1 minute':'30 minutes']);return raw;}
async function blocked(address=ip){const r=await login('Mudanca-Segura-2026-AB',address);assert.match(r.location,/erro=limite/);assert.equal(r.cookie,'');}
try{
 assert.equal((await pool.query('SHOW data_directory')).rows[0].data_directory,root+'/pg-http');
 const ready=await fetch(base+'/admin',{headers:{cookie:'adm='+fixture.token}});assert.equal(ready.status,200);
 for(let i=0;i<5;i++)await login('Senha-Incorreta-QA');
 await blocked();checks.push('real compiled login endpoint rejects sixth attempt from exhausted IP');
 for(let i=0;i<5;i++)await login('Senha-Incorreta-QA',other,'missing@example.invalid');
 await blocked(other);checks.push('second IP independently exhausted');
 let r=await reset(randomBytes(32).toString('base64url'));assert.match(r.location,/erro=token/);await blocked();checks.push('invalid reset does not clear compiled login limit');
 r=await reset(await token(true));assert.match(r.location,/erro=token/);await blocked();checks.push('expired reset does not clear compiled login limit');
 const valid=await token();r=await reset(valid);assert.equal(r.status,303);assert.match(r.location,/msg=senha-redefinida/);
 const oldHash=createHash('sha256').update(fixture.token).digest('hex');assert.equal((await pool.query('SELECT count(*)::int n FROM admin_sessions WHERE token_hash=$1',[oldHash])).rows[0].n,0);checks.push('successful reset committed and revoked old session');
 r=await login('Mudanca-Segura-2026-AB');assert.equal(r.status,303);assert.ok(!r.location.includes('erro='));assert.match(r.cookie,/^adm=/);checks.push('immediate real compiled login succeeds after reset: shared counter proven across routes');
 await blocked(other);checks.push('successful reset preserves exhausted second IP');
 for(let i=0;i<5;i++)await login('Senha-Incorreta-QA');
 await blocked();r=await reset(valid);assert.match(r.location,/erro=token/);await blocked();checks.push('replayed reset cannot clear new exhaustion');
 result.ok=true;
}catch(e){result.ok=false;result.error=String(e.stack??e);process.exitCode=1;}finally{await pool.end();writeFileSync(root+'/HTTP-REGRESSION.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
