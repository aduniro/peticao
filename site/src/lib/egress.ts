import http from "node:http";

/**
 * Cliente da PONTE DE SAÍDA. A pré-visualização roda num sandbox SEM rede; um processo fora dele (tools/preview/egress-bridge.mjs)
 * atende só dois pedidos fixos por um socket Unix: GET /cpf/<11 dígitos> e GET /domain/<nome>. A chave da CPF Brasil fica fora do sandbox.
 */
export const egressSocket = (): string | null => process.env.EGRESS_SOCKET?.trim() || null;

export function egressGet(path: string, timeoutMs = 12_000): Promise<{ status: number; body: string }> {
  const socketPath = egressSocket();
  return new Promise((resolve, reject) => {
    if (!socketPath) return reject(new Error("sem ponte de saída"));
    const req = http.request({ socketPath, path, method: "GET", timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = []; let n = 0;
      res.on("data", (c: Buffer) => { n += c.length; if (n <= 64_000) chunks.push(c); });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}
