import "./globals.css";
import type { Metadata, Viewport } from "next";
import Tracker from "@/components/Tracker";
import PublicChrome from "@/components/PublicChrome";
import { I18nProvider } from "@/i18n/client";
import { getI18n } from "@/i18n/server";
import { LOCALE_INFO } from "@/i18n";
import { PETICAO_BR } from "@/content/peticao";
import { headers } from "next/headers";
import { publicOrigin } from "@/lib/net";
import { adminMirrorEnabled } from "@/lib/admin-mirror";
import MirrorStatus from "@/components/admin/MirrorStatus";

const base = process.env.APP_URL ?? "http://localhost:3000";
const live = process.env.NODE_ENV === "production" && process.env.PREVIEW_MODE !== "1";

const OG_LOCALE = { pt: "pt_BR", es: "es_ES", en: "en_US", fr: "fr_FR", de: "de_DE" } as const;
const SHORT = { pt: "Pela sanção integral do PLV nº 12/2026", es: "Por la sanción íntegra del PLV n.º 12/2026", en: "For the full sanction of PLV No. 12/2026", fr: "Pour la sanction intégrale du PLV n° 12/2026", de: "Für die vollständige Inkraftsetzung des PLV Nr. 12/2026" } as const;

export async function generateMetadata(): Promise<Metadata> {
  const { lang } = await getI18n();
  // Endereço absoluto pelo host de quem acessou: a imagem da prévia sempre resolve.
  const origin = publicOrigin(headers(), base);
  const title = SHORT[lang];
  const description = PETICAO_BR[lang].title;
  return {
    metadataBase: new URL(origin), title, description,
    robots: live ? undefined : { index: false, follow: false },
    openGraph: { title, description, url: origin, siteName: "PLV 12/2026", images: [{ url: "/og.png?v=2", width: 1200, height: 630, alt: title, type: "image/png" }], type: "website", locale: OG_LOCALE[lang] },
    twitter: { card: "summary_large_image", title, description, images: ["/og.png?v=2"] },
    appleWebApp: { capable: true, title: "PLV 12/2026", statusBarStyle: "black-translucent" },
    icons: { apple: "/apple-icon.png", icon: "/icon-192.png" },
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  width: "device-width", initialScale: 1, viewportFit: "cover",
  themeColor: "#0b6b45",
};

export const dynamic = "force-dynamic"; // o aviso de pré-visualização depende do ambiente em tempo de execução

const PLATFORM = `(function(){var d0=document.documentElement;try{d0.dataset.theme=localStorage.getItem("theme")==="dark"?"dark":"light"}catch(e){d0.dataset.theme="light"}var tc=document.querySelector('meta[name="theme-color"]');if(tc&&d0.dataset.theme==="dark")tc.setAttribute("content","#04281d");var u=navigator.userAgent||"";var ios=/iPhone|iPad|iPod/.test(u)||(/Macintosh/.test(u)&&navigator.maxTouchPoints>1);var p=ios?"ios":/Android/.test(u)?"android":"desktop";var d=document.documentElement;d.dataset.platform=p;if(navigator.standalone||(window.matchMedia&&matchMedia("(display-mode: standalone)").matches))d.dataset.standalone="1"})()`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { lang, country, messages } = await getI18n();
  return (
    <html lang={LOCALE_INFO[lang].intl} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: PLATFORM }} /></head>
      <body>
        <I18nProvider lang={lang} country={country} messages={messages}>
        {adminMirrorEnabled() ? (
          <div className="preview-banner" role="note">Prévia com dados da produção — somente leitura<MirrorStatus /></div>
        ) : process.env.PREVIEW_MODE === "1" && (
          <div className="preview-banner" role="note">
            PRÉ-VISUALIZAÇÃO PARA REVISÃO: dados fictícios, nenhum e-mail real é enviado. Confirmações aparecem em <a href="/dev/outbox">/dev/outbox</a>.
          </div>
        )}
        {children}
        <PublicChrome />
        <Tracker />
        </I18nProvider>
      </body>
    </html>
  );
}
