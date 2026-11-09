/** Shared browser/server format contract; absent legacy format always means literal text. */
export const RICH_FORMATS = ["texto", "markdown", "html"] as const;
export type RichFormat = typeof RICH_FORMATS[number];
export const isRichFormat = (value: unknown): value is RichFormat => typeof value === "string" && (RICH_FORMATS as readonly string[]).includes(value);
