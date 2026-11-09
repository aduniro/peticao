/** OFF draft only; public endpoints remain owned by the server integrator. */
import { loadPresidentPdf, readPresidentAccess } from "../../site/src/lib/president-confirmation-access";
import type { ReceiptView } from "./PresidentConfirmationDraft";
export function presidentDraftAdapters(transport: typeof fetch) {
  return {
    readDocument: (credentials: { token: string; password: string }) => loadPresidentPdf(credentials, transport),
    readState: async (credentials: { token: string; password: string }): Promise<ReceiptView> => {
      const access = await readPresidentAccess(credentials, transport);
      if (access.kind !== "available") return access;
      const view = access.value;
      if (view.state === "consumed" && view.receipt) return { kind: "confirmed", documentVersion: view.document.documentVersion, receiptId: view.receipt.receiptId };
      return { kind: view.state === "issued" ? "pending" : "verifying", documentVersion: view.document.documentVersion, canConfirm: view.canConfirm };
    },
  };
}
