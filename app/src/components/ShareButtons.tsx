"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/i18n/client";

type Texts = { whatsapp: string; emailSubject: string; emailBody: string; curto: string; short: string };
type Variant = "full" | "icons";

const Svg = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d={d} /></svg>;
const D = {
  wa: "M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.2 14.2c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7a11 11 0 0 1-4.6-4.1c-.4-.5-1.2-1.6-1.2-3s.8-2.1 1-2.4c.3-.3.6-.3.8-.3h.6c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.4.6-.3.4c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.2 1.3 2.5 1.5.3.1.5.1.7-.1l.9-1.1c.2-.3.4-.2.6-.1l2 1c.3.1.5.2.5.3.1.2.1.8-.1 1.4z",
  tg: "M9.8 18.7l.3-4.2 7.7-6.9c.3-.3-.1-.5-.5-.2l-9.5 6-4.1-1.3c-.9-.3-.9-.9.2-1.3l16-6.2c.7-.3 1.4.2 1.2 1.3l-2.7 12.8c-.2.9-.7 1.1-1.5.7l-4.1-3-2 1.9c-.2.2-.4.4-.8.4z",
  x: "M18.2 2.3h3.3l-7.2 8.3 8.5 11.2h-6.7l-5.2-6.8-6 6.8H1.7l7.7-8.8L1.3 2.3h6.8l4.7 6.2zm-1.2 17.5h1.8L7.1 4.1H5.1z",
  fb: "M13.5 22v-8.2h2.8l.5-3.3h-3.3V8.4c0-1 .4-1.7 1.8-1.7H17V3.8c-.3 0-1.3-.2-2.5-.2-2.6 0-4.3 1.6-4.3 4.4v2.5H7.4v3.3h2.800V22h3.300z",
  ig: "M7.5 2h9A5.5 5.5 0 0 1 22 7.5v9a5.5 5.5 0 0 1-5.5 5.5h-9A5.5 5.5 0 0 1 2 16.5v-9A5.5 5.5 0 0 1 7.5 2zm0 2A3.5 3.5 0 0 0 4 7.5v9A3.5 3.5 0 0 0 7.5 20h9a3.5 3.5 0 0 0 3.5-3.5v-9A3.5 3.5 0 0 0 16.5 4h-9zM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm5.3-3.3a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4z",
  mail: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v.5l8 5 8-5V6H4zm16 3-8 5-8-5v9h16V9z",
  link: "M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z",
  share: "M18 16a3 3 0 0 0-2.400 1.200L8.900 13.300a3 3 0 0 0 0-2.600l6.700-3.900A3 3 0 1 0 15 5.600L8.400 9.500a3 3 0 1 0 0 5l6.600 3.900A3 3 0 1 0 18 16z",
  dl: "M12 3v11.2l3.600-3.600L17 12l-5 5-5-5 1.400-1.400L11 14.200V3h1zM5 19h14v2H5z",
  img: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1 2v8.600l3.500-3.500 2.500 2.500 4-4.600L19 14V7H5zm3 1.500a1.500 1.500 0 1 1 0 3 1.500 1.500 0 0 1 0-3z",
};

/**
 * Botões de compartilhar. `variant="icons"` (topbar no computador) mostra só os ícones; "full" mostra ícones e nomes.
 * O cartaz é pré-carregado: o menu nativo (Web Share com imagem) é chamado de forma síncrona no clique, senão o navegador perde o gesto do usuário.
 */
export default function ShareButtons({ link, texts, cardUrl = "/api/cartao-compartilhar", cardName = "cartaz-plv12.png", pageUrl, variant = "full" }: { link: string; texts: Texts; cardUrl?: string; cardName?: string; pageUrl?: string; variant?: Variant }) {
  const { t } = useI18n();
  const [msg, setMsg] = useState("");
  const [canNative, setCanNative] = useState(false);
  const file = useRef<File | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const flash = (m: string) => { setMsg(m); clearTimeout(timer.current); timer.current = setTimeout(() => setMsg(""), 4000); };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    setCanNative(typeof navigator !== "undefined" && !!navigator.share);
    let off = false;
    fetch(cardUrl).then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b && !off) file.current = new File([b], cardName, { type: "image/png" }); }).catch(() => {});
    return () => { off = true; };
  }, [cardUrl, cardName]);

  const copy = () => { navigator.clipboard.writeText(link).then(() => flash(t("share.copied")), () => flash(t("share.copyFail"))); };
  const copyImage = () => {
    if (!navigator.clipboard || !("ClipboardItem" in window)) return flash(t("share.imageCopyFail"));
    // ClipboardItem com Promise: a cópia é pedida dentro do clique (exigência do Safari/Chrome).
    navigator.clipboard.write([new ClipboardItem({ "image/png": fetch(cardUrl).then((r) => r.blob()) })]).then(() => flash(t("share.imageCopied")), () => flash(t("share.imageCopyFail")));
  };
  const nativeShare = () => {
    const f = file.current;
    const data: ShareData = f && navigator.canShare?.({ files: [f] }) ? { files: [f], text: texts.whatsapp, title: "PLV 12/2026" } : { text: texts.curto, url: link, title: "PLV 12/2026" };
    if (!navigator.share) return flash(t("share.noNative"));
    navigator.share(data).catch((e: unknown) => { if ((e as { name?: string })?.name !== "AbortError") flash(t("share.shareFail")); });
  };
  // Instagram não tem endereço de compartilhamento na web: no celular o menu nativo leva a imagem ao app; no computador baixamos o cartaz e copiamos o texto.
  // WhatsApp: no celular, o menu nativo leva o cartaz junto com o texto (como no envio com QR Code); sem isso, abre o wa.me só com o texto.
  const whatsapp = (e: React.MouseEvent) => {
    const f = file.current;
    if (f && navigator.canShare?.({ files: [f] }) && navigator.share) {
      e.preventDefault();
      navigator.share({ files: [f], text: texts.whatsapp, title: "PLV 12/2026" }).catch((err: unknown) => { if ((err as { name?: string })?.name !== "AbortError") window.open(`https://wa.me/?text=${encodeURIComponent(texts.whatsapp)}`, "_blank", "noopener,noreferrer"); });
    }
  };
  const instagram = () => {
    const f = file.current;
    if (f && navigator.canShare?.({ files: [f] })) { navigator.share({ files: [f], text: texts.curto }).catch(() => {}); return; }
    navigator.clipboard?.writeText(texts.curto).catch(() => {});
    const a = document.createElement("a"); a.href = `${cardUrl}?baixar=1`; a.download = cardName; document.body.appendChild(a); a.click(); a.remove();
    flash(t("share.instagramHint"));
    window.open("https://www.instagram.com/", "_blank", "noopener,noreferrer");
  };

  const icons = variant === "icons";
  const Btn = ({ cls = "", icon, label, onClick, href, track, ext = false, download }: { cls?: string; icon: string; label: string; onClick?: (e: React.MouseEvent) => void; href?: string; track: string; ext?: boolean; download?: string }): ReactNode => {
    const common = { className: `btn ${cls}${icons ? " icon-only" : ""}`, "data-track": track, "data-event": "share" as const, ...(icons ? { "aria-label": label, title: label } : {}) };
    const inner = <><Svg d={icon} />{!icons && label}</>;
    return href ? <a {...common} onClick={onClick} href={href} {...(ext ? { target: "_blank", rel: "noopener noreferrer" } : {})} {...(download ? { download } : {})}>{inner}</a> : <button type="button" {...common} onClick={onClick}>{inner}</button>;
  };
  const enc = encodeURIComponent;
  return (
    <div className={`share${icons ? " share-icons" : ""}`}>
      {Btn({ cls: "wa", icon: D.wa, label: "WhatsApp", href: `https://wa.me/?text=${enc(texts.whatsapp)}`, onClick: whatsapp, track: "compartilhar-whatsapp", ext: true })}
      {Btn({ cls: "tg", icon: D.tg, label: "Telegram", href: `https://t.me/share/url?url=${enc(link)}&text=${enc(texts.short)}`, track: "compartilhar-telegram", ext: true })}
      {Btn({ cls: "xx", icon: D.x, label: "X", href: `https://x.com/intent/tweet?text=${enc(texts.short)}&url=${enc(link)}`, track: "compartilhar-x", ext: true })}
      {Btn({ cls: "fb", icon: D.fb, label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${enc(pageUrl ?? link)}`, track: "compartilhar-facebook", ext: true })}
      {Btn({ cls: "ig", icon: D.ig, label: "Instagram", onClick: instagram, track: "compartilhar-instagram" })}
      {Btn({ icon: D.mail, label: t("share.email"), href: `mailto:?subject=${enc(texts.emailSubject)}&body=${enc(texts.emailBody)}`, track: "compartilhar-email" })}
      {Btn({ icon: D.link, label: t("share.copy"), onClick: copy, track: "compartilhar-copiar" })}
      {canNative && Btn({ icon: D.share, label: t("share.native"), onClick: nativeShare, track: "compartilhar-nativo" })}
      {Btn({ icon: D.img, label: t("share.copyImage"), onClick: copyImage, track: "cartaz-copiar" })}
      {Btn({ icon: D.dl, label: t("share.card"), href: `${cardUrl}?baixar=1`, download: cardName, track: "cartaz-baixar" })}
      {!icons && <input className="linkbox" readOnly value={link} aria-label={t("share.yourLink")} onFocus={(e) => e.currentTarget.select()} />}
      {msg && <p className="small share-msg" role="status">{msg}</p>}
    </div>
  );
}
