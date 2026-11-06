export function isPublicIp(ip: string): boolean;
export function isValidHostname(h: string): boolean;
export function academicEvidence(host: string, title?: string, desc?: string): { tld: boolean; words: boolean; ok: boolean };
export type ProbeResult = { ok: boolean; reason: "ok" | "invalid" | "no_dns" | "private_ip" | "network" | "no_mail" | "no_site" | "not_academic"; evidence?: { tld: boolean; words: boolean; title: string } };
export function probeDomain(domain: string, opts?: { resolver?: any; fetchOnce?: (host: string, path: string, addr: { address: string; family: number }, o: { timeoutMs: number; maxBytes: number }) => Promise<{ status: number; location?: string; body?: string }>; timeoutMs?: number; maxBytes?: number }): Promise<ProbeResult>;
