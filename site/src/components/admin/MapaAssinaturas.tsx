"use client";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";
import type { Ponto } from "@/lib/assinaturas-explorar";
import type { PontoVisita } from "@/app/api/admin/assinaturas/visitas/route";

const CAT: Record<string, string> = { servidor: "Servidores", apoiador: "Apoiadores", estrangeiro: "Estrangeiros" };

/** Mapa do local declarado: um círculo por lugar (tamanho = assinaturas; azul = só confirmadas, vermelho = há pendentes). Clicar filtra a tabela. */
export default function MapaAssinaturas({ pontos, altura, onEscolher, foco, visitas }: { pontos: Ponto[]; altura: string; onEscolher: (p: Ponto) => void; foco?: string | null; visitas?: PontoVisita[] | null }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const marcas = useRef<Record<string, L.CircleMarker>>({});
  const cb = useRef(onEscolher); cb.current = onEscolher;

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { center: [-14.2, -51.9], zoom: 4, worldCopyJump: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    const ro = new ResizeObserver(() => map.current?.invalidateSize()); ro.observe(el.current);
    return () => { ro.disconnect(); map.current?.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    if (!map.current || !layer.current) return;
    layer.current.clearLayers(); marcas.current = {};
    const lim: L.LatLngTuple[] = [];
    if (visitas) {
      for (const v of visitas) {
        const m = L.circleMarker([v.lat, v.lon], { radius: 5 + Math.min(24, Math.sqrt(v.visitas + v.confirmadas + v.pendentes) * 2.5), color: v.devolvidos ? "#991b1b" : "#1d4ed8", fillColor: v.devolvidos ? "#ef4444" : v.confirmadas ? "#18a366" : "#3b82f6", fillOpacity: 0.55, weight: 1.5 });
        const box = document.createElement("div");
        const h = document.createElement("strong"); h.textContent = v.local; box.appendChild(h);
        for (const t of [`${v.visitas} visita(s)`, `${v.confirmadas} assinatura(s) confirmada(s)`, `${v.pendentes} aguardando confirmação`, `${v.devolvidos} e-mail(s) inexistente(s)/devolvido(s)`, v.bloqueios ? `${v.bloqueios} bloqueio(s)` : ""]) if (t) { const d = document.createElement("div"); d.textContent = t; box.appendChild(d); }
        m.bindPopup(box); m.addTo(layer.current); lim.push([v.lat, v.lon]);
      }
      if (lim.length) map.current.fitBounds(L.latLngBounds(lim).pad(0.2), { maxZoom: 8 });
      return;
    }
    for (const p of pontos) {
      const tot = p.conf + p.pend;
      const m = L.circleMarker([p.lat, p.lon], { radius: 5 + Math.min(22, Math.sqrt(tot) * 3), color: p.pend ? "#991b1b" : "#1e3a8a", fillColor: p.pend ? "#ef4444" : "#3b82f6", fillOpacity: 0.6, weight: 1.5 });
      const box = document.createElement("div");
      const h = document.createElement("strong"); h.textContent = `${p.nome}${p.uf ? " — " + p.uf : ""}`; box.appendChild(h);
      const add = (t: string) => { const d = document.createElement("div"); d.textContent = t; box.appendChild(d); };
      add(`${p.conf} confirmada(s) · ${p.pend} aguardando confirmação`);
      for (const [c, v] of Object.entries(p.por)) add(`${CAT[c] ?? c}: ${v.conf} conf. / ${v.pend} pend.`);
      const b = document.createElement("button"); b.type = "button"; b.className = "adm-btn"; b.textContent = "Filtrar a tabela por este local"; b.onclick = () => cb.current(p); box.appendChild(b);
      m.bindPopup(box); m.addTo(layer.current); marcas.current[p.chave] = m; lim.push([p.lat, p.lon]);
    }
    if (lim.length) map.current.fitBounds(L.latLngBounds(lim).pad(0.2), { maxZoom: 8 });
  }, [pontos, visitas]);

  useEffect(() => { const m = foco ? marcas.current[foco] : null; if (m && map.current) { map.current.setView(m.getLatLng(), Math.max(map.current.getZoom(), 7)); m.openPopup(); } }, [foco]);

  return <div ref={el} style={{ height: altura, width: "100%", borderRadius: 10 }} role="region" aria-label="Mapa das assinaturas por local declarado" />;
}
