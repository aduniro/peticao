import { config } from "../config";
import type { Mail } from "./index";
export type Stored = Omit<Mail,"attachments"> & {attachments?:{filename:string;contentBase64:string;contentType?:string}[]};
export const toStored = (m: Mail): Stored => ({...m,attachments:m.attachments?.map(a=>({filename:a.filename,contentBase64:a.content.toString("base64"),contentType:a.contentType}))});
export const fromStored = (s: Stored): Mail => ({...s,attachments:s.attachments?.map(a=>({filename:a.filename,content:Buffer.from(a.contentBase64,"base64"),contentType:a.contentType}))});
export const withReplyTo = (m: Mail): Mail => m.replyTo ? m : config.mailReplyTo() ? {...m,replyTo:config.mailReplyTo()} : m;
/** Once recorded, retries use the observed Reply-To rather than a later configuration value. */
export const frozenReplyTo = (m: Mail, replyTo: string|null): Mail => m.replyTo ? m : {...m,replyTo:replyTo??undefined};
