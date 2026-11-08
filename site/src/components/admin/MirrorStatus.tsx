"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MIRROR_REVISION_EVENT } from "./useMirrorRevision";

export default function MirrorStatus() {
  const router = useRouter();
  const revision = useRef<string | null>(null);
  const [at, setAt] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let disposed = false, busy = false;
    const controller = new AbortController();
    async function poll() {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      try {
        const response = await fetch("/api/admin/espelho/estado", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("MIRROR_STATUS_UNAVAILABLE");
        const data = await response.json();
        if (typeof data.revision !== "string" || !Number.isFinite(Date.parse(data.syncedAt)) || !Number.isFinite(Date.parse(data.capturedAt))) throw new Error("MIRROR_STATUS_INVALID");
        if (!disposed) {
          setAt(data.capturedAt); setUnavailable(Date.now() - Math.min(Date.parse(data.syncedAt), Date.parse(data.capturedAt)) > 90_000);
          if (revision.current && revision.current !== data.revision) {
            window.dispatchEvent(new Event(MIRROR_REVISION_EVENT));
            router.refresh();
          }
          revision.current = data.revision;
        }
      } catch { if (!disposed) setUnavailable(true); }
      finally { busy = false; }
    }
    void poll();
    const timer = setInterval(() => { void poll(); }, 5000);
    return () => { disposed = true; clearInterval(timer); controller.abort(); };
  }, [router]);
  return <span> · Última atualização: {at ? new Date(at).toLocaleString("pt-BR") : "—"}{unavailable ? " · Sincronização indisponível" : ""}</span>;
}
