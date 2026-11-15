/** Fixed new per-job helper; import has no execution side effects. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {pathToFileURL as entryURL} from 'node:url';

export async function main(){
  const root=process.cwd()+'/private-qa',base='http://127.0.0.1:28452';
  const fixture=JSON.parse(readFileSync(root+'/fixture.private.json','utf8'));
  const checks=[];const result={checks,productionAccess:false,realMail:false};
  async function get(query='',token=fixture.token,origin=base){return fetch(base+'/api/admin/assinaturas/explorar'+query,{headers:{...(token?{cookie:'adm='+token}:{}),origin},redirect:'error'});}
  try{
   for(const p of ['/api/internal/ready','/admin/assinaturas','/admin/mapa','/admin/usuarios','/admin/lotes']){const r=await fetch(base+p,{headers:{cookie:'adm='+fixture.token}});assert.equal(r.status,200,p);}
   checks.push('actual compiled readiness/query/map/users/lotes pages return200 with fictional account');
   const r=await get();assert.equal(r.status,200);const j=await r.json();assert.equal(j.ok,true);assert.equal(j.total,22);assert.equal(j.linhas.length,22);assert.equal(j.pagina,1);assert.equal(j.coverage.complete,true);assert.equal(j.totais.confirmadas+j.totais.pendentes,j.total);
   checks.push('actual explorer backend returns complete seeded22-row contract');
   const empty=await(await get('?q=R1_NAO_EXISTE')).json();assert.equal(empty.total,0);assert.equal(empty.linhas.length,0);checks.push('actual valid empty response');
   for(const q of ['?pagina=1.5','?de=2026-02-30','?unknown=1'])assert.equal((await get(q)).status,400,q);checks.push('actual malformed query rejected400');
   assert.equal((await get('',null)).status,401);assert.equal((await get('',fixture.token,'https://qa-other.invalid')).status,403);checks.push('actual no-session401 and incompatible-origin403');
   const csv=await get('?formato=csv');assert.equal(csv.status,200);const bytes=Buffer.from(await csv.arrayBuffer());assert.match(csv.headers.get('content-type'),/^text\/csv/);assert.equal(csv.headers.get('x-content-sha256'),createHash('sha256').update(bytes).digest('hex'));assert.equal(Number(csv.headers.get('content-length')),bytes.length);checks.push('actual CSV content/hash/length contract');
   for(const category of ['servidor','apoiador']){const a=await(await get('?categoria='+category)).json();assert.equal(a.ok,true);assert.equal(a.total,11);assert.ok(a.linhas.every(x=>x.categoria===category));}checks.push('actual category filters and totals');
   result.ok=true;
  }catch(e){result.ok=false;result.error=String(e.stack??e);process.exitCode=1;}finally{writeFileSync(root+'/BACKEND-SMOKE.json',JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify({ok:result.ok,checks:checks.length,evidence:root+'/BACKEND-SMOKE.json'}));}
}

if(process.argv[1]&&import.meta.url===entryURL(process.argv[1]).href)await main();
