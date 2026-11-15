/** Fixed new per-job helper; import has no execution side effects. */
import {readFileSync,writeFileSync} from 'node:fs';
import {randomBytes,createHash} from 'node:crypto';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {pathToFileURL} from 'node:url';
import {pathToFileURL as entryURL} from 'node:url';

export async function main(){
  const {default:pg}=await import(pathToFileURL(process.cwd()+'/compiled/node_modules/pg/lib/index.js'));
  const root=process.cwd()+'/private-qa';const f=JSON.parse(readFileSync(root+'/fixture.private.json','utf8'));
  const db=new pg.Pool({connectionString:'postgres://peticao:peticao@127.0.0.1:28451/peticao'});
  try{
   const d=await db.query('SHOW data_directory');if(d.rows[0].data_directory!==root+'/pg')throw Error('Not the owned fictional QA data directory');
   const token=randomBytes(32).toString('base64url');await db.query("INSERT INTO admin_sessions(token_hash,user_id,expira_em,stepup_ate,ip_hash) VALUES($1,$2,now()+interval '2 hours',now()+interval '2 hours','qa-only')",[createHash('sha256').update(token).digest('hex'),f.userId]);
   writeFileSync(root+'/fixture.private.json',JSON.stringify({...f,token}),{mode:0o600});console.log('Fictional QA session refreshed; token not printed.');
  }finally{await db.end();}
}

if(process.argv[1]&&import.meta.url===entryURL(process.argv[1]).href)await main();
