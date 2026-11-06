#!/usr/bin/env python3
"""Gera as opções de capa para a ADUNIR escolher: converte todas as PNG/JPEG/WebP de /mnt/dev/peticao/ (raiz) e a capa atual
para WebP em 3 larguras (640/1080/1600) em public/capa/opcoes/ e escreve o manifesto src/content/capas.ts.
Uso: python3 scripts/prepare-covers.py   (requer Pillow)"""
import hashlib, json
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
src_dir = root.parent
out = root / "public" / "capa" / "opcoes"; out.mkdir(parents=True, exist_ok=True)
for old in out.glob("*.webp"): old.unlink()

files = sorted(p for p in src_dir.iterdir() if p.is_file() and p.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp"))
files.append(root / "assets" / "capa_peticao.png")
seen, items = set(), []
for p in files:
    h = hashlib.sha256(p.read_bytes()).hexdigest()
    if h in seen: continue
    seen.add(h)
    items.append((p, h))
manifest = []
for n, (p, h) in enumerate(items, 1):
    im = Image.open(p).convert("RGB"); W, H = im.size
    for w in (640, 1080, 1600):
        r = im if w >= W else im.resize((w, round(H * w / W)), Image.LANCZOS)
        r.save(out / f"opcao-{n}-{w}.webp", "WEBP", quality=82, method=6)
    manifest.append({"n": n, "w": W, "h": H, "src": p.name, "atual": p.name == "capa_peticao.png"})
    print(n, p.name, f"{W}x{H}")
(root / "src" / "content" / "capas.ts").write_text(
    "// Gerado por scripts/prepare-covers.py. Opções de capa para a ADUNIR escolher (WebP 640/1080/1600).\n"
    "export type Capa = { n: number; w: number; h: number; src: string; atual: boolean };\n"
    f"export const CAPAS: Capa[] = {json.dumps(manifest, ensure_ascii=False)};\n", encoding="utf-8")
