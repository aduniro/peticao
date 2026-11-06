import type { ReactNode } from "react";

/** Bloco que expande/recolhe (seta à direita), com `<details>` nativo: funciona com teclado e leitor de tela. `resumo` é a linha sempre visível. */
export default function Expansor({ resumo, children, aberto = false, onToggle }: { resumo: ReactNode; children: ReactNode; aberto?: boolean; onToggle?: (aberto: boolean) => void }) {
  return (
    <details className="v2-expansor" open={aberto} onToggle={onToggle ? (e) => onToggle((e.currentTarget as HTMLDetailsElement).open) : undefined}>
      <summary>{resumo}</summary>
      <div className="v2-expansor-corpo">{children}</div>
    </details>
  );
}
