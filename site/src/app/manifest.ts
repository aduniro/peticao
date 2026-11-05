import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Petição PLV 12/2026",
    short_name: "PLV 12/2026",
    description: "Pela sanção integral do PLV nº 12/2026: valorização dos servidores das IFES em todos os Campi situados na Amazônia Legal e na Faixa de Fronteira.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b6b45",
    theme_color: "#0b6b45",
    lang: "pt-BR",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
