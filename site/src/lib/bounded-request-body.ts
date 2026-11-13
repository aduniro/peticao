/** Bound bytes actually received, including chunked bodies without Content-Length. */
export class RequestBodyTooLarge extends Error {}
export async function boundedRequestJson(request: Request, limit: number): Promise<any> {
  if (Number(request.headers.get("content-length") ?? 0) > limit) throw new RequestBodyTooLarge();
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("missing_body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new RequestBodyTooLarge();
      }
      chunks.push(item.value);
    }
    return JSON.parse(Buffer.concat(chunks, length).toString("utf8"));
  } finally { reader.releaseLock(); }
}
