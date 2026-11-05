"use client";
import { useEffect, useRef, useState } from "react";
import { HASHTAGS, campaignMessage, redeUrl, type Rede } from "@/content/compartilhar";

const NOME: Record<Rede, string> = { whatsapp: "WhatsApp", telegram: "Telegram", x: "X", facebook: "Facebook", instagram: "Instagram" };

/**
 * Compartilhar o cartaz pessoal com o texto e as hashtags.
 * Celular/navegador com o menu nativo: o botão entrega o ARQUIVO do cartaz e o texto juntos ao app escolhido (precisa do toque da pessoa).
 * Demais casos: abre a rede com o texto e o link pessoal (a pré-visualização do link é o cartaz). Instagram não aceita link: baixa o cartaz e copia o texto.
 */
export default function ShareLanding({ code, rede, link }: { code: string; rede: Rede; link: string }) {
  const file = useRef<File | null>(null);
  const [mode, setMode] = useState<"loading" | "native" | "copy">("loading");
  const [msg, setMsg] = useState("");
  const text = campaignMessage(link);
  const cartaz = `/api/cartaz/${code}.png`;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const b = await (await fetch(cartaz)).blob();
        file.current = new File([b], `cartaz-plv12.png`, { type: "image/png" });
      } catch { /* sem imagem: cai nos links */ }
      if (!alive) return;
      const f = file.current;
      if (f && typeof navigator.canShare === "function" && navigator.canShare({ files: [f] })) { setMode("native"); return; }
      if (rede === "instagram") { setMode("copy"); return; }
      window.location.replace(redeUrl(rede, link)); // computador: abre a rede direto, com texto e link (cartaz na pré-visualização)
    })();
    return () => { alive = false; };
  }, [cartaz, rede, link]);

  function native() {
    const f = file.current; if (!f) return;
    navigator.share({ files: [f], text, title: "PLV 12/2026" }).catch((e: unknown) => { if ((e as { name?: string })?.name !== "AbortError" && rede !== "instagram") window.location.href = redeUrl(rede, link); });
  }
  async function copyAndDownload() {
    try { await navigator.clipboard.writeText(text); setMsg("Texto copiado. O cartaz foi baixado: abra o Instagram e publique a imagem, colando o texto na legenda."); } catch { setMsg("Baixe o cartaz e copie o texto abaixo para a legenda."); }
    const a = document.createElement("a"); a.href = `${cartaz}?baixar=1`; a.download = "cartaz-plv12.png"; document.body.appendChild(a); a.click(); a.remove();
  }
  return (
    <main className="narrow" style={{ textAlign: "center" }}>
      <h1>Compartilhar no {NOME[rede]}</h1>
      <p>O cartaz leva o seu QR Code pessoal (sem o seu nome) e a mensagem já vem com as hashtags da campanha.</p>
      <img src={cartaz} alt="Cartaz da campanha" style={{ maxWidth: 320, width: "100%", height: "auto", borderRadius: 10, border: "1px solid #d5e0da" }} />
      <p className="small" style={{ whiteSpace: "pre-line", textAlign: "left", background: "#eef6f1", padding: 12, borderRadius: 10 }}>{text}</p>
      {mode === "loading" && <p className="small">Preparando…</p>}
      {mode === "native" && <button type="button" className="primary" onClick={native}>Enviar o cartaz e o texto pelo {NOME[rede]}</button>}
      {mode === "copy" && <button type="button" className="primary" onClick={copyAndDownload}>Baixar o cartaz e copiar o texto</button>}
      {msg && <p role="status" className="small">{msg}</p>}
      <p className="small">{HASHTAGS.join(" ")}</p>
      <p><a href="/">Voltar à petição</a></p>
    </main>
  );
}
