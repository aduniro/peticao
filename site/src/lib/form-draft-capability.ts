/** Browser-only handle for deletion. Never put form fields in this storage. */
export const DRAFT_CAPABILITY_STORAGE_KEY = "peticao:form-draft:capability:v1";
export const DRAFT_CAPABILITY_DAYS = 30;
export type DraftCapability = { token: string; sequence: number; expiresAt: number };
export type DraftCapabilityStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function parseDraftCapability(raw: string | null, now = Date.now()): DraftCapability | null {
  try {
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!value || typeof value.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value.token)
      || !Number.isInteger(value.sequence) || value.sequence < 0 || value.sequence > 1_000_000
      || !Number.isInteger(value.expiresAt) || value.expiresAt <= now
      || value.expiresAt > now + DRAFT_CAPABILITY_DAYS * 86400_000 + 60_000) return null;
    return { token: value.token, sequence: value.sequence, expiresAt: value.expiresAt };
  } catch { return null; }
}

export function loadDraftCapability(storage: DraftCapabilityStorage | null, now = Date.now()): { capability: DraftCapability | null; available: boolean } {
  if (!storage) return { capability: null, available: false };
  try {
    const raw = storage.getItem(DRAFT_CAPABILITY_STORAGE_KEY);
    const capability = parseDraftCapability(raw, now);
    if (raw && !capability) storage.removeItem(DRAFT_CAPABILITY_STORAGE_KEY);
    return { capability, available: true };
  } catch { return { capability: null, available: false }; }
}

export function persistDraftCapability(storage: DraftCapabilityStorage | null, capability: DraftCapability): boolean {
  if (!storage) return false;
  try {
    // Construct the whitelist explicitly rather than serializing caller objects.
    storage.setItem(DRAFT_CAPABILITY_STORAGE_KEY, JSON.stringify({ token: capability.token, sequence: capability.sequence, expiresAt: capability.expiresAt }));
    return true;
  } catch { return false; }
}

export function removeDraftCapability(storage: DraftCapabilityStorage | null, token: string): boolean {
  if (!storage) return false;
  try {
    const raw = storage.getItem(DRAFT_CAPABILITY_STORAGE_KEY);
    if (!raw || JSON.parse(raw).token === token) storage.removeItem(DRAFT_CAPABILITY_STORAGE_KEY);
    return true;
  } catch { return false; }
}
