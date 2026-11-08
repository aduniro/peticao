import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Versão do site = id da build (muda a cada `npm run build`). Usada para reexibir o tour após uma atualização. */
let cached: string | null = null;
export function siteVersion(): string {
  if (cached) return cached;
  for (const d of [".next", ".next-dev"]) {
    try { cached = readFileSync(join(process.cwd(), d, "BUILD_ID"), "utf8").trim(); if (cached) return cached; } catch { /* tenta o próximo */ }
  }
  return (cached = process.env.npm_package_version ?? "dev");
}
