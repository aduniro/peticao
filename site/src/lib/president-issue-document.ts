import type { SessaoAdmin } from "./admin-users";
import { readPresidentIssueDocumentRevision } from "./president-portal-store";

/** Server-only projection: a stored digest alone cannot reconstruct documentVersion. */
export async function getPresidentIssueDocument(batchId: number, actor: SessaoAdmin) {
  const result = await readPresidentIssueDocumentRevision(batchId, actor);
  if (!result.ok) return result;
  return {
    ok: true as const,
    document: {
      batchId: result.document.batchId,
      seq: result.document.seq,
      kind: result.document.kind,
      documentVersion: result.document.documentVersion,
      originalSha256: result.document.originalSha256,
      signedSha256: result.document.signedSha256,
      listHash: result.document.listHash,
      signatureKind: result.document.signatureKind,
    },
  };
}
