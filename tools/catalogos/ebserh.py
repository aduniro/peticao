#!/usr/bin/env python3
"""Build a standalone public EBSERH catalogue. Never connects to application DBs."""
from pathlib import Path
import argparse
import csv
import hashlib
import html
import json
import sqlite3
import tempfile
import os

ROOT = Path(__file__).resolve().parents[2]
PREFIXES = {"RO":"11","AC":"12","AM":"13","RR":"14","PA":"15","AP":"16","TO":"17",
            "MA":"21","PI":"22","CE":"23","RN":"24","PB":"25","PE":"26","AL":"27","SE":"28","BA":"29",
            "MG":"31","ES":"32","RJ":"33","SP":"35","PR":"41","SC":"42","RS":"43","MS":"50","MT":"51","GO":"52","DF":"53"}
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def enrich(seed, municipalities, coordinates):
    lookup = {(name, uf): str(code) for code, name, uf in municipalities}
    ids = {row["id"] for row in seed["unidades"]}
    assert len(ids) == len(seed["unidades"]), "Duplicate unit ID"
    rows = []
    for item in seed["unidades"]:
        row = dict(item)
        key = (row["municipio"], row["uf"])
        assert key in lookup, f"Municipality not found: {key}"
        code = lookup[key]
        assert code.startswith(PREFIXES[row["uf"]]), f"IBGE/UF mismatch: {key}"
        assert code in coordinates, f"Missing map coordinates: {key}"
        lon, lat = coordinates[code]
        assert -74 < lon < -34 and -34 < lat < 6, f"Invalid Brazilian coordinates: {key}"
        assert row["parent_id"] is None or row["parent_id"] in ids, "Orphan component"
        assert not row["conta_hospital"] or row["situacao"] == "rede_atual", "Project counted as hospital"
        assert row["tipo"] != "complexo" or not row["conta_hospital"], "Complex counted twice"
        row.update(ibge=code, longitude=lon, latitude=lat,
                   nivel_geocodificacao="municipio",
                   metodo_geocodificacao="ST_PointOnSurface — malha municipal IBGE 2024; ponto interior municipal",
                   data_referencia=seed["metadata"]["data_referencia"])
        rows.append(row)
    assert sum(r["conta_hospital"] for r in rows) == seed["metadata"]["total_rede_informado"]
    return rows

def build(output, root=ROOT):
    output = Path(output)
    if output.exists():
        raise FileExistsError(f"Destination already exists; preserving it: {output}")
    seed_path = root / "data/ebserh/unidades-20261108.json"
    mun_path = root / "site/public/data/municipios.json"
    geo_path = root / "site/public/data/geo/municipios-centroides.json"
    seed = json.loads(seed_path.read_text())
    rows = enrich(seed, json.loads(mun_path.read_text()), json.loads(geo_path.read_text()))
    output.parent.mkdir(parents=True, exist_ok=True)
    scratch = Path(tempfile.mkdtemp(prefix=".ebserh-", dir=output.parent))
    try:
        db = sqlite3.connect(scratch / "catalogo.sqlite")
        db.execute("PRAGMA foreign_keys=ON")
        db.executescript("""
        CREATE TABLE organizacoes(id TEXT PRIMARY KEY,nome TEXT NOT NULL,sigla TEXT NOT NULL,marca TEXT NOT NULL);
        CREATE TABLE dominios(domain TEXT PRIMARY KEY,organizacao_id TEXT NOT NULL REFERENCES organizacoes(id),escopo TEXT NOT NULL);
        CREATE TABLE municipios(ibge TEXT PRIMARY KEY CHECK(length(ibge)=7),nome TEXT NOT NULL,uf TEXT NOT NULL,
          latitude REAL NOT NULL CHECK(latitude BETWEEN -34 AND 6),longitude REAL NOT NULL CHECK(longitude BETWEEN -74 AND -34),
          nivel TEXT NOT NULL CHECK(nivel='municipio'),metodo TEXT NOT NULL,fonte TEXT NOT NULL);
        CREATE TABLE fontes(url TEXT PRIMARY KEY,consultado_em TEXT NOT NULL);
        CREATE TABLE unidades(id TEXT PRIMARY KEY,organizacao_id TEXT NOT NULL REFERENCES organizacoes(id),
          sigla TEXT NOT NULL,nome TEXT NOT NULL,universidade TEXT,ibge TEXT NOT NULL REFERENCES municipios(ibge),
          regiao TEXT NOT NULL,tipo TEXT NOT NULL CHECK(tipo IN ('sede','complexo','hospital','hospital_componente','unidade_fisica')),
          parent_id TEXT REFERENCES unidades(id),situacao TEXT NOT NULL CHECK(situacao IN ('rede_atual','administracao','em_construcao','nao_confirmado')),
          conta_hospital INTEGER NOT NULL CHECK(conta_hospital IN (0,1)),lista_usuario INTEGER NOT NULL CHECK(lista_usuario IN (0,1)),
          fonte TEXT NOT NULL REFERENCES fontes(url),observacao TEXT NOT NULL,data_referencia TEXT NOT NULL,
          CHECK(conta_hospital=0 OR situacao='rede_atual'),CHECK(tipo!='complexo' OR conta_hospital=0));
        CREATE TABLE metadados(chave TEXT PRIMARY KEY,valor TEXT NOT NULL);
        CREATE VIEW catalogo_completo AS
          SELECT u.*,m.nome municipio,m.uf,m.latitude,m.longitude,m.nivel nivel_geocodificacao,m.metodo metodo_geocodificacao
          FROM unidades u JOIN municipios m USING(ibge);
        CREATE VIEW hospitais_rede AS SELECT * FROM catalogo_completo WHERE conta_hospital=1;
        CREATE VIEW pendencias AS SELECT * FROM catalogo_completo WHERE situacao IN ('em_construcao','nao_confirmado');
        CREATE VIEW mapa_municipios AS SELECT ibge,municipio,uf,latitude,longitude,COUNT(*) hospitais
          FROM hospitais_rede GROUP BY ibge,municipio,uf,latitude,longitude;
        """)
        meta = seed["metadata"]
        db.execute("INSERT INTO organizacoes VALUES(?,?,?,?)", ("ebserh",meta["organizacao"],meta["sigla"],meta["marca_atual"]))
        db.executemany("INSERT INTO dominios VALUES(?,?,?)", [(d,"ebserh","servidor_excecao_exata") for d in meta["dominios"]])
        geo_source = "https://www.ibge.gov.br/geociencias/organizacao-do-territorio/malhas-territoriais/15774-malhas.html"
        for row in rows:
            db.execute("INSERT OR IGNORE INTO municipios VALUES(?,?,?,?,?,?,?,?)",
                       (row["ibge"],row["municipio"],row["uf"],row["latitude"],row["longitude"],row["nivel_geocodificacao"],row["metodo_geocodificacao"],geo_source))
            db.execute("INSERT OR IGNORE INTO fontes VALUES(?,?)", (row["fonte"],meta["data_referencia"]))
        for row in rows:
            db.execute("INSERT INTO unidades VALUES("+",".join("?" for _ in range(15))+")",
                       (row["id"],"ebserh",row["sigla"],row["nome"],row["universidade"],row["ibge"],row["regiao"],row["tipo"],
                        row["parent_id"],row["situacao"],int(row["conta_hospital"]),int(row["lista_usuario"]),row["fonte"],row["observacao"],row["data_referencia"]))
        for key, value in meta.items():
            db.execute("INSERT INTO metadados VALUES(?,?)",(key,json.dumps(value,ensure_ascii=False)))
        db.commit()
        assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
        (scratch / "catalogo.sql").write_text("\n".join(db.iterdump())+"\n")
        db.close()
        fields = list(rows[0])
        with (scratch / "catalogo.csv").open("w",newline="",encoding="utf-8-sig") as f:
            writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader();writer.writerows(rows)
        features=[dict(type="Feature",geometry=dict(type="Point",coordinates=[r["longitude"],r["latitude"]]),
                       properties={k:v for k,v in r.items() if k not in ("longitude","latitude")}) for r in rows if r["conta_hospital"]]
        (scratch/"hospitais.geojson").write_text(json.dumps(dict(type="FeatureCollection",features=features),ensure_ascii=False)+"\n")
        headers=["Sigla","Unidade","Município","UF","Tipo","Situação","Conta hospital?","Fonte"]
        body="".join("<tr>"+"".join(f"<td>{html.escape(str(v))}</td>" for v in [r["sigla"],r["nome"],r["municipio"],r["uf"],r["tipo"],r["situacao"],"sim" if r["conta_hospital"] else "não"])+
                     f'<td><a href="{html.escape(r["fonte"],quote=True)}">Fonte oficial</a></td></tr>' for r in rows)
        (scratch/"catalogo.html").write_text('<!doctype html><html lang="pt-br"><meta charset="utf-8"><title>Catálogo EBSERH</title>'
          '<style>body{font:16px system-ui;margin:2rem;color:#19312b}table{border-collapse:collapse;width:100%}td,th{padding:.6rem;border:1px solid #ccc;text-align:left}th{background:#e8f1ed;position:sticky;top:0}tr:nth-child(even){background:#f6f8f7}input{padding:.7rem;width:90%;margin:1rem 0}</style>'
          '<h1>EBSERH / HU Brasil — catálogo de 08/11/2026</h1><p>47 hospitais, 42 portais de gestão; 58 registros incluindo sede, complexos, unidades físicas e pendências. Coordenadas municipais, não endereços hospitalares. HU-UFCA em construção; HU-UFSB não confirmado.</p>'
          '<input id="busca" placeholder="Filtrar a tabela" aria-label="Filtrar a tabela"><table><thead><tr>'+
          "".join(f"<th>{h}</th>" for h in headers)+'</tr></thead><tbody>'+body+'</tbody></table><script>document.getElementById("busca").oninput=function(){const q=this.value.toLocaleLowerCase();document.querySelectorAll("tbody tr").forEach(r=>r.hidden=!r.textContent.toLocaleLowerCase().includes(q))}</script></html>')
        manifest={"inputs":{str(p.relative_to(root)):digest(p) for p in [seed_path,mun_path,geo_path]},
                  "files":{p.name:digest(p) for p in scratch.iterdir()},"registros":len(rows),"hospitais":len(features)}
        (scratch/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n")
        # Publication is local and refuses to replace any pre-existing catalogue.
        if output.exists(): raise FileExistsError(output)
        os.rename(scratch,output)
        return manifest
    except Exception:
        import shutil
        shutil.rmtree(scratch)
        raise

if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output",type=Path,required=True)
    args=parser.parse_args()
    print(json.dumps(build(args.output),ensure_ascii=False,indent=2))
