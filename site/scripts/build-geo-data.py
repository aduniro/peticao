#!/usr/bin/env python3
"""Gera assets/municipios.json e assets/regiao.json a partir de fontes OFICIAIS do IBGE.
 - Municípios: API de localidades (5.571).
 - Amazônia Legal 2024 (LC 124/2007) e Faixa de Fronteira 2024 (Lei 6.634/1979): planilhas do servidor de arquivos do IBGE.
Uso: python3 scripts/build-geo-data.py [pasta_com_xls]   (sem pasta, baixa os arquivos)"""
import gzip, json, sys, urllib.request, tempfile, os, xlrd
from pathlib import Path

root = Path(__file__).resolve().parent.parent
G = "https://geoftp.ibge.gov.br/organizacao_do_territorio/estrutura_territorial"
FILES = {"al": ("amazonia_legal/2024/Municipios_da_Amazonia_Legal_2024.xls", "amazonia2024.xls"),
         "ff": ("municipios_da_faixa_de_fronteira/2024/Mun_Faixa_de_Fronteira_Cidades_Gemeas_2024.xls", "fronteira2024.xls")}

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "peticao-build/1.0"}), timeout=90) as r:
        data = r.read()
    return gzip.decompress(data) if data[:2] == b"\x1f\x8b" else data  # a API do IBGE responde comprimida

muns = json.loads(get("https://servicodados.ibge.gov.br/api/v1/localidades/municipios"))
def uf_of(m):
    # alguns municípios novos vêm sem microrregião: cai para a região imediata
    if m.get("microrregiao"): return m["microrregiao"]["mesorregiao"]["UF"]["sigla"]
    return m["regiao-imediata"]["regiao-intermediaria"]["UF"]["sigla"]
rows = sorted(([m["id"], m["nome"], uf_of(m)] for m in muns), key=lambda r: (r[1], r[2]))
valid = {str(r[0]) for r in rows}
(root / "public" / "data").mkdir(parents=True, exist_ok=True)
(root / "public" / "data" / "municipios.json").write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"municípios: {len(rows)}")

src = Path(sys.argv[1]) if len(sys.argv) > 1 else None
tmp = Path(tempfile.mkdtemp())
out = {}
for key, (remote, local) in FILES.items():
    p = (src / local) if src and (src / local).exists() else None
    if p is None:
        p = tmp / local; p.write_bytes(get(f"{G}/{remote}"))
    sh = xlrd.open_workbook(str(p)).sheet_by_index(0)
    head = [str(c).split(",")[0] for c in sh.row_values(0)]
    i = head.index("CD_MUN")
    codes = sorted({str(sh.cell_value(r, i)).split(".")[0].zfill(7) for r in range(1, sh.nrows) if str(sh.cell_value(r, i)).strip()})
    bad = [c for c in codes if c not in valid]
    out[key] = [c for c in codes if c in valid]
    print(f"{key}: {len(codes)} códigos, {len(out[key])} existem na API do IBGE" + (f" (fora: {bad})" if bad else ""))
# Exceções decididas pela ADUNIR: municípios tratados como faixa de fronteira mesmo fora das listas do IBGE (código IBGE -> justificativa).
EXCECOES_FF = {"4310009": "Ibirubá (RS): consta da lista de 2010 do Ministério da Integração Nacional (Relação de Municípios em Faixa de Fronteira, CNPq AEX25), mas não das listas do IBGE (2018–2024), por cerca de 2 km. Tratado como faixa de fronteira até o MGI definir a relação final de localidades estratégicas (PLV 12/2026)."}
(root / "public" / "data" / "regiao.json").write_text(json.dumps({
    "al": out["al"], "ff": out["ff"], "ffExcecoes": sorted(EXCECOES_FF),
    "fonte": {"al": "IBGE, Municípios da Amazônia Legal 2024 (LC 124/2007)", "ff": "IBGE, Municípios da Faixa de Fronteira 2024 (Lei 6.634/1979)", "ffExcecoes": " | ".join(EXCECOES_FF.values())},
}, separators=(",", ":")), encoding="utf-8")
