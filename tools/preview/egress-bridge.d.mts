import type { IncomingMessage, ServerResponse } from "node:http";
export function createBridge(o?: {
  getKey?: () => string | null;
  upstream?: (cpf: string, key: string) => Promise<{ status: number; body: string }>;
  probe?: (domain: string) => Promise<unknown>;
  now?: () => number;
  cpfPerMinute?: number;
  domainPerMinute?: number;
}): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
