import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest
import json

spec=importlib.util.spec_from_file_location("ebserh",Path(__file__).with_name("ebserh.py"))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class CatalogueTests(unittest.TestCase):
    def test_database_exports_geocoding_and_rebuild_preserve_existing(self):
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp)/"resultados"
            manifest=module.build(out)
            self.assertEqual(manifest["registros"],58)
            self.assertEqual(manifest["hospitais"],47)
            db=sqlite3.connect(out/"catalogo.sqlite")
            self.assertEqual(db.execute("PRAGMA integrity_check").fetchone()[0],"ok")
            self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(),[])
            self.assertEqual(db.execute("SELECT count(*) FROM hospitais_rede").fetchone()[0],47)
            self.assertEqual(db.execute("SELECT count(DISTINCT uf) FROM hospitais_rede").fetchone()[0],25)
            self.assertEqual(db.execute("SELECT municipio,uf FROM catalogo_completo WHERE id='hu-ufsj'").fetchone(),("Divinópolis","MG"))
            self.assertEqual(db.execute("SELECT situacao,conta_hospital FROM unidades WHERE id='hu-ufca'").fetchone(),("em_construcao",0))
            self.assertEqual(db.execute("SELECT situacao,conta_hospital FROM unidades WHERE id='hu-ufsb-nao-confirmado'").fetchone(),("nao_confirmado",0))
            self.assertEqual(db.execute("SELECT sum(hospitais) FROM mapa_municipios").fetchone()[0],47)
            self.assertEqual(db.execute("SELECT count(*) FROM dominios").fetchone()[0],2)
            restored=sqlite3.connect(":memory:")
            restored.executescript((out/"catalogo.sql").read_text())
            self.assertEqual(restored.execute("SELECT * FROM catalogo_completo ORDER BY id").fetchall(),
                             db.execute("SELECT * FROM catalogo_completo ORDER BY id").fetchall())
            geo=json.loads((out/"hospitais.geojson").read_text())
            self.assertEqual(len(geo["features"]),47)
            for f in geo["features"]:
                self.assertEqual(f["properties"]["nivel_geocodificacao"],"municipio")
            before=(out/"catalogo.sqlite").read_bytes()
            with self.assertRaises(FileExistsError):module.build(out)
            self.assertEqual((out/"catalogo.sqlite").read_bytes(),before)
            for name,sha in manifest["files"].items():self.assertEqual(module.digest(out/name),sha)
            restored.close();db.close()

    def test_missing_city_and_bad_coordinate_fail_closed(self):
        seed={"metadata":{"total_rede_informado":1,"data_referencia":"2026-11-08"},"unidades":[{
            "id":"a","municipio":"Teste","uf":"RO","parent_id":None,"conta_hospital":True,"situacao":"rede_atual","tipo":"hospital"}]}
        with self.assertRaisesRegex(AssertionError,"Municipality"):module.enrich(seed,[],{})
        with self.assertRaisesRegex(AssertionError,"IBGE/UF"):module.enrich(seed,[[5300108,"Teste","RO"]],{})
        with self.assertRaisesRegex(AssertionError,"Invalid Brazilian"):module.enrich(seed,[[1100205,"Teste","RO"]],{"1100205":[12,45]})

if __name__=="__main__":unittest.main()
