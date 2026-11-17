import type { MaterialContent, MaterialMutation, MaterialVersion } from "./materials-contract";
import { parseMaterialsContent, parseMaterialsVersion, type MaterialsState, MaterialsClient, type MaterialsContext, type MaterialsTransport, type MaterialsResult } from "./materials-client";

/** Draft UI only: partial fields stay local and never replace the client's valid content. */
export type MaterialUiDraft = { template: MaterialContent["template"]; assetKey: MaterialContent["assetKey"]; title: string; body: string; callToAction: string; footer: string };
export const emptyMaterialUiDraft = (): MaterialUiDraft => ({ template: "poster-a4-v1", assetKey: "adunir", title: "", body: "", callToAction: "", footer: "" });
export const materialUiBusy = (state: MaterialsState | null) => !state || ["saving", "recovering"].includes(state.phase);
export const materialUiDirty = (draft: MaterialUiDraft, state: MaterialsState | null) => JSON.stringify(draft) !== JSON.stringify((state?.phase === "confirmed" ? state.receipt?.version.content : null) ?? state?.draftBase?.content ?? emptyMaterialUiDraft());
export const materialUiCanSwitch = (draft: MaterialUiDraft, state: MaterialsState | null) => !!state && !materialUiBusy(state) && !state.pending && !materialUiDirty(draft, state);
export function materialUiIntent(operation: "create" | "revise" | "archive", requestId: string, state: MaterialsState, draft: MaterialUiDraft): MaterialMutation | null {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(requestId) || materialUiBusy(state) || state.pending || state.needsReview) return null;
  const content = parseMaterialsContent(draft), head = state.head;
  if (operation === "create") return state.context.materialId === null && !head && content ? { operation, requestId, content } : null;
  if (!head || head.archived || head.materialId !== state.context.materialId || state.draftBase?.revision !== head.revision) return null;
  if (operation === "archive") return { operation, requestId, materialId: head.materialId, expectedRevision: head.revision };
  return content ? { operation, requestId, materialId: head.materialId, expectedRevision: head.revision, content } : null;
}
export function materialPreviewUrl(raw: unknown): string | null {
  const version = parseMaterialsVersion(raw); if (!version) return null;
  return `/api/admin/materiais/${version.materialId}/previa?versionId=${version.id}&revision=${version.revision}`;
}
export type MaterialPreviewSelection = MaterialVersion;

/** Small lifecycle adapter: every mount owns a fresh client; no global subscription or persistence. */
export function createMaterialUiSession(context: MaterialsContext, publish: (state: MaterialsState) => void, transport?: MaterialsTransport) {
  let client = new MaterialsClient(context, transport), active = true, epoch = 0;
  const refresh = () => { if (active) publish(client.getState()); };
  return {
    get client() { return client; }, refresh,
    newDraft(): boolean {
      if (!active || materialUiBusy(client.getState()) || client.getState().pending) return false;
      const previous = client, next = { ...previous.getState().context, materialId: null };
      epoch++; previous.dispose(); client = new MaterialsClient(next, transport); refresh(); return true;
    },
    setContext(next: MaterialsContext): boolean { if (!active) return false; const changed = JSON.stringify(client.getState().context) !== JSON.stringify(next); const ok = client.setContext(next); if (ok && changed) epoch++; refresh(); return ok; },
    async run<T>(operation: (value: MaterialsClient) => Promise<MaterialsResult<T>>): Promise<MaterialsResult<T> | null> {
      if (!active) return null; const started = epoch;
      const owned = client, task = operation(owned); refresh(); const result = await task;
      if (!active || epoch !== started || client !== owned) return null; refresh(); return result;
    },
    dispose() { active = false; epoch++; client.dispose(); },
  };
}
export type MaterialUiSession = ReturnType<typeof createMaterialUiSession>;
