"use client";

import { useEffect, useState } from "react";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export default function CriarIndicacao({ scope, initialRequestId, completedRequestId }: { scope: string; initialRequestId: string; completedRequestId?: string }) {
  const [label, setLabel] = useState("");
  const [requestId, setRequestId] = useState(initialRequestId);
  const key = `admin-referral:${scope}`;
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? "null");
      if (!saved || !UUID.test(saved.requestId) || typeof saved.label !== "string") return;
      if (saved.requestId === completedRequestId) { sessionStorage.removeItem(key); return; }
      setLabel(saved.label); setRequestId(saved.requestId);
    } catch { /* Native history still preserves the submitted form when storage is unavailable. */ }
  }, [key, completedRequestId]);
  return <form method="post" action="/api/admin/indicacoes" style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "12px 0" }} onSubmit={() => {
    // Keep the same intent across a failed response, browser Back and explicit retries.
    try { sessionStorage.setItem(key, JSON.stringify({ label, requestId })); } catch { /* Hidden intent still protects POST replays. */ }
  }}>
    <input type="hidden" name="requestId" value={requestId} />
    <input name="label" placeholder="Código da organização (ex.: Sindicato X, Grupo Y)" size={42} required value={label} onChange={event => {
      if (event.target.value.trim().slice(0, 80) !== label.trim().slice(0, 80)) setRequestId(crypto.randomUUID());
      setLabel(event.target.value);
    }} /><button>Criar código</button>
  </form>;
}
