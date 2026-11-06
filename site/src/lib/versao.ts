import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Versão implantada: o arquivo VERSAO (gravado pelo atualizador do stage) na raiz do site; sem ele, "desconhecida". */
export function versaoImplantada(): { versao: string; fonte: string } {
  for (const f of [join(process.cwd(), "VERSAO"), join(process.cwd(), "..", "VERSAO")]) {
    try { if (existsSync(f)) { const t = readFileSync(f, "utf8").trim().slice(0, 200); if (t) return { versao: t, fonte: "VERSAO" }; } } catch { /* segue */ }
  }
  return { versao: "desconhecida", fonte: "-" };
}
