import type { PendingEmailActor } from "@/lib/pending-email-admin-contract";
export type MailHistoryActor = PendingEmailActor;
export const MESSAGE_STATES = ["prepared","sending","accepted","rejected","indeterminate","queued"] as const;
export const MAIL_CHANNELS = ["transactional","marketing"] as const;
export const CONTENT_STATES = ["unavailable","stored","expired","oversize"] as const;
export const ATTEMPT_STATES = ["prepared","accepted","rejected","indeterminate"] as const;
export const EVENT_STATES = ["delivered","opened","clicked","hard_bounce","soft_bounce","blocked","complaint"] as const;
export const validHistoryUuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
export const validHistoryKey = (v: unknown): v is string => typeof v === "string" && (v.startsWith("message:") && validHistoryUuid(v.slice(8)) || /^legacy:[1-9][0-9]{0,9}$/.test(v) && Number(v.slice(7)) <= 2147483647);
export const validHistoryEventId = (v: unknown): v is string => typeof v === "string" && /^[1-9][0-9]{0,18}$/.test(v) && (v.length < 19 || v <= "9223372036854775807");
export type HistoryOptions = { before?: string; limit?: number; recipient?: string; kind?: string; channel?: string; status?: string };
export type HistoryCollection = "attempts" | "events";
export type HistoryCollectionOptions = { before?: string; limit?: number };
export type HistoryFailure = { ok: false; error: "parameters" | "not_found" | "forbidden" | "unavailable" };
export type HistoryRow = { record_key: string; source: "message" | "legacy_attempt"; created_at: string; kind: string; channel: string; to_addr: string; status: string; content_state: string; previous_id: string | null };
export type HistoryCoverage = { total: number; returned: number; complete: true };
export type HistoryPage = { ok: true; asOf: string; total: number; records: HistoryRow[]; next: string | null; coverage: HistoryCoverage };
export type HistoryAttempt = { id: string; provider: string; from_addr: string; state: string; started_at: string; finished_at: string | null; provider_id: string | null; error_code: string | null };
export type HistoryEvent = { id: string; provider: string; event_type: string; occurred_at: string; received_at: string; attempt_id: string | null };
export type HistoryMessageRecord = { id: string; created_at: string; kind: string; channel: string; to_addr: string; status: string; previous_id: string | null; content_state: string };
export type HistoryLegacyRecord = { id: number; created_at: string; kind: string; channel: string; to_addr: string; provider: string; from_addr: string | null; status: string };
export type HistoryCollectionMeta = { total: number; returned: number; next: string | null; complete: true };
export type HistoryDetail = { ok: true; key: string; asOf: string; attempts: HistoryAttempt[]; events: HistoryEvent[]; attempts_truncated: boolean; events_truncated: boolean; attemptsPage: HistoryCollectionMeta; eventsPage: HistoryCollectionMeta } & ({source:"message";record:HistoryMessageRecord;content_state:string}|{source:"legacy_attempt";record:HistoryLegacyRecord;content_state:"unavailable"});
export type HistoryCollectionPage = { ok: true; key: string; asOf: string; total: number; next: string | null; coverage: HistoryCoverage } & ({ collection: "attempts"; items: HistoryAttempt[] } | { collection: "events"; items: HistoryEvent[] });
export type HistoryRequest = { mode:"list";options:HistoryOptions } | {mode:"detail";key:string} | {mode:"collection";key:string;collection:HistoryCollection;options:HistoryCollectionOptions};
export function historySearch(sp: URLSearchParams): HistoryRequest | null {
  if(sp.toString().length>16384)return null;
  for(const [key,value]of sp)if(!["id","collection","before","limit","recipient","kind","channel","status"].includes(key)||sp.getAll(key).length!==1||/[\u0000-\u001f\u007f]/.test(value))return null;
  const limit=sp.has("limit")?Number(sp.get("limit")):undefined;
  if(sp.has("limit")&&(!/^[1-9][0-9]{0,2}$/.test(sp.get("limit")!)||!Number.isInteger(limit)))return null;
  const before=sp.get("before")??undefined;if(before!==undefined&&(!/^[A-Za-z0-9_-]{1,800}$/.test(before)))return null;
  if(sp.has("id")){
    const key=sp.get("id")!;if(!validHistoryKey(key)||[...sp.keys()].some(k=>!["id","collection","before","limit"].includes(k)))return null;
    if(!sp.has("collection"))return sp.size===1?{mode:"detail",key}:null;
    const collection=sp.get("collection");if(!["attempts","events"].includes(collection!)||key.startsWith("legacy:")||limit!==undefined&&(limit<1||limit>100))return null;
    return{mode:"collection",key,collection:collection as HistoryCollection,options:{before,limit}};
  }
  if(sp.has("collection")||limit!==undefined&&(limit<1||limit>50))return null;
  const recipient=sp.get("recipient")??undefined,kind=sp.get("kind")??undefined,channel=sp.get("channel")??undefined,status=sp.get("status")??undefined;
  if(recipient!==undefined&&(!recipient||recipient.length>254)||kind!==undefined&&!/^[a-zA-Z0-9_.:-]{1,100}$/.test(kind)||channel!==undefined&&!MAIL_CHANNELS.includes(channel as typeof MAIL_CHANNELS[number])||status!==undefined&&!MESSAGE_STATES.includes(status as typeof MESSAGE_STATES[number]))return null;
  return{mode:"list",options:{before,limit,recipient,kind,channel,status}};
}
