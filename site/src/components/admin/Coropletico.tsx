"use client";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Ponto } from "@/lib/assinaturas-explorar";

import { RAMPA, classe, quantis } from "@/lib/quantis";
const VAZIO = "#ecebe7";

export default function Coropletico({ estados, pontos, selecionadas, onSelecionar, campi, altura = 460 }: { estados: { uf: string; n: number }[]; pontos: Ponto[]; selecionadas: string[]; onSelecionar: (ufs: string[]) => void; campi: boolean; altura?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const camadaUf = useRef<L.GeoJSON | null>(null);
  const camadaCampi = useRef<L.LayerGroup | null>(null);
  const [geo, setGeo] = useState<any>(null);
  const cb = useRef(onSelecionar); cb.current = onSelecionar;
  const enquadrado = useRef(false);
  const mapa = useMemo(() => new Map(estados.map((e) => [e.uf, e.n])), [estados]);
  const cortes = useMemo(() => quantis(estados.map((e) => e.n)), [estados]);
  const faixas = useMemo(() => RAMPA.map((cor, i) => ({ cor, i, ufs: estados.filter((e) => e.n > 0 && classe(e.n, cortes) === i).map((e) => e.uf) })), [estados, cortes]);

  useEffect(() => { fetch("/data/geo/estados.geojson").then((r) => r.json()).then(setGeo).catch(() => {}); }, []);
  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { center: [-14.2, -51.9], zoom: 4, zoomSnap: 0.25, zoomDelta: 0.5, zoomControl: true, attributionControl: false });
    camadaCampi.current = L.layerGroup().addTo(map.current);
    const ro = new ResizeObserver(() => map.current?.invalidateSize()); ro.observe(el.current);
    return () => { ro.disconnect(); map.current?.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    if (!map.current || !geo) return;
    camadaUf.current?.remove();
    camadaUf.current = L.geoJSON(geo, {
      style: (f) => { const uf = f?.properties?.sigla as string; const n = mapa.get(uf) ?? 0; const c = classe(n, cortes); const sel = selecionadas.includes(uf); return { fillColor: c < 0 ? VAZIO : RAMPA[c], fillOpacity: 0.85, color: sel ? "#111" : "#ffffff", weight: sel ? 3 : 1.2 }; },
      onEachFeature: (f, layer) => {
        const uf = f.properties.sigla as string, n = mapa.get(uf) ?? 0;
        const box = document.createElement("div");
        const h = document.createElement("strong"); h.textContent = `${f.properties.nome} (${uf})`; box.appendChild(h);
        const d = document.createElement("div"); d.textContent = `${n} assinatura(s)`; box.appendChild(d);
        const b = document.createElement("button"); b.type = "button"; b.className = "adm-btn"; b.textContent = selecionadas.includes(uf) ? "Tirar do filtro" : "Filtrar por este estado"; b.onclick = () => cb.current(selecionadas.includes(uf) ? selecionadas.filter((x) => x !== uf) : [...selecionadas, uf]); box.appendChild(b);
        layer.bindPopup(box);
      },
    }).addTo(map.current);
    camadaUf.current.bringToBack();
    const b = camadaUf.current.getBounds();
    if (b.isValid() && !enquadrado.current) { // enquadra só na primeira vez (depois, filtros não mexem no zoom do usuário)
      enquadrado.current = true;
      const m = map.current; m.invalidateSize();
      requestAnimationFrame(() => { m.invalidateSize(); m.fitBounds(b, { padding: [10, 10] }); });
    }
  }, [geo, mapa, cortes, selecionadas]);

  useEffect(() => {
    const g = camadaCampi.current; if (!g) return;
    g.clearLayers();
    if (!campi) return;
    for (const p of pontos) {
      const s = p.por.servidor; if (!s || s.conf + s.pend === 0) continue;
      const m = L.circleMarker([p.lat, p.lon], { radius: 4 + Math.min(14, Math.sqrt(s.conf + s.pend) * 2), color: "#111", weight: 1.5, fillColor: "#f5c518", fillOpacity: 0.95 });
      const box = document.createElement("div");
      const h = document.createElement("strong"); h.textContent = p.nome; box.appendChild(h);
      const d = document.createElement("div"); d.textContent = `Servidores: ${s.conf} confirmados · ${s.pend} aguardando`; box.appendChild(d);
      m.bindPopup(box); m.addTo(g);
    }
  }, [pontos, campi]);

  const rot = (i: number) => { const ini = i === 0 ? 1 : cortes[i - 1]; const fim = i < cortes.length ? cortes[i] - 1 : null; return fim === null ? `${ini}+` : fim <= ini ? `${ini}` : `${ini}–${fim}`; };
  return (
    <div>
      <div ref={el} style={{ height: altura, width: "100%", borderRadius: 10, background: "#dfe7ee" }} role="region" aria-label="Mapa de estados por número de assinaturas" />
      <div className="adm-legenda" role="group" aria-label="Legenda: clique para filtrar os estados da faixa">
        {faixas.map((f) => f.ufs.length ? (
          <button key={f.i} type="button" onClick={() => onSelecionar(f.ufs)} title={`${f.ufs.join(", ")}`}><i style={{ background: f.cor }} />{rot(f.i)} ({f.ufs.length} UF)</button>
        ) : null)}
        <button type="button" onClick={() => onSelecionar([])}><i style={{ background: VAZIO }} />0 / limpar</button>
      </div>
    </div>
  );
}
