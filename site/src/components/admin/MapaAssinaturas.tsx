"use client";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";
import type { Ponto } from "@/lib/assinaturas-explorar";
import type { PontoVisita } from "@/app/api/admin/assinaturas/visitas/route";
import type { RequestPoint } from "@/lib/monitor";
import { REQ_COLORS } from "../req-colors";

const CAT: Record<string, string> = { servidor: "Servidores", apoiador: "Apoiadores", estrangeiro: "Estrangeiros" };

/** Mapa do local declarado: um círculo por lugar (tamanho = assinaturas; azul = só confirmadas, vermelho = há pendentes). Clicar filtra a tabela. */
export default function MapaAssinaturas({ pontos, altura, onEscolher, foco, visitas, acessos }: { pontos: Ponto[]; altura: string; onEscolher: (p: Ponto) => void; foco?: string | null; visitas?: PontoVisita[] | null; acessos?: RequestPoint[] | null }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const marcas = useRef<Record<string, L.CircleMarker>>({});
  const cb = useRef(onEscolher); cb.current = onEscolher;
  function posicionarPopup(popup: L.Popup) {
    const active = popup.getElement()?.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const command = el.current?.closest(".v2-mapa-cheio")?.querySelector(".v2-mapa-comando");
    const top = command && el.current ? Math.max(12, command.getBoundingClientRect().bottom - el.current.getBoundingClientRect().top + 12) : 12;
    popup.options.autoPanPaddingTopLeft = L.point(12, top);
    popup.options.autoPanPaddingBottomRight = L.point(12, window.matchMedia("(max-width: 992px)").matches ? 76 : 12);
    popup.update();
    if (active?.isConnected) active.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { center: [-14.2, -51.9], zoom: 4, worldCopyJump: true, zoomControl: false });
    L.control.zoom({ position: "bottomleft" }).addTo(map.current);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    const ro = new ResizeObserver(() => {
      map.current?.invalidateSize();
      map.current?.eachLayer((item) => { if (item instanceof L.Popup) posicionarPopup(item); });
    }); ro.observe(el.current);
    const command = el.current.closest(".v2-mapa-cheio")?.querySelector(".v2-mapa-comando");
    if (command) ro.observe(command);
    return () => { ro.disconnect(); map.current?.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    if (!map.current || !layer.current) return;
    layer.current.clearLayers(); marcas.current = {};
    const lim: L.LatLngTuple[] = [];
    const adicionar = (marker: L.CircleMarker, box: HTMLElement, label: string) => {
      let teclado = false;
      marker.bindPopup(box).on("add", () => {
        const element = marker.getElement();
        if (!element) return;
        element.setAttribute("tabindex", "0"); element.setAttribute("role", "button"); element.setAttribute("aria-label", label);
        element.addEventListener("keydown", (event) => {
          const key = (event as KeyboardEvent).key;
          if (key !== "Enter" && key !== " ") return;
          event.preventDefault(); event.stopPropagation(); teclado = true; marker.openPopup();
        });
      }).on("popupopen", () => {
        const opened = marker.getPopup(); if (opened) posicionarPopup(opened);
        if (!teclado) return;
        const popup = marker.getPopup()?.getElement();
        const target = popup?.querySelector<HTMLElement>("button, a");
        target?.focus();
      }).on("popupclose", () => {
        if (teclado) (marker.getElement() as SVGElement | undefined)?.focus();
        teclado = false;
      }).addTo(layer.current!);
    };
    if (acessos) {
      const ROT = { confirmed: "assinaturas confirmadas", pending: "aguardando confirmação do e-mail", invalid: "e-mails inexistentes", blocked: "e-mails bloqueados", queued: "e-mails na fila" } as const;
      for (const a of acessos) {
        const dom = (Object.keys(ROT) as (keyof typeof ROT)[]).reduce((m, k) => (a[k] > a[m] ? k : m), "confirmed" as keyof typeof ROT); const tot = a.confirmed + a.pending + a.invalid + a.blocked + a.queued; if (!tot) continue;
        const m = L.circleMarker([a.lat, a.lon], { radius: 5 + Math.min(22, Math.sqrt(tot) * 3), color: REQ_COLORS[dom], fillColor: REQ_COLORS[dom], fillOpacity: 0.55, weight: 1.5 });
        const box = document.createElement("div"); const h = document.createElement("strong"); h.textContent = [a.city, a.region, a.country].filter(Boolean).join(", ") || "Local desconhecido"; box.appendChild(h);
        for (const k of Object.keys(ROT) as (keyof typeof ROT)[]) if (a[k]) { const d = document.createElement("div"); d.textContent = `${a[k]} ${ROT[k]}`; box.appendChild(d); }
        adicionar(m, box, `${h.textContent}: ${tot} acesso(s) e pedido(s). Abrir detalhes`); lim.push([a.lat, a.lon]);
      }
      if (lim.length) map.current.fitBounds(L.latLngBounds(lim).pad(0.2), { maxZoom: 8 });
      return;
    }
    if (visitas) {
      for (const v of visitas) {
        const m = L.circleMarker([v.lat, v.lon], { radius: 5 + Math.min(24, Math.sqrt(v.visitas + v.confirmadas + v.pendentes) * 2.5), color: v.devolvidos ? "#991b1b" : "#1d4ed8", fillColor: v.devolvidos ? "#ef4444" : v.confirmadas ? "#18a366" : "#3b82f6", fillOpacity: 0.55, weight: 1.5 });
        const box = document.createElement("div");
        const h = document.createElement("strong"); h.textContent = v.local; box.appendChild(h);
        for (const t of [`${v.visitas} visita(s)`, `${v.confirmadas} assinatura(s) confirmada(s)`, `${v.pendentes} aguardando confirmação`, `${v.devolvidos} e-mail(s) inexistente(s)/devolvido(s)`, v.bloqueios ? `${v.bloqueios} bloqueio(s)` : ""]) if (t) { const d = document.createElement("div"); d.textContent = t; box.appendChild(d); }
        adicionar(m, box, `${v.local}: ${v.visitas} visita(s). Abrir detalhes`); lim.push([v.lat, v.lon]);
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
      adicionar(m, box, `${h.textContent}: ${p.conf} confirmada(s), ${p.pend} aguardando confirmação. Abrir detalhes`); marcas.current[p.chave] = m; lim.push([p.lat, p.lon]);
    }
    if (lim.length) map.current.fitBounds(L.latLngBounds(lim).pad(0.2), { maxZoom: 8 });
  }, [pontos, visitas, acessos]);

  useEffect(() => { const m = foco ? marcas.current[foco] : null; if (m && map.current) { map.current.setView(m.getLatLng(), Math.max(map.current.getZoom(), 7)); m.openPopup(); } }, [foco]);

  return <div ref={el} style={{ height: altura, width: "100%", borderRadius: 10 }} role="region" aria-label="Mapa das assinaturas por local declarado" />;
}
