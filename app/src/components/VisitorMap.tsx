"use client";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";
import type { Point, RequestPoint } from "@/lib/monitor";
import { REQ_COLORS } from "./req-colors";

/** Cores das requisições no mapa (a legenda do painel usa as mesmas). */

const REQ_LABEL = { confirmed: "assinaturas confirmadas", pending: "aguardando confirmação do e-mail", invalid: "tentativas com e-mail inexistente", blocked: "bloqueios (IP ou e-mail)", queued: "e-mails na fila de reenvio" } as const;

/** Mapa Leaflet (OpenStreetMap): visitantes (azul/verde) e, por cima, as requisições de assinatura e de segurança por localização aproximada. */
export default function VisitorMap({ points, requests = [] }: { points: Point[]; requests?: RequestPoint[] }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { center: [-14.2, -51.9], zoom: 4, worldCopyJump: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => { map.current?.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    if (!map.current || !layer.current) return;
    layer.current.clearLayers();
    const bounds: L.LatLngTuple[] = [];
    const popup = (title: string, lines: string[]) => {
      const box = document.createElement("div");
      const h = document.createElement("strong"); h.textContent = title; box.appendChild(h);
      for (const l of lines) { const d = document.createElement("div"); d.textContent = l; box.appendChild(d); }
      return box;
    };
    for (const p of points) {
      const signed = p.signed > 0;
      const m = L.circleMarker([p.lat, p.lon], { radius: 7 + Math.sqrt(p.visitors) * 4, color: signed ? "#0b6b45" : "#1d4ed8", fillColor: signed ? "#18a366" : "#3b82f6", fillOpacity: 0.35, weight: 1 });
      m.bindPopup(popup([p.city, p.region, p.country].filter(Boolean).join(", ") || "Local desconhecido", [`${p.visitors} visitante(s)`, `${p.signed} com assinatura (confirmada ou aguardando)`]));
      m.addTo(layer.current);
      bounds.push([p.lat, p.lon]);
    }
    // Requisições: um círculo por tipo, do maior para o menor, para todos aparecerem no mesmo local.
    for (const p of requests) {
      const kinds = (Object.keys(REQ_COLORS) as (keyof typeof REQ_COLORS)[]).filter((k) => p[k] > 0).sort((a, b) => p[b] - p[a]);
      kinds.forEach((k, i) => {
        const m = L.circleMarker([p.lat, p.lon], { radius: 6 + Math.sqrt(p[k]) * 3 + (kinds.length - i) * 2, color: REQ_COLORS[k], fillColor: REQ_COLORS[k], fillOpacity: 0.6, weight: 2 });
        m.bindPopup(popup([p.city, p.region, p.country].filter(Boolean).join(", ") || "Local desconhecido", kinds.map((x) => `${p[x]} ${REQ_LABEL[x]}`)));
        m.addTo(layer.current!);
      });
      bounds.push([p.lat, p.lon]);
    }
    if (bounds.length) map.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 8 });
  }, [points, requests]);

  return <div ref={el} className="map" role="region" aria-label="Mapa de visitantes e requisições" />;
}
