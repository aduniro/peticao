#!/usr/bin/env python3
"""Gera public/data/ifes.json (todas as IES públicas FEDERAIS e os municípios onde têm campi) a partir do
Censo da Educação Superior do INEP (dados abertos): tabela de IES (sigla, sede, categoria) e tabela de cursos
(município de cada curso PRESENCIAL). Campus = município onde a IFES oferece curso presencial.
Limite conhecido: campi só de ensino técnico (sem curso superior) não aparecem; o usuário pode digitar o campus.
Uso: python3 scripts/build-ifes-data.py <pasta com MICRODADOS_*.CSV descompactados>"""
import csv, json, sys, re, collections
from pathlib import Path

root = Path(__file__).resolve().parent.parent
D = Path(sys.argv[1])
muns = {str(i): (n, u) for i, n, u in json.load(open(root / "public/data/municipios.json"))}
SMALL = {"de", "da", "do", "das", "dos", "e", "em", "a", "o"}

def title(s):
    out = []
    for i, w in enumerate(s.lower().split()):
        out.append(w if (w in SMALL and i) else w[:1].upper() + w[1:])
    return " ".join(out).replace("Ufs", "UFS")

KIND = {"1": "U", "2": "O", "3": "O", "4": "IF", "5": "CEFET"}
ies = {}
with open(D / "MICRODADOS_ED_SUP_IES_2023.CSV", encoding="latin1", newline="") as fh:
    for r in csv.DictReader(fh, delimiter=";"):
        if r["TP_CATEGORIA_ADMINISTRATIVA"] != "1":  # 1 = pública federal
            continue
        ies[r["CO_IES"]] = {"s": r["SG_IES"].strip(), "n": title(r["NO_IES"].strip()), "k": KIND.get(r["TP_ORGANIZACAO_ACADEMICA"], "O"),
                            "u": r["SG_UF_IES"], "m": int(r["CO_MUNICIPIO_IES"] or 0), "cc": collections.Counter()}
print(f"IES públicas federais no Censo: {len(ies)}")
with open(D / "MICRODADOS_CADASTRO_CURSOS_2023.CSV", encoding="latin1", newline="") as fh:
    for r in csv.DictReader(fh, delimiter=";"):
        i = ies.get(r["CO_IES"])
        if i and r["TP_MODALIDADE_ENSINO"] == "1" and r["CO_MUNICIPIO"] in muns:  # só presencial (EAD não tem campus)
            i["cc"][int(r["CO_MUNICIPIO"])] += 1

out = []
for i in ies.values():
    cities = set(i["cc"]); 
    if i["m"] in {int(k) for k in muns}: cities.add(i["m"])
    sigla = i["s"] or re.sub(r"[^A-Z]", "", "".join(w[0] for w in i["n"].upper().split() if w.lower() not in SMALL))
    out.append({"s": sigla, "n": i["n"], "k": i["k"], "u": i["u"], "m": i["m"], "c": sorted(cities)})
# Campi que o Censo não traz (só ensino técnico, ou unidades novas) e que a ADUNIR pediu para constar. Sigla -> códigos IBGE do município.
# 1302702 = Manicoré (AM), 1303700 = Santo Antônio do Içá (AM). Cada inclusão vem de pedido registrado (caixa de contato, 03/11/2026).
CAMPI_EXTRAS = {"IFAM": [1302702, 1303700]}
for x in out:
    x["c"] = sorted(set(x["c"]) | set(CAMPI_EXTRAS.get(x["s"], [])))
out.sort(key=lambda x: (x["k"] != "U", x["s"]))
# siglas duplicadas: desambiguar com a UF
seen = collections.Counter(x["s"] for x in out)
for x in out:
    if seen[x["s"]] > 1: x["s"] = f'{x["s"]}-{x["u"]}'
(root / "public/data/ifes.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
kinds = collections.Counter(x["k"] for x in out)
print("tipos:", dict(kinds), "| total de campi (cidades):", sum(len(x["c"]) for x in out))
print("sem sigla no Censo (siglas geradas):", sum(1 for i in ies.values() if not i["s"]))
def show(sig):
    x = next((y for y in out if y["s"] == sig), None)
    print(f"  {sig}: {x['n']} ({x['u']}) {len(x['c'])} cidades -> " + ", ".join(muns[str(c)][0] for c in x["c"][:14]) if x else f"  {sig}: NÃO ENCONTRADA")
print("== conferência:")
for s in ("UNIR", "UFAC", "IFRO", "UFRR", "IFAC", "UFPA", "IFPA", "UNIFAP", "UFAM"): show(s)
