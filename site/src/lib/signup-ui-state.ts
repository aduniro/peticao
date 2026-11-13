/** UI-only helpers. They do not validate identity or authorize a submission. */
export function safeConfirmationPanel(value: unknown): string | null {
  return typeof value === "string" && /^\/meu\/[A-Za-z0-9_-]+$/.test(value) ? value : null;
}

export function preservesCommonSignupFields(from: string, to: string, requested: boolean): boolean {
  return requested && from === "apoiador" && to === "servidor";
}
