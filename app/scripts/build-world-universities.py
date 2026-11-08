#!/usr/bin/env python3
"""Gera public/data/world-universities.json a partir da base aberta Hipo/university-domains-list (MIT):
https://github.com/Hipo/university-domains-list  — uma linha por DOMÍNIO: [nome, país(ISO2), domínio, site, estado]."""
import json, urllib.request, gzip
from pathlib import Path
U = "https://raw.githubusercontent.com/Hipo/university-domains-list/master/world_universities_and_domains.json"
data = urllib.request.urlopen(urllib.request.Request(U, headers={"User-Agent": "peticao-build/1.0"}), timeout=120).read()
if data[:2] == b"\x1f\x8b": data = gzip.decompress(data)
rows, seen = [], set()
for u in json.loads(data):
    for d in u.get("domains", []):
        d = d.strip().lower()
        if not d or (d, u["alpha_two_code"]) in seen: continue
        seen.add((d, u["alpha_two_code"]))
        rows.append([u["name"].strip(), u["alpha_two_code"].upper(), d, (u.get("web_pages") or [""])[0], u.get("state-province") or ""])
rows.sort(key=lambda r: (r[1], r[0]))
out = Path(__file__).resolve().parent.parent / "public/data/world-universities.json"
out.write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"{len(rows)} domínios, {len({r[1] for r in rows})} países, {len({r[0] for r in rows})} universidades -> {out.name} ({out.stat().st_size//1024} KB)")
