"use client";
/** OFF admin insertion draft. Not imported by the existing President/history page. */
import { useEffect, useRef, useState } from "react";
import { postPresidentIssue, presidentChallengeLink, type IssuedChallengeView } from "../../site/src/lib/president-confirmation-view";
export type IssueDraftCopy = { generate: string; generateNew: string; link: string; password: string; expires: string; copyLink: string; copyPassword: string; rejected: string; uncertain: string };
export default function PresidentIssueDraft({ batchId, origin, transport, copy }: { batchId: number; origin: string; transport: typeof fetch; copy: IssueDraftCopy }) {
  const [issued, setIssued] = useState<IssuedChallengeView | null>(null), [phase, setPhase] = useState<"idle" | "writing" | "issued" | "rejected" | "uncertain">("idle");
  const mounted = useRef(true), mutation = useRef(false), generation = useRef(0), currentBatch = useRef(batchId);
  const linkInput = useRef<HTMLInputElement | null>(null), passwordInput = useRef<HTMLInputElement | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  useEffect(() => { if (currentBatch.current !== batchId) { currentBatch.current = batchId; generation.current++; mutation.current = false; setIssued(null); setPhase("idle"); } }, [batchId]);
  const generate = async () => {
    if (mutation.current) return;
    mutation.current = true; setPhase("writing"); setIssued(null); const revision = ++generation.current;
    try {
      const result = await postPresidentIssue(batchId, transport);
      if (!mounted.current || generation.current !== revision) return;
      if (result.kind === "issued" && presidentChallengeLink(origin, result.value.token)) { setIssued(result.value); setPhase("issued"); }
      else setPhase(result.kind === "rejected" ? "rejected" : "uncertain");
    } finally { if (mounted.current && generation.current === revision) mutation.current = false; }
  };
  const copyValue = async (value: string, input: HTMLInputElement | null) => {
    try { await navigator.clipboard.writeText(value); } catch { input?.focus(); input?.select(); }
  };
  const link = issued && presidentChallengeLink(origin, issued.token);
  return <section className="box" aria-busy={phase === "writing"}>
    <button className="v2-btn v2-btn-sec" type="button" onClick={() => void generate()} disabled={phase === "writing"}>{phase === "idle" || phase === "rejected" ? copy.generate : copy.generateNew}</button>
    {phase === "rejected" && <p role="alert" className="err">{copy.rejected}</p>}
    {phase === "uncertain" && <p role="alert">{copy.uncertain}</p>}
    {issued && link && <>
      <label>{copy.link}<input className="adm-inp" ref={linkInput} readOnly value={link} autoComplete="off" /></label>
      <button className="v2-btn v2-btn-sec" type="button" onClick={() => void copyValue(link, linkInput.current)}>{copy.copyLink}</button>
      <label>{copy.password}<input className="adm-inp" ref={passwordInput} readOnly value={issued.password} autoComplete="off" /></label>
      <button className="v2-btn v2-btn-sec" type="button" onClick={() => void copyValue(issued.password, passwordInput.current)}>{copy.copyPassword}</button>
      <p>{copy.expires}: <time dateTime={new Date(issued.expiresAt).toISOString()}>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(issued.expiresAt)}</time></p>
    </>}
  </section>;
}
