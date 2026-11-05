#!/usr/bin/env bash
# Gera a base geográfica do painel (estados, centros dos municípios e países) em site/public/data/geo/. Rodar de novo só se mudar a fonte.
# Fontes: malha municipal do IBGE 2024 (.cache/ifes-fontes/raw/mun), Natural Earth (raw/ne.zip) e malha de UF do IBGE (API, qualidade mínima). Requer GDAL (ogr2ogr) e python3.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; RAW="$ROOT/.cache/ifes-fontes/raw"; OUT="$ROOT/site/public/data/geo"; TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"
# 1) centro de cada município (ponto dentro do polígono)
ogr2ogr -f CSV "$TMP/mun.csv" -dialect SQLite -sql "SELECT CD_MUN, ST_X(ST_PointOnSurface(geometry)) AS lon, ST_Y(ST_PointOnSurface(geometry)) AS lat FROM BR_Municipios_2024" "$RAW/mun/BR_Municipios_2024.shp"
# 2) países (nome em português e ponto de rótulo do Natural Earth)
unzip -o -q "$RAW/ne.zip" -d "$TMP/ne"
ogr2ogr -f CSV "$TMP/pais.csv" -sql "SELECT NAME_PT, NAME, ISO_A2, ISO_A2_EH, LABEL_X, LABEL_Y FROM ne_10m_admin_0_countries" "$TMP/ne/ne_10m_admin_0_countries.shp"
# 3) estados (IBGE)
curl -fsS -m 60 -o "$TMP/uf.json" "https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?intrarregiao=UF&qualidade=minima&formato=application/vnd.geo+json"
python3 - "$TMP" "$OUT" <<'PY'
import csv, json, sys
tmp, out = sys.argv[1], sys.argv[2]
mun = {r["CD_MUN"]: [round(float(r["lon"]), 4), round(float(r["lat"]), 4)] for r in csv.DictReader(open(f"{tmp}/mun.csv", encoding="utf-8"))}
json.dump(mun, open(f"{out}/municipios-centroides.json", "w"), separators=(",", ":"))
pais = {}
linhas = list(csv.DictReader(open(f"{tmp}/pais.csv", encoding="utf-8")))
# 1ª passada: países com código próprio (ISO_A2); 2ª: territórios sem ISO_A2 (usam ISO_A2_EH) SEM sobrescrever quem já tem o código (ex.: "Ilha Brasileira" não vira Brasil)
for passo in (1, 2):
    for r in linhas:
        iso = r["ISO_A2"]
        valido = iso not in ("-99", "")
        if passo == 1 and not valido: continue
        if passo == 2:
            if valido: continue
            iso = r["ISO_A2_EH"]
            if iso in ("-99", ""): continue
        if iso in pais: continue
        pais[iso] = {"n": r["NAME_PT"] or r["NAME"], "c": [round(float(r["LABEL_X"]), 3), round(float(r["LABEL_Y"]), 3)]}
json.dump(pais, open(f"{out}/paises.json", "w"), ensure_ascii=False, separators=(",", ":"))
UF = {"11":("RO","Rondônia"),"12":("AC","Acre"),"13":("AM","Amazonas"),"14":("RR","Roraima"),"15":("PA","Pará"),"16":("AP","Amapá"),"17":("TO","Tocantins"),"21":("MA","Maranhão"),"22":("PI","Piauí"),"23":("CE","Ceará"),"24":("RN","Rio Grande do Norte"),"25":("PB","Paraíba"),"26":("PE","Pernambuco"),"27":("AL","Alagoas"),"28":("SE","Sergipe"),"29":("BA","Bahia"),"31":("MG","Minas Gerais"),"32":("ES","Espírito Santo"),"33":("RJ","Rio de Janeiro"),"35":("SP","São Paulo"),"41":("PR","Paraná"),"42":("SC","Santa Catarina"),"43":("RS","Rio Grande do Sul"),"50":("MS","Mato Grosso do Sul"),"51":("MT","Mato Grosso"),"52":("GO","Goiás"),"53":("DF","Distrito Federal")}
g = json.load(open(f"{tmp}/uf.json"))
for f in g["features"]:
    s, n = UF[f["properties"]["codarea"]]; f["properties"] = {"sigla": s, "nome": n}
json.dump(g, open(f"{out}/estados.geojson", "w"), ensure_ascii=False, separators=(",", ":"))
print(f"municípios: {len(mun)} | países: {len(pais)} | estados: {len(g['features'])}")
PY
ls -la "$OUT" | awk '{print $5, $9}' | tail -4
