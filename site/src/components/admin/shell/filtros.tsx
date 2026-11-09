"use client";
import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Ponte entre as páginas e o botão de filtros do celular (canto inferior esquerdo da barra). */
export type FiltrosCtx = { slot: HTMLElement | null; registrar: (delta: number) => void };
export const FiltrosContexto = createContext<FiltrosCtx | null>(null);

const MQ = "(max-width: 992px)";
const assinar = (cb: () => void) => { const m = window.matchMedia(MQ); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); };
/** Tela de celular/tablet (≤992px). No servidor devolve false (a página nasce com os filtros no lugar de sempre). */
export const useEhMobile = () => useSyncExternalStore(assinar, () => window.matchMedia(MQ).matches, () => false);

/**
 * Envolve os controles de filtro de uma página. No computador eles ficam onde estão; no celular vão para a folha que o botão
 * "Filtros" (canto inferior esquerdo) abre. O estado continua na página (só o lugar na tela muda). Sem o Shell (ex.: testes), renderiza no lugar.
 */
export function FiltrosShell({ children }: { children: ReactNode }) {
  const c = useContext(FiltrosContexto), mobile = useEhMobile();
  const registrar = c?.registrar;
  useEffect(() => { if (!registrar) return; registrar(1); return () => registrar(-1); }, [registrar]);
  if (c && mobile && c.slot) return createPortal(children, c.slot);
  return <>{children}</>;
}
