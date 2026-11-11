import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { config } from "../config";
import { hmac } from "../security";
import type { Mail } from "./index";
export const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const validMessageId = (id: unknown): id is string => typeof id === "string" && UUID.test(id);
const key = () => Buffer.from(hkdfSync("sha256", config.pepper(), "peticao-mail-archive", "content-v1", 32));
function validateMail(mail: Mail) {
  if (!mail || ![mail.to,mail.subject,mail.text].every(s => typeof s === "string") || mail.html !== undefined && typeof mail.html !== "string" || mail.replyTo !== undefined && typeof mail.replyTo !== "string" || mail.bcc !== undefined && (!Array.isArray(mail.bcc) || !mail.bcc.every(s=>typeof s === "string")) || mail.attachments !== undefined && (!Array.isArray(mail.attachments) || !mail.attachments.every(a=>typeof a.filename === "string" && Buffer.isBuffer(a.content) && (a.contentType === undefined || typeof a.contentType === "string")))) throw new Error("archive_parameters");
}
const wire = (mail: Mail, attachments: unknown) => ({format:1,to:mail.to,bcc:mail.bcc,replyTo:mail.replyTo,subject:mail.subject,text:mail.text,html:mail.html,attachments});
export function fitsArchive(mail: Mail) {
  validateMail(mail);
  const skeleton = JSON.stringify(wire(mail,mail.attachments?.map(a=>({filename:a.filename,contentType:a.contentType,base64:""}))));
  return Buffer.byteLength(skeleton)+(mail.attachments??[]).reduce((n,a)=>n+4*Math.ceil(a.content.length/3),0)<=MAX_ARCHIVE_BYTES;
}
export function serializeMail(mail: Mail): string {
  if (!fitsArchive(mail)) throw new Error("archive_size");
  return JSON.stringify(wire(mail,mail.attachments?.map(a=>({filename:a.filename,contentType:a.contentType,base64:a.content.toString("base64")}))));
}
/** Bounded attachment metadata and a keyed digest: large files do not need a second base64 allocation. */
export function contentFingerprint(mail: Mail): string {
  validateMail(mail);
  return hmac("mail-content-v1:"+JSON.stringify(wire(mail,mail.attachments?.map(a=>({filename:a.filename,contentType:a.contentType,bytes:a.content.length,sha256:createHash("sha256").update(a.content).digest("hex")})))));
}
export function encryptMail(id: string, serialized: string): string {
  if (!validMessageId(id) || Buffer.byteLength(serialized) > MAX_ARCHIVE_BYTES) throw new Error("archive_parameters");
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(`mail-content-v1:${id}`));
  const bytes = Buffer.concat([cipher.update(serialized,"utf8"),cipher.final()]);
  return `v1.${iv.toString("hex")}.${cipher.getAuthTag().toString("hex")}.${bytes.toString("base64")}`;
}
export function decryptMail(id: string, encrypted: string): Mail {
  try {
    if (!validMessageId(id) || encrypted.length > MAX_ARCHIVE_BYTES * 1.4 + 128) throw new Error();
    const parts = encrypted.split(".");
    if (parts.length !== 4 || parts[0] !== "v1" || !/^[a-f0-9]{24}$/.test(parts[1]) || !/^[a-f0-9]{32}$/.test(parts[2])) throw new Error();
    if (Buffer.from(parts[3],"base64").toString("base64") !== parts[3]) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm",key(),Buffer.from(parts[1],"hex"));
    decipher.setAAD(Buffer.from(`mail-content-v1:${id}`));decipher.setAuthTag(Buffer.from(parts[2],"hex"));
    const value = JSON.parse(Buffer.concat([decipher.update(Buffer.from(parts[3],"base64")),decipher.final()]).toString("utf8"));
    if (value.format !== 1 || !["to","subject","text"].every(k => typeof value[k] === "string") || value.html !== undefined && typeof value.html !== "string" || value.replyTo !== undefined && typeof value.replyTo !== "string" || value.bcc !== undefined && (!Array.isArray(value.bcc) || !value.bcc.every((s: unknown) => typeof s === "string"))) throw new Error();
    const attachments = value.attachments === undefined ? undefined : value.attachments.map((a: any) => {
      if (typeof a.filename !== "string" || typeof a.base64 !== "string" || a.contentType !== undefined && typeof a.contentType !== "string") throw new Error();
      const content = Buffer.from(a.base64,"base64");if (content.toString("base64") !== a.base64) throw new Error();
      return {filename:a.filename,contentType:a.contentType,content};
    });
    return {to:value.to,bcc:value.bcc,replyTo:value.replyTo,subject:value.subject,text:value.text,html:value.html,attachments};
  } catch { throw new Error("archive_invalid"); }
}
