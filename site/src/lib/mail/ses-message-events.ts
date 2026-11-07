import { providerId } from "./receipt";
import { snsScope } from "./event-scope";
import { eventTimestamp, type MessageEvent } from "./message-events";
/** Called only after SNS signature + configured topic verification. No fallback to headers or current time. */
export function sesMessageEvents(event: any, authenticatedTopic: string): MessageEvent[] {
  const account=event?.mail?.sendingAccountId;
  if(typeof account!=="string" || !/^\d{12}$/.test(account))return [];
  const accountScope=snsScope(authenticatedTopic,account), id=providerId(event?.mail?.messageId);
  const raw=event?.mail?.destination;
  if(!accountScope || !id || !Array.isArray(raw) || raw.length>100)return [];
  const destinations=new Set<string>(raw.filter((s:unknown):s is string=>typeof s==="string").map((s:string)=>s.trim().toLowerCase()));
  const kind=event?.eventType??event?.notificationType;
  let recipients:unknown[]=[],type:string|undefined,timestamp:unknown;
  if(kind==="Delivery") { recipients=event.delivery?.recipients;type="delivered";timestamp=event.delivery?.timestamp; }
  else if(kind==="Bounce") { recipients=(Array.isArray(event.bounce?.bouncedRecipients)?event.bounce.bouncedRecipients:[]).map((r:any)=>r?.emailAddress);type=event.bounce?.bounceType==="Permanent"?"hard_bounce":event.bounce?.bounceType==="Transient"?"soft_bounce":undefined;timestamp=event.bounce?.timestamp; }
  else if(kind==="Complaint") { recipients=(Array.isArray(event.complaint?.complainedRecipients)?event.complaint.complainedRecipients:[]).map((r:any)=>r?.emailAddress);type="complaint";timestamp=event.complaint?.timestamp; }
  else if(kind==="Open" || kind==="Click") {
    // SES's open/click objects do not identify which one of several envelope recipients acted.
    if(destinations.size!==1)return [];
    recipients=[...destinations];type=kind==="Open"?"opened":"clicked";timestamp=kind==="Open"?event.open?.timestamp:event.click?.timestamp;
  }
  const at=eventTimestamp(timestamp);
  if(!type || !at || !Array.isArray(recipients) || recipients.length>100)return [];
  return [...new Set(recipients.filter((s):s is string=>typeof s==="string").map(s=>s.trim().toLowerCase()))]
    .filter(recipient=>destinations.has(recipient))
    .map(recipient=>({provider:"ses",accountScope,providerId:id,recipient,type:type!,timestamp:at,source:"sns" as const}));
}
