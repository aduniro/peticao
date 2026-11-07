#!/usr/bin/env python3
"""Gera as imagens de capa (WebP/JPEG responsivos) e a imagem de pré-visualização do link (og) a partir de assets/capa_peticao.png.
Uso: python3 scripts/prepare-cover.py   (requer Pillow)"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent
src = Image.open(root / "assets" / "capa_peticao.png").convert("RGB")
out = root / "public" / "capa"; out.mkdir(parents=True, exist_ok=True)
W, H = src.size
for w in (640, 1080, 1600, W):
    h = round(H * w / W)
    im = src if w == W else src.resize((w, h), Image.LANCZOS)
    im.save(out / f"capa-{w}.webp", "WEBP", quality=82, method=6)
src.resize((1080, round(H * 1080 / W)), Image.LANCZOS).save(out / "capa-1080.jpg", "JPEG", quality=84, optimize=True, progressive=True)

# Imagem de pré-visualização do link (1200x630): foto (corte central) + degradê + título
og_w, og_h = 1200, 630
scale = og_h / H
photo = src.resize((round(W * scale), og_h), Image.LANCZOS)
left = (photo.width - og_w) // 2
og = photo.crop((left, 0, left + og_w, og_h)).convert("RGBA")
grad = Image.new("RGBA", (og_w, og_h))
px = grad.load()
for y in range(og_h):
    t = max(0.0, (y - og_h * 0.30) / (og_h * 0.70))
    a = int(235 * t ** 1.4)
    for x in range(og_w):
        px[x, y] = (4, 48, 34, a)
og = Image.alpha_composite(og, grad)
d = ImageDraw.Draw(og)
fonts = Path(root / "assets" / "fonts")
f_xl = ImageFont.truetype(str(fonts / "Inter-ExtraBold.otf"), 70)
f_md = ImageFont.truetype(str(fonts / "Inter-SemiBold.otf"), 32)
f_sm = ImageFont.truetype(str(fonts / "Inter-ExtraBold.otf"), 22)
d.rounded_rectangle((56, 56, 318, 104), radius=24, fill=(245, 197, 24, 255))
d.text((187, 80), "PETIÇÃO PÚBLICA", font=f_sm, fill=(74, 59, 0, 255), anchor="mm")
d.text((56, 380), "Sanção integral do", font=f_xl, fill=(255, 255, 255, 255))
d.text((56, 456), "PLV 12/2026", font=f_xl, fill=(245, 197, 24, 255))
d.text((56, 556), "Todos os campi na Amazônia Legal e na Faixa de Fronteira", font=f_md, fill=(255, 255, 255, 235))
og.convert("RGB").save(out / "og.jpg", "JPEG", quality=86, optimize=True, progressive=True)
print("ok")
