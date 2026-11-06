import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const achar = (nome: string) => [join(process.cwd(), nome), join(process.cwd(), "..", nome)].find((f) => { try { return existsSync(f); } catch { return false; } });
const ler = (nome: string, max: number) => { const f = achar(nome); if (!f) return ""; try { return readFileSync(f, "utf8").slice(0, max).trim(); } catch { return ""; } };

/**
 * Versão implantada: o arquivo VERSAO (gravado pelo atualizador do stage) na raiz do site, e MUDANCAS (as últimas alterações incluídas, uma por linha,
 * gravadas junto). Sem eles, "desconhecida" e lista vazia.
 */
export function versaoImplantada(): { versao: string; fonte: string; mudancas: string[] } {
  const v = ler("VERSAO", 200).split("\n")[0] ?? "";
  const mudancas = ler("MUDANCAS", 6000).split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 25);
  return v ? { versao: v, fonte: "VERSAO", mudancas } : { versao: "desconhecida", fonte: "-", mudancas };
}
