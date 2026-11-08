import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

/** Divide uma linha CSV com separador `sep` respeitando aspas duplas. */
export function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === sep) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** Lê linhas de um arquivo grande em streaming. `latin1` para os CSV da Receita (ISO-8859-1). */
export async function* readLines(path: string, encoding: BufferEncoding = "utf8"): AsyncGenerator<string> {
  const rl = createInterface({ input: createReadStream(path, { encoding }), crlfDelay: Infinity });
  for await (const l of rl) if (l.length) yield l;
}
