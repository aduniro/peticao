/** Fixed deployment identity, never selected from a request or an SQL identifier. */
export type MailQueueScope = "legacy" | "v2";

export function mailQueueScope(): MailQueueScope {
  const scope = process.env.MAIL_QUEUE_SCOPE ?? "legacy";
  if (scope !== "legacy" && scope !== "v2") throw new Error("invalid_mail_queue_scope");
  if (process.env.PETICAO_RUNTIME === "admin-v2" && scope !== "v2") {
    throw new Error("admin_v2_requires_isolated_mail_queue");
  }
  return scope;
}

export function mailQueueTable(): "mail_outbox" | "mail_outbox_v2" {
  return mailQueueScope() === "v2" ? "mail_outbox_v2" : "mail_outbox";
}

/** Keep existing legacy identities stable; equal IDs in the new queue are distinct. */
export function queuedMessageKey(id: number): string {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("invalid_queue_id");
  return mailQueueScope() === "v2" ? `outbox:v2:${id}` : `outbox:${id}`;
}
