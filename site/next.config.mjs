import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

/** O servidor de desenvolvimento usa .next-dev; o build de produção usa .next (assim um não quebra o outro). */
export default (phase) => ({
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
  experimental: { serverComponentsExternalPackages: ["pg", "nodemailer", "@resvg/resvg-js", "maxmind"] },
  poweredByHeader: false,
  // Cabeçalhos de segurança (o HSTS é ligado na Cloudflare). Sem CSP por enquanto: o site usa mapa (Leaflet) e o Turnstile.
  async headers() {
    const semCache = [
      { key: "Cache-Control", value: "no-store, max-age=0" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
      { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    ];
    return [{ source: "/admin/:path*", headers: semCache }, { source: "/admin", headers: semCache }, { source: "/api/admin/:path*", headers: semCache }, { source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    ] }];
  },
});
