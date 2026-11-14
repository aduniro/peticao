const hits = new Map<string, number[]>();

/** Remove somente a janela indicada; não afeta os demais limites. */
export function clearRateLimit(key: string): void {
  hits.delete(key);
}

/** Limite simples em memória (suficiente para uma instância; trocar por Redis/edge se escalar). */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    hits.set(key, arr);
    return false;
  }
  arr.push(now);
  hits.set(key, arr);
  return true;
}
