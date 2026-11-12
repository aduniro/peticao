import { mailQueueScope, queuedMessageKey } from "./queue-scope";
import { prepareMessage,beginAttempt,finishAttempt,messageMetadata,linkOutbox } from "./archive";
import { contentFingerprint } from "./archive-codec";
import { frozenReplyTo,withReplyTo } from "./payload";
import type { Mail } from "./index";
import type { TransportReceipt } from "./receipt";
import { ADMIN_CONTENT_RETENTION_DAYS, adminContentDeadline } from "../admin-retention-policy";
export class MailJournalError extends Error {}
export class MailTransportRejected extends Error {}
export type DeliveryJournal = {begin(provider:string,from:string):Promise<{id?:string;alreadyAccepted?:boolean}>;finish(id:string,accepted:boolean,error?:unknown,receipt?:TransportReceipt):Promise<void>};
/** No policy is silently selected; content retention is enabled only by explicit deployment configuration. */
export function archivePolicy() {
  const value=process.env.MAIL_ARCHIVE_RETENTION;
  if (!value) return undefined;
  if (value!==String(ADMIN_CONTENT_RETENTION_DAYS)) throw new MailJournalError("archive_policy_invalid");
  return {until:adminContentDeadline()};
}
export async function prepareRecorded(mail:Mail,kind:string,channel:"transactional"|"marketing",requestKey?:string) {
  return prepareMessage(mail,kind,channel,{requestKey,archive:archivePolicy()});
}
export function journalFor(messageId:string,retryUncertain:boolean):DeliveryJournal {
  // The isolated v2 runtime never treats a timeout/unknown outcome as permission
  // to repeat transport. Proven rejections may still use the normal failover.
  const permitUncertain = retryUncertain && mailQueueScope() === "legacy";
  return {
    async begin(provider,from){
      const result=await beginAttempt(messageId,provider,from,{retryUncertain:permitUncertain});
      if(result.ok)return {id:result.id};
      if(result.error==="already_accepted")return {alreadyAccepted:true};
      throw new MailJournalError("mail_record_"+result.error);
    },
    async finish(id,accepted,error,receipt){
      const result=await finishAttempt(id,accepted?"accepted":error instanceof MailTransportRejected?"rejected":"indeterminate",{providerId:receipt?.providerId,accountScope:receipt?.accountScope,...(accepted?{}:{errorCode:error instanceof MailTransportRejected?"provider_rejected":"transport_uncertain"})});
      if(!result.ok)throw new MailJournalError("mail_result_"+result.error);
    }
  };
}
/** A legacy queue item gets one identity before its first observed attempt under the new code. */
export async function recordedQueueMail(raw:Mail,kind:string,context:{id:number;messageId:string|null}) {
  let id=context.messageId,mail:Mail;
  if(id){
    const row=await messageMetadata(id);
    if(!row||row.kind!==kind||row.channel!=="transactional"||row.to_addr!==raw.to.toLowerCase())throw new MailJournalError("queue_conflict");
    mail=frozenReplyTo(raw,row.reply_to);
    if(contentFingerprint(mail)!==row.content_fingerprint)throw new MailJournalError("queue_conflict");
  }else{
    mail=withReplyTo(raw);
    id=(await prepareRecorded(mail,kind,"transactional",queuedMessageKey(context.id))).id;
    const linked=await linkOutbox(context.id,id,{frozenDefault:true});
    if(!linked.ok)throw new MailJournalError("queue_conflict");
  }
  return {id,mail};
}
