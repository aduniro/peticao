import type { PoolClient } from "pg";
import { audit, tx } from "../db";
import { renderMailPreview } from "./preview-render";
import { readInboundContent, type InboundReader } from "./inbound-store";

export const inboundId = (id:string) => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id);
const accountValid = (v:string) => /^[a-zA-Z0-9_-]{1,80}$/.test(v);
const inputError = {ok:false as const,error:"input" as const};
const dateValid = (s:string) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString()===s.slice(0,23)+"Z";
const cursorFor = (scope:string,time:string,id:string) => Buffer.from(JSON.stringify([scope,time,id])).toString("base64url");
function cursorValue(cursor:string|undefined,scope:string) {
  if(cursor===undefined)return null;
  if(cursor.length>400 || !/^[A-Za-z0-9_-]+$/.test(cursor))throw new Error("input");
  const bytes=Buffer.from(cursor,"base64url");if(bytes.toString("base64url")!==cursor)throw new Error("input");
  const v:unknown=JSON.parse(bytes.toString("utf8"));
  if(!Array.isArray(v)||v.length!==3||v[0]!==scope||typeof v[1]!=="string"||!dateValid(v[1])||typeof v[2]!=="string"||!inboundId(v[2]))throw new Error("input");
  return {at:v[1],id:v[2]};
}
async function permitted(c:PoolClient,a:InboundReader) {
  if(!Number.isInteger(a?.userId)||a.userId<1||a.userId>2147483647||!Number.isInteger(a.sessaoId)||a.sessaoId!<1||a.sessaoId!>2147483647||typeof a.email!=="string")return false;
  return !!(await c.query(`SELECT u.id FROM admin_users u JOIN admin_sessions s ON s.user_id=u.id
    WHERE u.id=$1 AND lower(u.email)=$2 AND u.ativo AND u.nivel IN ('edicao','exclusao','total')
    AND s.id=$3 AND s.expira_em>now() AND s.stepup_ate>now() FOR SHARE OF u,s`,[a.userId,a.email.toLowerCase(),a.sessaoId])).rowCount;
}
const bounded = (c:PoolClient) => c.query("SET LOCAL statement_timeout='5000ms'; SET LOCAL lock_timeout='2000ms'");
const stamp = (field:string) => `to_char(${field} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
type Thread = {thread_root:string;messages:number;available:number;last_at:string};
export async function listInboundThreads(input:{account:string;limit?:number;cursor?:string},actor:InboundReader) {
  const limit=input.limit??20;let cursor;
  if(!accountValid(input.account)||!Number.isInteger(limit)||limit<1||limit>50)return inputError;
  try{cursor=cursorValue(input.cursor,`threads:${input.account}`);}catch{return inputError;}
  return tx(async c=>{
    await bounded(c);if(!await permitted(c,actor))return {ok:false as const,error:"forbidden" as const};
    const rows=(await c.query<Thread>(`WITH threads AS (
      SELECT thread_root,count(*)::int messages,count(*) FILTER(WHERE expires_at>clock_timestamp() AND content_cipher IS NOT NULL)::int available,max(created_at) last_created
      FROM mail_inbound_messages WHERE account=$1 GROUP BY thread_root
    ) SELECT thread_root,messages,available,${stamp("last_created")} last_at FROM threads
      WHERE ($2::timestamptz IS NULL OR (last_created,thread_root)<($2::timestamptz,$3::uuid)) ORDER BY last_created DESC,thread_root DESC LIMIT $4`,[input.account,cursor?.at??null,cursor?.id??null,limit+1])).rows;
    const page=rows.slice(0,limit),last=page.at(-1);
    await audit("mail_inbound_threads_listed",null,{account:input.account,userId:actor.userId,count:page.length},c);
    return {ok:true as const,threads:page,nextCursor:rows.length>limit&&last?cursorFor(`threads:${input.account}`,last.last_at,last.thread_root):null};
  });
}
type Message = {id:string;received_at:string;created_at:string;expires_at:string;state:"expired"|"available"|"unavailable";correlation:"new"|"header-reference"};
export async function listInboundThreadMessages(input:{account:string;threadRoot:string;limit?:number;cursor?:string},actor:InboundReader) {
  const limit=input.limit??20;let cursor;const scope=`messages:${input.account}:${input.threadRoot}`;
  if(!accountValid(input.account)||!inboundId(input.threadRoot)||!Number.isInteger(limit)||limit<1||limit>50)return inputError;
  try{cursor=cursorValue(input.cursor,scope);}catch{return inputError;}
  return tx(async c=>{
    await bounded(c);if(!await permitted(c,actor))return {ok:false as const,error:"forbidden" as const};
    const rows=(await c.query<Message>(`SELECT id,${stamp("received_at")} received_at,${stamp("created_at")} created_at,${stamp("expires_at")} expires_at,correlation,
      CASE WHEN expires_at<=clock_timestamp() THEN 'expired' WHEN content_cipher IS NOT NULL THEN 'available' ELSE 'unavailable' END state
      FROM mail_inbound_messages WHERE account=$1 AND thread_root=$2 AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::uuid))
      ORDER BY created_at DESC,id DESC LIMIT $5`,[input.account,input.threadRoot,cursor?.at??null,cursor?.id??null,limit+1])).rows;
    const page=rows.slice(0,limit),last=page.at(-1);
    await audit("mail_inbound_thread_listed",null,{account:input.account,threadRoot:input.threadRoot,userId:actor.userId,count:page.length},c);
    return {ok:true as const,messages:page,nextCursor:rows.length>limit&&last?cursorFor(scope,last.created_at,last.id):null};
  });
}

/** Only the existing transformed full document is exposed, never the received HTML. */
export async function previewInboundMessage(id:string,actor:InboundReader) {
  const read=await readInboundContent(id,actor);
  if(!read.ok||read.state!=="stored")return read;
  const mail=read.mail;
  return {ok:true as const,state:"preview" as const,preview:renderMailPreview({to:mail.to.join(", "),subject:mail.subject,text:mail.text,...(mail.html?{html:mail.html}:{}),attachments:mail.attachments.map(a=>({filename:a.name,content:a.content,contentType:a.contentType}))})};
}
export async function downloadInboundAttachment(id:string,index:number,actor:InboundReader) {
  if(!Number.isInteger(index)||index<0||index>3)return inputError;
  const read=await readInboundContent(id,actor);
  if(!read.ok||read.state!=="stored")return read;
  const attachment=read.mail.attachments[index];
  return attachment?{ok:true as const,state:"attachment" as const,bytes:attachment.content,index}:{ok:false as const,error:"not_found" as const};
}
