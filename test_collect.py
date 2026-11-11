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
            CREATE TABLE steps(task_id,id,parent,title,state,weight,started_at,finished_at,updated_at,eta,detail);
            INSERT INTO steps VALUES('ficticio','a',NULL,'Etapa fictícia','completed',1,NULL,NULL,NULL,NULL,NULL);""")
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
        self.assertEqual(tree["sections"][0]["modules"][0]["functions"][0]["percent"],30); self.assertEqual(tree["sections"][0]["modules"][0]["functions"][0]["note"],"99% stale")
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

class CurrentOperationalEvidenceTests(unittest.TestCase):
    def fixture(self, detail):
        task={"id":"admin-v2-progresso-arvore","state":"running","updated_at":"2026-11-11T01:37:56+00:00"}
        rows=[]
        for ident,parent,title in [("s-5",None,"Campanha"),("m-5.1","s-5","Lotes e envios"),("f-5.1.2","m-5.1","Preservar versões e histórico dos documentos")]:
            rows.append(dict(task_id=task['id'],id=ident,parent=parent,title=title,state='running',weight=1,detail=detail if ident=='f-5.1.2' else None))
        for i in range(4):rows.append(dict(task_id=task['id'],id='milestone-'+str(i),parent='f-5.1.2',title='Marco',state='completed' if i<3 else 'running',weight=25))
        return [task],rows
    def test_current_19http_ui_pending_evidence_and_weighted75(self):
        path='/mnt/apps/peticao-final/_ops/reviews/r0004/receipt.json'
        tasks,steps=self.fixture('75% mantidos;19HTTP integrados PG17 aprovados em f555. Prova visual autenticada pendente; '+path)
        tree=module.live_tree(tasks,steps);self.assertTrue(tree['available']);f=tree['sections'][0]['modules'][0]['functions'][0]
        self.assertEqual(f['percent'],75);self.assertEqual(tree['percent'],75);self.assertEqual(f['recorded_state'],'running');self.assertIn('19HTTP',f['note']);self.assertIn('visual autenticada pendente',f['note']);self.assertEqual(f['evidence'],[path])
        steps[2]['detail']='100% PRONTO; '+path;self.assertEqual(module.live_tree(tasks,steps)['percent'],75)
    def test_bounded_redacted_detail_and_literal_paths_without_file_access(self):
        from unittest import mock
        raw='nome@example.test senha=FAKEVALUE token=FAKETOKEN 123.456.789-09 <script>alert(1)</script> '+('x'*10000)
        clean=module.operational_detail(raw);self.assertLessEqual(len(clean),1500);self.assertNotIn('nome@example.test',clean);self.assertNotIn('FAKEVALUE',clean);self.assertNotIn('FAKETOKEN',clean);self.assertNotIn('123.456.789-09',clean)
        paths=' '.join('/mnt/apps/peticao-final/_ops/evidence-'+str(i)+'.json'for i in range(8))
        with mock.patch.object(Path,'read_text',side_effect=AssertionError('never follow evidence')),mock.patch.object(Path,'resolve',side_effect=AssertionError('never resolve evidence')):
            self.assertEqual(len(module.operational_evidence(paths)),4)
        self.assertEqual(module.operational_evidence('/mnt/apps/peticao-final/secrets/key.json /mnt/apps/peticao-final/../elsewhere /etc/passwd https://example.test/a'),[])
    def test_query_exports_no_other_task_detail(self):
        with tempfile.TemporaryDirectory()as tmp:
            path=Path(tmp)/'fixture.sqlite';db=sqlite3.connect(path)
            db.executescript("CREATE TABLE tasks(id,title,state,cwd,environment,scope,stage,eta,created_at,updated_at); CREATE TABLE steps(task_id,id,parent,title,state,weight,started_at,finished_at,updated_at,eta,detail);")
            for task_id in ['admin-v2-progresso-arvore','unrelated-private-task']:
                db.execute('INSERT INTO steps VALUES(?,?,?,?,?,?,?,?,?,?,?)',(task_id,'one',None,'one','running',1,None,None,None,None,'19HTTP pendente UI'if task_id=='admin-v2-progresso-arvore'else'PRIVATE MUST NOT BE EXPORTED'))
            db.commit();db.close();before=hashlib.sha256(path.read_bytes()).hexdigest();tasks,steps,workflow=module.query_monitor(path)
            self.assertEqual(steps[0]['detail'],'19HTTP pendente UI');self.assertEqual(steps[1]['detail'],'');self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),before)

class RendererIntegrationTests(unittest.TestCase):
    def test_read_only_collector_to_html_csv_text_retains75_current_evidence_and_escaping(self):
        import subprocess,os
        root=Path(__file__).parent
        with tempfile.TemporaryDirectory()as tmp:
            dbpath=Path(tmp)/'fixture.sqlite';db=sqlite3.connect(dbpath)
            db.executescript("CREATE TABLE tasks(id,title,state,cwd,environment,scope,stage,eta,created_at,updated_at); CREATE TABLE steps(task_id,id,parent,title,state,weight,started_at,finished_at,updated_at,eta,detail);")
            task='admin-v2-progresso-arvore';db.execute('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?)',(task,'Árvore','running','/fixture','fixture','fixture','fixture',None,'2026-11-11T01:37:56Z','2026-11-11T01:37:56Z'))
            evidence='/mnt/apps/peticao-final/_ops/reviews/r0004/receipt.json'
            detail='75% mantidos;19HTTP PG17 aprovados em f555. Prova visual autenticada pendente. '+evidence+' <img src=x onerror=evil()> fake@example.test token=FAKESECRET'
            for ident,parent,title,state,weight,value in [('s-5',None,'Campanha','running',1,None),('m-5.1','s-5','Lotes','running',1,None),('f-5.1.2','m-5.1','Histórico','running',1,detail)]+[('milestone-'+str(i),'f-5.1.2','Marco','completed' if i<3 else 'running',25,None)for i in range(4)]:
                db.execute('INSERT INTO steps VALUES(?,?,?,?,?,?,?,?,?,?,?)',(task,ident,parent,title,state,weight,None,None,None,None,value))
            db.commit();db.close();before=hashlib.sha256(dbpath.read_bytes()).hexdigest();tasks,steps,workflow=module.query_monitor(dbpath);tree=module.live_tree(tasks,steps);self.assertEqual(tree['percent'],75);self.assertEqual(hashlib.sha256(dbpath.read_bytes()).hexdigest(),before)
            fixture=Path(tmp)/'fixture.json';fixture.write_text(json.dumps({'active':True,'generated_at':'2026-11-11T01:40:00Z','tree':tree,'primary_tasks':[],'other_running':[],'paused_waiting':[],'git':{'unavailable':True},'qa':[],'normalization':[]}))
            script="""import assert from 'node:assert/strict';import fs from 'node:fs';import {renderReport} from %s;globalThis.fetch=()=>{throw Error('no network/mail permitted');};const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const result=renderReport(data);for(const output of [result.html,result.text,result.csv]){assert.ok(output.includes('19HTTP'));assert.ok(output.includes('visual autenticada pendente'));assert.ok(output.includes('/mnt/apps/peticao-final/_ops/reviews/r0004/receipt.json'));assert.ok(!output.includes('fake@example.test'));assert.ok(!output.includes('FAKESECRET'));}assert.ok(result.html.includes('75,0%%'));assert.ok(result.html.includes('&lt;img'));assert.ok(!result.html.includes('<img src=x'));assert.ok(result.html.includes('overflow-wrap:anywhere'));assert.ok(result.html.includes('font-size:13px'));assert.ok(!result.html.includes('<a href=\"/mnt/'));assert.ok(result.svg.includes('75,0%%'));console.log(JSON.stringify({collectorToRenderer:true,percent:75,htmlEscaped:true,pathsVisible:true,mail:false}));""" % json.dumps((root/'report.mjs').as_uri())
            result=subprocess.run(['/home/barre/.cache/peticao-qa-node20-20.19.2/node-v20.19.2-linux-x64/bin/node','--input-type=module','--eval',script,str(fixture)],env={'PATH':'/usr/bin:/bin','HOME':'/nonexistent','LANG':'C.UTF-8'},capture_output=True,text=True,timeout=15)
            self.assertEqual(result.returncode,0,result.stderr);self.assertTrue(json.loads(result.stdout)['collectorToRenderer'])
