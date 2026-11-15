/** Direct children only; no process-group/cgroup/Root cleanup claim. */
import {spawn} from 'node:child_process';
import {openSync,writeSync,fsyncSync,closeSync} from 'node:fs';
export const MAX_LOG=10*1024*1024;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export function launch(executable,args,{cwd,env,log}){
 const fd=openSync(log,'wx',0o600);let bytes=0,logError=false,forced=false,ended=false;
 const child=spawn(executable,args,{cwd,env,stdio:['ignore','pipe','pipe'],detached:false});
 const consume=data=>{try{bytes+=data.length;if(bytes>MAX_LOG){logError=true;child.kill('SIGTERM');return;}let offset=0;while(offset<data.length){const n=writeSync(fd,data,offset,data.length-offset);if(n<=0)throw Error('Private log write failed');offset+=n;}}catch{logError=true;child.kill('SIGTERM');}};
 child.stdout?.on('data',consume);child.stderr?.on('data',consume);
 let result,settle;
 const done=new Promise(r=>{settle=r;});
 const finish=(code,signal,spawnError=false)=>{if(ended)return;ended=true;try{fsyncSync(fd);}catch{logError=true;}closeSync(fd);result={code,signal,spawnError,logError,forced};settle(result);};
 child.once('error',()=>finish(null,null,true));child.once('close',(code,signal)=>finish(code,signal));
 return {child,done,get ended(){return ended;},get result(){return result;},markForced(){forced=true;}};
}
export async function wait(handle,ms){const end=Date.now()+ms;while(!handle.ended&&Date.now()<end)await pause(25);if(!handle.ended)throw Error('Owned child deadline exceeded');return handle.done;}
export async function stop(handle,ms=15000){
 if(!handle)return {code:0,forced:false,logError:false,spawnError:false};
 if(!handle.ended){handle.child.kill('SIGTERM');try{await wait(handle,ms);}catch{handle.markForced();handle.child.kill('SIGKILL');await wait(handle,5000);}}
 return handle.done;
}
export async function run(executable,args,options,timeout){const handle=launch(executable,args,options);try{const result=await wait(handle,timeout);if(result.code!==0||result.signal||result.spawnError||result.logError)throw Error('Private QA stage failed');return result;}finally{if(!handle.ended)await stop(handle);}}
