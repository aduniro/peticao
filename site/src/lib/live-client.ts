"use client";
import { useEffect, useState } from "react";
import type { FeedItem } from "./public-feed";
import type { Counts } from "./signatures";

export type LiveData = { counts: Counts; items: FeedItem[] };

/** Uma única consulta periódica compartilhada por todos os componentes da página (contadores, lista e barra superior). */
let current: LiveData | null = null;
const subs = new Set<(d: LiveData) => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let delay = 8000;

async function tick() {
  timer = null;
  if (subs.size === 0) return;
  if (document.visibilityState === "visible") {
    try {
      const r = await fetch("/api/ultimas", { cache: "no-store" });
      if (r.ok) { current = (await r.json()) as LiveData; subs.forEach((f) => f(current!)); delay = 8000; }
      else delay = Math.min(delay * 2, 60_000);
    } catch { delay = Math.min(delay * 2, 60_000); }
  }
  if (subs.size) timer = setTimeout(tick, delay);
}

export function useLive(initial: LiveData): LiveData {
  const [data, setData] = useState<LiveData>(current ?? initial);
  useEffect(() => {
    subs.add(setData);
    if (!timer) timer = setTimeout(tick, 3000);
    const vis = () => { if (document.visibilityState === "visible" && subs.size) { if (timer) clearTimeout(timer); timer = setTimeout(tick, 500); } };
    document.addEventListener("visibilitychange", vis);
    return () => { subs.delete(setData); document.removeEventListener("visibilitychange", vis); if (subs.size === 0 && timer) { clearTimeout(timer); timer = null; } };
  }, []);
  return data;
}
