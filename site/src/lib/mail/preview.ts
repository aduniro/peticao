import { audit } from "../db";
import { archivedContent, messageMetadata } from "./archive";
import { validMessageId } from "./archive-codec";
import { renderMailPreview } from "./preview-render";
/** Authorization belongs to the HTTP caller; only masked, transformed content can leave this helper. */
export async function mailPreview(id: unknown, actor: { email: string; userId: number }) {
  if (!validMessageId(id)) return { ok: false as const, error: "parameters" };
  const meta = await messageMetadata(id);
  if (!meta) return { ok: false as const, error: "not_found" };
  // Account challenges/reset/invites must not turn the admin archive into an authentication bypass.
  if (/^admin|senha|password|stepup|otp|redefinir|reset|convite/i.test(meta.kind)) return { ok: true as const, state: "restricted" as const };
  const content = await archivedContent(id);
  if (content.state !== "stored") return { ok: true as const, state: content.state };
  const preview = renderMailPreview(content.mail);
  await audit("mail_message_preview", null, { messageId: id, por: actor.email, userId: actor.userId, state: preview.state });
  return { ok: true as const, ...preview };
}
