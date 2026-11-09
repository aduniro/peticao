import { mkdirSync, openSync, writeSync, closeSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
/** Metadata only; an unavailable monitor must never break email delivery. */
export function registrarEnvioMonitor({para,assunto,result}, directory=process.env.VIGIA_STATE??"/mnt/apps/peticao-final/_externos/home/barre/.local/state/peticao-monitor") {
  if(para!=='operator-1608598f41@example.invalid')return;
  try {
    mkdirSync(directory,{recursive:true,mode:0o700});
    const fd=openSync(join(directory,'mail-history.jsonl'),constants.O_APPEND|constants.O_CREAT|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
    try {writeSync(fd,JSON.stringify({id:result.id??randomUUID(),at:new Date().toISOString(),recipient:para,subject:String(assunto).slice(0,300),state:result.status>=200&&result.status<300?'accepted':'failed',provider_id:result.id??null})+'\n');}finally{closeSync(fd);}
  }catch{/* Delivery remains authoritative; monitoring is best effort. */}
}
