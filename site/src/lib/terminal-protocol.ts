/** The service encodes command output as data, so it cannot forge an exit frame. */
export type TerminalResult = {
  estado: "concluido" | "falhou" | "recusado" | "indeterminado";
  code: number | null;
  signal: string | null;
  timedOut: boolean;
  truncated: boolean;
  spawnError: boolean;
  bytes: number;
  reason?: "network" | "protocol" | "cancelled" | "unavailable" | "busy" | "rejected";
};
export const unknownTerminalResult = (reason: TerminalResult["reason"], bytes = 0): TerminalResult => ({ estado: "indeterminado", code: null, signal: null, timedOut: false, truncated: false, spawnError: false, bytes, reason });
const MAX_BYTES = 220_000, MAX_LINE = 300_000;

export function forwardTerminalOutput(response: Response, finish: (result: TerminalResult) => Promise<void>, verify: (frame: Record<string, unknown>) => boolean): ReadableStream<Uint8Array> {
  if (!response.body || response.headers.get("content-type")?.split(";")[0] !== "application/x-ndjson") throw new Error("terminal_protocol");
  const reader = response.body.getReader();
  let cancelled = false, bytes = 0, finishing: Promise<void> | null = null;
  const complete = (result: TerminalResult) => finishing ??= finish(result);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        let buffer = "", result: TerminalResult | null = null, protocolError = false;
        const decoder = new TextDecoder();
        const invalid = (): never => { protocolError = true; throw new Error("terminal_protocol"); };
        const frame = (line: string) => {
          if (!line.trim()) return;
          if (line.length > MAX_LINE || result) invalid();
          let value: any;
          try { value = JSON.parse(line); } catch { invalid(); }
          if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
          if (value.type === "output") {
            if (typeof value.data !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data)) invalid();
            const data = Buffer.from(value.data, "base64"); bytes += data.length;
            if (bytes > MAX_BYTES) invalid();
            if (!cancelled) controller.enqueue(new Uint8Array(data));
          } else if (value.type === "result") {
            if (value.code !== null && (!Number.isInteger(value.code) || value.code < 0 || value.code > 255)) invalid();
            if (value.signal !== null && (typeof value.signal !== "string" || !/^SIG[A-Z0-9]{1,16}$/.test(value.signal))) invalid();
            if (["timedOut", "truncated", "spawnError"].some(key => typeof value[key] !== "boolean") || value.bytes !== bytes) invalid();
            if (value.code !== null && value.signal !== null || value.code === null && value.signal === null && !value.spawnError) invalid();
            if (!verify(value)) invalid();
            const ok = value.code === 0 && !value.timedOut && !value.truncated && !value.spawnError;
            result = { estado: ok ? "concluido" : "falhou", code: value.code, signal: value.signal, timedOut: value.timedOut, truncated: value.truncated, spawnError: value.spawnError, bytes };
          } else invalid();
        };
        try {
          for (;;) {
            const next = await reader.read(); if (next.done) break;
            buffer += decoder.decode(next.value, { stream: true });
            for (let split; (split = buffer.indexOf("\n")) >= 0;) { frame(buffer.slice(0, split)); buffer = buffer.slice(split + 1); }
            if (buffer.length > MAX_LINE) invalid();
          }
          buffer += decoder.decode();
          if (cancelled) await complete(unknownTerminalResult("cancelled", bytes));
          else {
            if (buffer.trim() || !result) invalid();
            await complete(result!); controller.close();
          }
        } catch {
          await complete(unknownTerminalResult(cancelled ? "cancelled" : protocolError ? "protocol" : "network", bytes)).catch(() => {});
          if (!cancelled) controller.error(new Error("terminal_stream_incomplete"));
          await reader.cancel().catch(() => {});
        } finally { try { reader.releaseLock(); } catch { /* Reader was cancelled. */ } }
      })();
    },
    async cancel() {
      cancelled = true;
      await reader.cancel().catch(() => {});
      await complete(unknownTerminalResult("cancelled", bytes)).catch(() => {});
    },
  });
}
