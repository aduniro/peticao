import type { PoolClient } from "pg";
import { batchEnvelope, batchMessageKey, documentVersion, type ApprovalRow } from "./batches";
import { readFrozenBatchPackageTx } from "./batch-package-store";
import { batchPackageMessageKey } from "./batch-package-contract";
import { createHash } from "node:crypto";
import { hmac } from "./security";

export type DeliveryBinding = { deliveryVersion: 2; packageId: string; packageDigest: string };
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);

/** Internal, authorized transaction only. Historic approvals always resolve their own exact format. */
export async function resolveBatchDeliveryTx(client: PoolClient, row: ApprovalRow, stored: unknown = {}) {
  if (!stored || typeof stored !== "object" || Array.isArray(stored) || !row.pdf) return null;
  const value = stored as Record<string, unknown>, pdf = row.signed_pdf ?? row.pdf;
  const sentSha = createHash("sha256").update(pdf).digest("hex"), version = documentVersion(row);
  if (sentSha !== (row.signed_pdf ? row.signed_pdf_sha256 : row.pdf_sha256)) return null;
  if (value.deliveryVersion === undefined && value.packageId === undefined && value.packageDigest === undefined) {
    return { binding: null, sentSha, version, message: (to: string) => ({ key: batchMessageKey(row.id, sentSha, to), envelope: batchEnvelope(row, to, Buffer.from(pdf), sentSha) }) };
  }
  // A partial or invalid v2 descriptor can NEVER fall back to the legacy one-PDF envelope.
  if (value.deliveryVersion !== 2 || !uuid(value.packageId) || typeof value.packageDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.packageDigest)) return null;
  const packet = await readFrozenBatchPackageTx(client, value.packageId);
  if (!packet.ok || packet.package.batchId !== row.id || packet.package.documentVersion !== version || packet.package.packageDigest !== value.packageDigest || packet.package.batchSha256 !== sentSha || row.signature_kind !== "icp-brasil") return null;
  const binding: DeliveryBinding = { deliveryVersion: 2, packageId: value.packageId, packageDigest: value.packageDigest };
  return { binding, sentSha, version, message: (to: string) => ({
    key: batchPackageMessageKey(row.id, binding.packageDigest, hmac(to)),
    envelope: { ...batchEnvelope(row, to, Buffer.from(pdf), sentSha), attachments: packet.manifest.attachments.map(item => ({ filename: item.filename, content: Buffer.from(packet.bytes.get(item.versionId)!), contentType: item.contentType })) },
  }) };
}

/** New approval must bind the latest frozen package, not infer a base from current settings. */
export async function pendingBatchDeliveryTx(client: PoolClient, row: ApprovalRow) {
  const latest = (await client.query<{ id: string; package_digest: string; selection_id: string }>("SELECT id,package_digest,selection_id FROM batch_packages WHERE batch_id=$1 AND document_version=$2 ORDER BY ordinal DESC LIMIT 1", [row.id, documentVersion(row)])).rows[0];
  if (latest) {
    const selected = (await client.query<{ id: string }>("SELECT id FROM petition_base_selections ORDER BY revision DESC LIMIT 1")).rows[0];
    if (selected?.id !== latest.selection_id) return null;
    return resolveBatchDeliveryTx(client, row, { deliveryVersion: 2, packageId: latest.id, packageDigest: latest.package_digest });
  }
  // Once packet mode is enabled, an absent packet must not silently dispatch only one attachment.
  if (process.env.BATCH_PACKAGE_ENABLED === "1" || (await client.query("SELECT 1 FROM batch_packages WHERE batch_id=$1 LIMIT 1", [row.id])).rowCount) return null;
  return resolveBatchDeliveryTx(client, row);
}
