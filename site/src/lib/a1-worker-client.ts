import { createConnection } from "node:net";
import { createA1WorkerRequest, parseA1WorkerResponse, A1_MAX_PDF_BYTES, type A1WorkerBinding } from "./a1-worker-contract";

const DEFAULT_SOCKET = "/run/peticao-signing/worker.sock";
const MAX_RESPONSE = Math.ceil(A1_MAX_PDF_BYTES / 3) * 4 + 16_384;
const DEFAULT_TIMEOUT_MS = 65_000;
export type A1WorkerClientResult = ReturnType<typeof parseA1WorkerResponse>;
/** Trusted server configuration only; never derive this environment variable from HTTP input. */
function configuredSocket() {
  const value = process.env.A1_WORKER_SOCKET ?? DEFAULT_SOCKET;
  if (!value.startsWith("/") || Buffer.byteLength(value) > 100 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}

/** Single attempt. Signing and approval remain distinct; transport failures never retry automatically. */
export async function requestA1Worker(binding: A1WorkerBinding, original: Buffer): Promise<A1WorkerClientResult> {
  const unavailable = { ok: false as const, error: "a1_worker_unavailable" as const };
  const socketPath = configuredSocket();
  const timeout = process.env.A1_WORKER_TIMEOUT_MS === undefined ? DEFAULT_TIMEOUT_MS : Number(process.env.A1_WORKER_TIMEOUT_MS);
  if (!socketPath || !Number.isInteger(timeout) || timeout < 100 || timeout > DEFAULT_TIMEOUT_MS) return unavailable;
  let body: Buffer;
  try { body = Buffer.from(JSON.stringify(createA1WorkerRequest(binding, original))); }
  catch { return unavailable; }
  return new Promise(resolve => {
    let settled = false, expected: number | null = null;
    let header = Buffer.alloc(0), chunks: Buffer[] = [], received = 0;
    const socket = createConnection({ path: socketPath });
    const finish = (result: A1WorkerClientResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      chunks = [];
      resolve(result);
    };
    const timer = setTimeout(() => finish(unavailable), timeout);
    socket.on("error", () => finish(unavailable));
    socket.on("end", () => { if (!settled) finish(unavailable); });
    socket.on("close", () => { if (!settled) finish(unavailable); });
    socket.on("connect", () => {
      const prefix = Buffer.alloc(4); prefix.writeUInt32BE(body.length);
      socket.write(prefix); socket.write(body);
    });
    socket.on("data", (incoming: Buffer) => {
      if (settled) return;
      let data = incoming;
      if (expected === null) {
        const needed = 4 - header.length;
        header = Buffer.concat([header, data.subarray(0, needed)]);
        data = data.subarray(Math.min(needed, data.length));
        if (header.length !== 4) return;
        expected = header.readUInt32BE(0);
        if (expected === 0 || expected > MAX_RESPONSE) { finish(unavailable); return; }
      }
      received += data.length;
      if (received > expected) { finish(unavailable); return; }
      chunks.push(data);
      if (received === expected) {
        const raw = Buffer.concat(chunks, received).toString("utf8");
        finish(parseA1WorkerResponse(raw, binding, original));
      }
    });
  });
}
