import { resolveDocumentReference } from "./document-reference-store";
import { publicDocumentVerification } from "./document-verification";

/** Opaque reference lookup never bypasses release, approval, exact bytes or current version checks. */
export async function publicDocumentReference(referenceId:string) {
 try {
  const bound=await resolveDocumentReference(referenceId);
  return bound ? await publicDocumentVerification(bound.versionId,bound.sha256) : {ok:false as const};
 } catch { return {ok:false as const}; }
}
