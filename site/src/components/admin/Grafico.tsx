"use client";
import { useEffect, useRef } from "react";

/** Paleta validada (categórica, ordem fixa): azul, laranja, água. Tema escuro usa os passos próprios. */
export const CORES = { claro: ["#2a78d6", "#eb6834", "#1baf7a"], escuro: ["#3987e5", "#d95926", "#199e70"] };

export type DadosGrafico = { labels: string[]; datasets: { label: string; data: number[]; cor?: number }[] };

/** Chart.js carregado sob demanda (só no navegador). Barras com cantos arredondados no fim, linhas de 2 px, grade discreta, tooltip por padrão. */
export default function Grafico({ tipo, dados, altura = 240, horizontal = false, empilhado = false }: { tipo: "bar" | "line" | "doughnut"; dados: DadosGrafico; altura?: number; horizontal?: boolean; empilhado?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const chart = useRef<any>(null);
  useEffect(() => {
    let vivo = true;
    (async () => {
      const { default: Chart } = await import("chart.js/auto");
      if (!vivo || !ref.current) return;
      const escuro = !!document.querySelector(".v2-escuro") || document.documentElement.dataset.theme === "dark" || matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme !== "light";
      const pal = escuro ? CORES.escuro : CORES.claro;
      const tinta = escuro ? "#c3c2b7" : "#52514e", grade = escuro ? "#ffffff1a" : "#0000001a", sup = escuro ? "#1a1a19" : "#fcfcfb";
      const ds = dados.datasets.map((d, i) => {
        const c = pal[(d.cor ?? i) % pal.length];
        if (tipo === "doughnut") return { label: d.label, data: d.data, backgroundColor: dados.labels.map((_, k) => pal[k % pal.length]), borderColor: sup, borderWidth: 2 };
        if (tipo === "line") return { label: d.label, data: d.data, borderColor: c, backgroundColor: c, borderWidth: 2, pointRadius: 3, pointHoverRadius: 6, tension: 0.25 };
        return { label: d.label, data: d.data, backgroundColor: c, borderRadius: 4, borderSkipped: "start" as const, maxBarThickness: 28 };
      });
      const cfg: any = {
        type: tipo, data: { labels: dados.labels, datasets: ds },
        options: {
          responsive: true, maintainAspectRatio: false, indexAxis: horizontal ? "y" : "x", animation: { duration: 250 },
          interaction: { mode: tipo === "doughnut" ? "nearest" : "index", intersect: false },
          plugins: { legend: { display: dados.datasets.length > 1 || tipo === "doughnut", position: "bottom", labels: { color: tinta, boxWidth: 12, boxHeight: 12 } }, tooltip: { padding: 10 } },
          ...(tipo === "doughnut" ? { cutout: "62%" } : { scales: { x: { stacked: empilhado, grid: { color: tipo === "bar" && horizontal ? grade : "transparent" }, ticks: { color: tinta, maxRotation: 0, autoSkip: true } }, y: { stacked: empilhado, beginAtZero: true, grid: { color: grade }, ticks: { color: tinta, precision: 0 } } } }),
        },
      };
      chart.current?.destroy();
      chart.current = new Chart(ref.current, cfg);
    })();
    return () => { vivo = false; chart.current?.destroy(); chart.current = null; };
  }, [tipo, dados, horizontal, empilhado]);
  return <div style={{ height: altura, position: "relative" }}><canvas ref={ref} role="img" aria-label={dados.datasets.map((d) => d.label).join(", ")} /></div>;
}
