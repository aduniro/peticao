"use client";
import { useEffect, useRef, useState } from "react";

const ERROS: Record<string, string> = { desligado: "O Terminal foi desligado (o tempo acabou).", ocupado: "Já há um comando em execução. Aguarde.", servico_fora: "O serviço do Terminal não respondeu.", recusado: "O serviço recusou o comando.", nao_configurado: "Serviço não instalado.", comando_invalido: "Comando inválido (até 2000 caracteres).", stepup: "Confirmação extra vencida." };

/** Console simples: um comando por vez, saída em fluxo. Sem terminal interativo (nada de editor ou senha). */
export default function Terminal({ ate }: { ate: string }) {
  const [linha, setLinha] = useState(""), [saida, setSaida] = useState(""), [ocupado, setOcupado] = useState(false), [historico, setHistorico] = useState<string[]>([]);
  const fim = useRef<HTMLPreElement>(null);
  useEffect(() => { fim.current?.scrollTo(0, fim.current.scrollHeight); }, [saida]);
  const hora = new Date(ate).toLocaleTimeString("pt-BR");
  const rodar = async (e: React.FormEvent) => {
    e.preventDefault();
    const comando = linha.trim(); if (!comando || ocupado) return;
    setOcupado(true); setHistorico((h) => [comando, ...h].slice(0, 30)); setLinha(""); setSaida((s) => `${s}$ ${comando}\n`);
    try {
      const r = await fetch("/api/admin/terminal", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ comando }) });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        if (r.status === 403 && j.erro === "stepup") { window.location.assign("/admin/confirmar?volta=/admin/terminal"); return; }
        setSaida((s) => `${s}[${ERROS[j.erro] ?? "falhou"}]\n`); return;
      }
      const leitor = r.body!.getReader(), dec = new TextDecoder();
      for (;;) { const { done, value } = await leitor.read(); if (done) break; setSaida((s) => s + dec.decode(value, { stream: true })); }
    } catch { setSaida((s) => `${s}[falha de rede]\n`); } finally { setOcupado(false); }
  };
  return (
    <div>
      <p className="small">Ligado até {hora}. Um comando por vez; limite de 60 s e 200 KB de saída.</p>
      <pre ref={fim} aria-live="polite" style={{ background: "#0b1410", color: "#d7efe2", padding: 12, borderRadius: 8, minHeight: 280, maxHeight: 520, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{saida || "Pronto. Digite um comando abaixo.\n"}</pre>
      <form onSubmit={rodar} style={{ display: "flex", gap: 8 }}>
        <input value={linha} onChange={(e) => setLinha(e.target.value)} onKeyDown={(e) => { if (e.key === "ArrowUp" && historico[0] && !linha) setLinha(historico[0]); }} maxLength={2000} autoComplete="off" spellCheck={false} aria-label="Comando" style={{ flex: 1, fontFamily: "monospace" }} placeholder="comando" />
        <button disabled={ocupado || !linha.trim()}>{ocupado ? "Executando…" : "Executar"}</button>
      </form>
    </div>
  );
}
