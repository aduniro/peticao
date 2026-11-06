import unittest
import unicodedata
import tempfile
import json
from pathlib import Path
from unittest.mock import patch
from name_dictionary import corpus, folded, resolve, significant, suggest


class NameDictionaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict("os.environ", {"CPF_REVIEW_DATA_DIR": self.temp.name})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def test_local_observations_alternatives_not_automatic_accent(self):
        Path(self.temp.name, "name-observations.json").write_text(json.dumps({"entries": [{"form": "Xyźana", "count": 999}]}))
        r = resolve("Xyzana")
        self.assertEqual(r["name"], "Xyzana")
        self.assertIn("Xyźana", r["details"][0]["variants"])
        self.assertIn("local-observed", r["details"][0]["sources"])

    def test_observations_change_dictionary_digest(self):
        before = corpus()[2]
        Path(self.temp.name, "name-observations.json").write_text(json.dumps({"entries": [{"form": "Xyźana", "count": 1}]}))
        self.assertNotEqual(before, corpus()[2])

    def test_observations_never_override_curated_default(self):
        Path(self.temp.name, "name-observations.json").write_text(json.dumps({"entries": [{"form": "Mònicá", "count": 999}]}))
        self.assertEqual(resolve("MONICA")["name"], "Mônica")

    def test_invalid_observation_full_name_not_imported(self):
        Path(self.temp.name, "name-observations.json").write_text(json.dumps({"entries": [{"form": "Nome Completo", "count": 2}]}))
        self.assertNotIn("nome completo", corpus()[1])

    def test_brazilian_curated_suggestions(self):
        s = suggest({"name": "JOSE ANTONIO GONCALVES", "nome_api": "JOSE ANTONIO GONCALVES"})
        self.assertEqual(s["proposed"], "José Antônio Gonçalves")
        self.assertFalse(s["special"])
        self.assertTrue(s["requires_approval"])

    def test_valid_supplied_portuguese_variant_survives(self):
        s = suggest({"name": "António Gonçalves", "nome_api": "ANTONIO GONCALVES"})
        self.assertEqual(s["entered_resolved"], "António Gonçalves")
        self.assertEqual(s["api_resolved"], "António Gonçalves")

    def test_probable_typo_is_only_suggestion(self):
        original = {"name": "Rogêrio Silva", "nome_api": "ROGERIO SILVA"}
        before = dict(original)
        s = suggest(original)
        self.assertEqual(s["entered_resolved"], "Rogério Silva")
        self.assertEqual(s["api_resolved"], "Rogério Silva")
        self.assertEqual(original, before)
        self.assertIn("probable_accent_error", [d["status"] for d in s["entered_analysis"]])

    def test_unknown_accented_spelling_is_preserved_and_flagged(self):
        r = resolve("Xyźana Silva")
        self.assertEqual(r["name"], "Xyźana Silva")
        self.assertEqual(r["details"][0]["status"], "supplied_uncorroborated")

    def test_unicode_nfc(self):
        s = suggest({"name": unicodedata.normalize("NFD", "José Araújo"), "nome_api": "JOSE ARAUJO"})
        self.assertEqual(s["proposed"], "José Araújo")
        self.assertTrue(unicodedata.is_normalized("NFC", s["proposed"]))

    def test_special_larger_entered_kept_whole(self):
        s = suggest({"name": "Ana Silva Costa", "nome_api": "ANA SILVA"})
        self.assertTrue(s["special"])
        self.assertEqual(s["proposed"], "Ana Silva Costa")

    def test_complete_api_name_fills_user_omissions(self):
        s = suggest({"name": "Ana Silva", "nome_api": "ANA SILVA COSTA"})
        self.assertFalse(s["special"])
        self.assertEqual(s["proposed"], "Ana Silva Costa")

    def test_equal_word_count_prefers_complete_api_name(self):
        s = suggest({"name": "Ana Sá", "nome_api": "ANA ALBUQUERQUE"})
        self.assertEqual(s["proposed"], "Ana Albuquerque")
        self.assertTrue(s["special"])

    def test_particles_do_not_increase_completeness(self):
        s = suggest({"name": "Ana de Sá", "nome_api": "ANA SA"})
        self.assertFalse(s["special"])
        self.assertEqual(s["proposed"], "Ana de Sá")

    def test_wrong_order_is_special(self):
        self.assertTrue(suggest({"name": "Silva José", "nome_api": "JOSE SILVA"})["special"])

    def test_apostrophe_never_changes_letters(self):
        s = suggest({"name": "Ana D'ALLGNOL", "nome_api": "ANA DALLAGNOL"})
        self.assertIn("D'Allgnol", s["entered_resolved"])
        self.assertTrue(s["special"])
        self.assertNotIn("Dall'Agnol", s["alternatives"])

    def test_curly_apostrophe_same_word_key(self):
        self.assertEqual(folded("D’Ávila"), folded("D'Avila"))

    def test_compound_names_remain_whole(self):
        s = suggest({"name": "Maria José de Sá", "nome_api": "MARIA JOSE DE SA"})
        self.assertEqual(s["proposed"], "Maria José de Sá")
        self.assertFalse(s["special"])

    def test_european_accents_and_special_letters_preserved(self):
        for name in ["Jiří Růžička", "Łukasz Dąbrowski", "Søren Mäkelä", "Seán Ó Sé", "Guðni Jóhannesson", "Ștefan Kovač", "Ľudovít Štúr"]:
            self.assertEqual(resolve(name)["name"], name)

    def test_distinct_letters_not_treated_as_combining_accents(self):
        self.assertNotEqual(folded("Łukasz"), folded("Lukasz"))
        self.assertNotEqual(folded("Søren"), folded("Soren"))
        self.assertNotEqual(folded("Weiß"), folded("Weiss"))

    def test_no_api_is_not_identity_approval(self):
        s = suggest({"name": "JOSE SILVA"})
        self.assertEqual(s["api_resolved"], "")
        self.assertTrue(s["requires_approval"])
        self.assertNotIn("approved", s)

    def test_no_fabricated_merge_of_surnames(self):
        s = suggest({"name": "Ana Costa", "nome_api": "ANA SILVA"})
        self.assertEqual(s["proposed"], "Ana Silva")
        self.assertNotIn("Ana Costa Silva", s["alternatives"])

    def test_ambiguous_variants_visible(self):
        r = resolve("Monica")
        self.assertEqual(r["name"], "Mônica")
        self.assertIn("Mónica", r["details"][0]["variants"])

    def test_marquess_is_not_automatic_surname_accent(self):
        self.assertEqual(resolve("Marques Coelho Macedo")["name"], "Marques Coelho Macedo")
        self.assertEqual(resolve("Marquês Coêlho Macêdo")["name"], "Marquês Coêlho Macêdo")

    def test_corpus_has_provenance_and_content_version(self):
        d, index, version = corpus()
        self.assertGreater(len(d["entries"]), 400)
        for e in d["entries"]:
            self.assertIn(e["source"], d["sources"])
        self.assertIn(":", version)
        self.assertEqual(significant("José de Sá"), ["jose", "sa"])


if __name__ == "__main__":
    unittest.main()
