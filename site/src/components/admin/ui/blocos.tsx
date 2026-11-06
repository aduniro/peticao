import type { ReactNode } from "react";

/** Blocos básicos do visual v2 (classes em app/admin/v2.css). Mantêm todas as telas do painel com a mesma aparência. */
export const Secao = ({ titulo, sub, children }: { titulo?: string; sub?: string; children: ReactNode }) => (
  <section className="v2-secao">{titulo ? <h2 className="v2-h2">{titulo}</h2> : null}{sub ? <p className="v2-sub">{sub}</p> : null}{children}</section>
);
export const Cartao = ({ titulo, children }: { titulo?: string; children: ReactNode }) => (
  <div className="v2-cartao">{titulo ? <h3>{titulo}</h3> : null}{children}</div>
);
/** Tabela com rolagem lateral (o padrão da tabela da visão geral). */
export const Tabela = ({ colunas, children, vazio }: { colunas: string[]; children: ReactNode; vazio?: string }) => (
  <div className="table-scroll"><table><thead><tr>{colunas.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{children}{vazio ? <tr><td colSpan={colunas.length}>{vazio}</td></tr> : null}</tbody></table></div>
);
export const Aviso = ({ tipo = "ok", children }: { tipo?: "ok" | "erro" | "aten"; children: ReactNode }) => (
  <p className={`v2-aviso${tipo === "ok" ? "" : " " + tipo}`} role={tipo === "erro" ? "alert" : "status"}>{children}</p>
);
