import json
import hashlib
import importlib.util
import sqlite3
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("report_collect", Path(__file__).with_name("collect.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CollectorTests(unittest.TestCase):
    def test_weighted_leaf_progress(self):
        steps = [{"id": "parent", "parent": None, "state": "running", "weight": 99}, {"id": "a", "parent": "parent", "state": "completed", "weight": 40}, {"id": "b", "parent": "parent", "state": "running", "weight": 60}]
        self.assertEqual(module.percentage(steps), 40)
        self.assertIsNone(module.percentage([]))

    def test_monitor_read_preserves_fixture_database(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "monitor.sqlite"
            c = sqlite3.connect(path)
            c.executescript("""CREATE TABLE tasks(id,title,state,cwd,environment,scope,stage,eta,created_at,updated_at);
            INSERT INTO tasks VALUES('ficticio','Tarefa fictícia','running','/tmp','ficticio','teste','testando',NULL,NULL,NULL);
            CREATE TABLE steps(task_id,id,parent,title,state,weight,started_at,finished_at,updated_at,eta);
            INSERT INTO steps VALUES('ficticio','a',NULL,'Etapa fictícia','completed',1,NULL,NULL,NULL,NULL);""")
            c.close()
            before = hashlib.sha256(path.read_bytes()).hexdigest()
            tasks, steps, workflow = module.query_monitor(path)
            self.assertEqual(tasks[0]["id"], "ficticio")
            self.assertEqual(len(steps), 1)
            self.assertEqual(workflow, [])
            self.assertEqual(before, hashlib.sha256(path.read_bytes()).hexdigest())
            readonly = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
            try:
                with self.assertRaises(sqlite3.OperationalError):
                    readonly.execute("DELETE FROM tasks")
            finally:
                readonly.close()

    def test_tree_recomputes_milestones_and_overlays_recorded_state_only(self):
        with tempfile.TemporaryDirectory() as directory:
            old = module.PROJECT
            try:
                module.PROJECT = Path(directory)
                folder = module.PROJECT / ".cache/admin-v2-retomada-20261109/snapshot"
                folder.mkdir(parents=True)
                snapshot = {"commit": "a" * 40, "at": "2026-11-09T12:00:00Z", "method": "four milestones", "percent": 99, "sections": [{"id": "5", "title": "Campanha", "modules": [{"id": "5.2", "title": "Presidente", "functions": [{"id": "5.2.3", "title": "Confirmação", "percent": 100, "criteria": {"a": True, "b": False, "c": True, "d": False}, "state": "em execução"}]}]}]}
                (folder / "progresso.json").write_text(json.dumps(snapshot))
                pointer = Path(directory) / "latest.txt"; pointer.write_text(str(folder))
                steps = [{"task_id": "admin-v2-progresso-arvore", "id": "f-5.2.3", "state": "running"}]
                tasks = [{"id": "admin-v2-progresso-arvore", "updated_at": "2020-01-01T00:00:00Z", "state": "running"}]
                result = module.read_tree(pointer, tasks, steps)
                self.assertTrue(result["available"])
                self.assertEqual(result["percent"], 50)
                self.assertEqual(result["sections"][0]["state"], "em execução registrada")
                self.assertTrue(result["recorded_stale"])
                historical = module.read_tree(pointer, [], [])
                self.assertEqual(historical["sections"][0]["state"], "parado")
            finally:
                module.PROJECT = old

    def test_tree_rejects_outside_pointer_and_unavailable_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            pointer = Path(directory) / "latest.txt"
            pointer.write_text(directory)
            self.assertFalse(module.read_tree(pointer, [], [])["available"])
            self.assertFalse(module.read_tree(Path(directory) / "missing", [], [])["available"])




class LiveTreeTests(unittest.TestCase):
    def test_live_tree_uses_weighted_current_leaves_not_stale_text_or_snapshot(self):
        rows = [
            {"task_id":"admin-v2-progresso-arvore","id":"s-1","parent":None,"title":"Seção","state":"running","weight":1},
            {"task_id":"admin-v2-progresso-arvore","id":"m-1.1","parent":"s-1","title":"Módulo","state":"running","weight":1},
            {"task_id":"admin-v2-progresso-arvore","id":"f-1.1.1","parent":"m-1.1","title":"Função","state":"running","weight":1,"detail":"99% stale"},
            {"task_id":"admin-v2-progresso-arvore","id":"a","parent":"f-1.1.1","title":"Marco A","state":"completed","weight":30},
            {"task_id":"admin-v2-progresso-arvore","id":"b","parent":"f-1.1.1","title":"Marco B","state":"queued","weight":70},
        ]
        task={"id":"admin-v2-progresso-arvore","state":"running","updated_at":"2026-11-10T12:00:00Z"}
        tree=module.live_tree([task],rows)
        self.assertTrue(tree["available"])
        self.assertEqual(tree["source"],"vigia_sqlite_read_only")
        self.assertEqual(tree["percent"],30)
        self.assertEqual(tree["sections"][0]["modules"][0]["functions"][0]["percent"],30)
        self.assertNotIn("99%",json.dumps(tree))
        rows[-1]["state"]="completed"
        current=module.live_tree([task],rows)
        self.assertEqual(current["percent"],100)
        self.assertEqual(current["sections"][0]["state"],"concluído localmente")

    def test_live_tree_rejects_missing_parent_or_cycle_without_snapshot_fallback(self):
        self.assertFalse(module.live_tree([],[])["available"])
        rows=[{"id":"s-1","task_id":"admin-v2-progresso-arvore","parent":"missing","title":"Broken","state":"running","weight":1}]
        self.assertFalse(module.live_tree([],rows)["available"])
        with self.assertRaises(ValueError):
            module.progress_index([{"id":"a","parent":"b","weight":1,"state":"running"},{"id":"b","parent":"a","weight":1,"state":"running"}])

if __name__ == "__main__":
    unittest.main()
