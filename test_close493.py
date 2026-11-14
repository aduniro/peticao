"""Fictitious expired lease493 in a temporary canonical-schema database only."""
import copy
import datetime
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
import close493 as c

spec = importlib.util.spec_from_file_location('close493_test_coord',
    '/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py')
coord = importlib.util.module_from_spec(spec)
spec.loader.exec_module(coord)


class ClosureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='test-close493-', dir=Path(__file__).parent)
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.ledger = coord.Ledger(self.base / 'test.sqlite')
        for actor in [c.ACTOR, 'apoio', 'executor61']:
            self.ledger.register(actor, c.ROOT_THREAD if actor == c.ACTOR else 'fictitious', [])
        self.db = sqlite3.connect(self.ledger.path, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.addCleanup(self.db.close)
        self.cap = {'actor': c.ACTOR, 'lease': c.LEASE, 'fence':493, 'token':'fictitious-private-owner',
                    'manifestSha256':c.MANIFEST, 'manifestEvent':2685, 'seq':2689}
        self.db.execute('INSERT INTO leases VALUES(?,?,?,?,?,?,?,?,?)',
            (c.LEASE,c.ACTOR,self.cap['token'],493,'uncertain',c.EXPIRES,'deploy',c.encode(c.RESOURCES),'fictitious'))
        self.db.execute('INSERT INTO leases VALUES(?,?,?,?,?,?,?,?,?)',
            ('OTHER','apoio','fictitious-other-private',494,'active',c.EXPIRES+9999,'edit','["coord:other"]','fictitious'))
        for seq,kind in [(2689,'lease_acquired'),(2690,'r1_scoped_acquired'),(2691,'lease_uncertain')]:
            data={'lease':c.LEASE,'fence':493,'operationId':c.OPERATION,'manifestSha256':c.MANIFEST,
                  'expires':c.EXPIRES,'manifest_event':2685}
            self.db.execute('INSERT INTO events VALUES(?,?,?,?,?,?,?,?)',
                (seq,'fictitious',c.ACTOR,kind,'fictitious',c.encode(data),c.encode(c.RESOURCES),0))
        self.post={'ok':True,'fence':493,'manifestSha256':c.MANIFEST,'image':c.IMAGE,'sourceCommit':c.SOURCE,
                   'productionSchemaChanged':False,'databaseRestored':False,'rollbackNeeded':False,
                   'publicPidPreserved':True,'configHashesPreserved':True,
                   'productionSchemaVerifiedByOperator':c.SCHEMA,'at':'2026-11-14T13:19:08+00:00',
                   'steps':{step:{'fence':493,'at':c.CREATED+index*20} for index,step in
                            enumerate(['preflight','switch','verify'],1)}}
        self.now=c.EXPIRES+600
        self.live={'observedAt':self.now-1,'manifestSha256':c.MANIFEST,'image':c.IMAGE,'sourceCommit':c.SOURCE,
                   'noActivePublication':True,'noActiveDispatch':True,'pendingIntents':[],
                   'schemaSha256':c.SCHEMA,'configHashesPreserved':True,
                   'http':[{'url':u,'status':200} for u in ['http://127.0.0.1:3001/api/internal/ready',
                       'http://127.0.0.1:3001/admin','http://127.0.0.1:3000/','http://127.0.0.1:3000/admin']],
                   'journals':{step:{'state':'complete','step':step,'fence':493,'manifestSha256':c.MANIFEST,
                                    'at':c.CREATED+i*20,'completedAt':c.CREATED+i*20+1}
                               for i,step in enumerate(['preflight','switch','verify'],1)}}
        self.journals=self.live.pop('journals')
        self.live.update(remoteState={'manifestSha256':c.MANIFEST,'completed':self.post['steps']},
                         schemaOK=True,localJournals={step:{k:v[k] for k in ['state','at','completedAt']}
                             for step,v in self.journals.items()})
        self.health={'at':datetime.datetime.fromtimestamp(self.now-1,datetime.timezone.utc).isoformat(),
                     'image':c.IMAGE,'remoteState':copy.deepcopy(self.live['remoteState']),
                     'configPreserved':True,'publicPIDPreserved':True,'noNewProductionOperation':True,
                     'http':self.live.pop('http')}
        self.binding={'scope':'CLOSE-LEASE493-METADATA-ONLY','operationId':c.OPERATION,'leaseId':c.LEASE,
                      'fence':493,'actor':c.ACTOR,'manifestSha256':c.MANIFEST,'image':c.IMAGE,
                      'helperSha256':c.sha(Path(c.__file__).read_bytes())}
        self.rebind()

    def rebind(self):
        for field,obj in [('postProof',self.post),('liveProof',self.live),('httpConfigProof',self.health)]:
            p=self.base/(field+'.json');p.write_text(json.dumps(obj))
            self.binding[field]={'path':str(p),'sha256':c.sha(p.read_bytes())}
        self.binding['localJournals']={}
        for step,obj in self.journals.items():
            p=self.base/(step+'-journal.json');p.write_text(json.dumps(obj))
            self.binding['localJournals'][step]={'path':str(p),'sha256':c.sha(p.read_bytes())}
        self.attestations={actor:{'actor':actor,'decision':'pass','purpose':'r1-close-lease493',
                                  'binding':copy.deepcopy(self.binding)} for actor in [c.ACTOR,'apoio']}

    def run_close(self,apply=False,**kw):
        return c.close(self.db,self.binding,self.cap,self.attestations,now=self.now,apply=apply,
             executor_session=c.ROOT_THREAD,intent=self.base/'intent.private.json',**kw)

    def test_default_dryrun_does_not_write_or_create_intent(self):
        before=c.protected(self.db)
        r=self.run_close()
        self.assertFalse(r['applied'])
        self.assertEqual(c.protected(self.db),before)
        self.assertFalse((self.base/'intent.private.json').exists())
        self.assertEqual(self.db.execute('SELECT state FROM leases WHERE fence=493').fetchone()[0],'uncertain')

    def test_only_exact_state_and_one_honest_event_change(self):
        before=c.protected(self.db)
        old=dict(self.db.execute('SELECT * FROM leases WHERE fence=493').fetchone())
        r=self.run_close(True)
        self.assertTrue(r['applied'])
        new=dict(self.db.execute('SELECT * FROM leases WHERE fence=493').fetchone())
        self.assertEqual(new,dict(old,state='reconciled'))
        after=c.protected(self.db)
        event=after['events'].pop()
        self.assertEqual(after,before)
        self.assertEqual(event['kind'],'r1_lease493_reconciled_scoped')
        self.assertIs(json.loads(event['data'])['normalResolutionConfirmed'],False)
        self.assertNotIn(self.cap['token'],json.dumps(r)+event['data'])
        with self.assertRaises(RuntimeError):self.run_close(True)

    def test_pins_identity_and_old_review_rejected(self):
        for field,value in [('fence',492),('leaseId','OTHER'),('operationId','NEON'),
                            ('manifestSha256','f'*64),('image','wrong'),('helperSha256','f'*64)]:
            old=self.binding[field];self.binding[field]=value
            with self.assertRaises(RuntimeError):self.run_close()
            self.binding[field]=old
        for actor in self.attestations:
            self.attestations[actor]['purpose']='r1-scoped-acquire'
        with self.assertRaises(RuntimeError):self.run_close()

    def test_missing_peer_and_capability_token_mismatch_rejected(self):
        old=self.attestations.pop('apoio')
        with self.assertRaises(RuntimeError):self.run_close()
        self.attestations['apoio']=old;self.cap['token']='wrong'
        with self.assertRaises(RuntimeError):self.run_close()

    def test_active_reconciled_and_wrong_fence_rows_rejected(self):
        for state in ['active','released','reconciled']:
            self.db.execute('UPDATE leases SET state=? WHERE fence=493',(state,))
            with self.assertRaises(RuntimeError):self.run_close()

    def test_step_and_postproof_outside_original_ttl_rejected(self):
        self.post['steps']['verify']['at']=c.EXPIRES+1;self.rebind()
        with self.assertRaisesRegex(RuntimeError,'outside_original_ttl'):self.run_close()
        self.post['steps']['verify']['at']=c.CREATED+60
        self.post['at']='2026-11-14T13:23:00+00:00';self.rebind()
        with self.assertRaisesRegex(RuntimeError,'postproof_sequence_or_ttl'):self.run_close()

    def test_fresh_proof_inflight_or_incomplete_journals_rejected(self):
        original=copy.deepcopy(self.live)
        for field,value in [('observedAt',self.now-901),('noActivePublication',False),
                            ('noActiveDispatch',False)]:
            self.live=copy.deepcopy(original);self.live[field]=value;self.rebind()
            with self.assertRaises(RuntimeError):self.run_close()
        self.live=copy.deepcopy(original);self.live['remoteState']['intent']={'step':'switch'};self.rebind()
        with self.assertRaises(RuntimeError):self.run_close()
        self.live=original;self.live['localJournals']['switch']['state']='intent';self.rebind()
        with self.assertRaises(RuntimeError):self.run_close()

    def test_existing_resolution_and_extra_actor_rejected(self):
        self.db.execute('INSERT INTO resolutions VALUES(?,?,?,?,?,?)',
            ('old',c.LEASE,'completed','fictitious','fictitious','pending'))
        with self.assertRaisesRegex(RuntimeError,'existing_normal_resolution'):self.run_close()
        self.db.execute('DELETE FROM resolutions')
        self.ledger.register('unexpected','fictitious',[])
        with self.assertRaisesRegex(RuntimeError,'actor_projection_drift'):self.run_close()

    def test_global_side_effect_rolls_back(self):
        self.db.execute("CREATE TRIGGER forbidden_change AFTER UPDATE ON leases BEGIN DELETE FROM acks; UPDATE leases SET expires=0 WHERE id='OTHER'; END")
        with self.assertRaises(RuntimeError):self.run_close(True)
        self.assertEqual(self.db.execute("SELECT expires FROM leases WHERE id='OTHER'").fetchone()[0],c.EXPIRES+9999)
        self.assertEqual(self.db.execute('SELECT state FROM leases WHERE fence=493').fetchone()[0],'uncertain')

    def test_exclusive_intent_and_revalidation_prevent_retry(self):
        (self.base/'intent.private.json').write_text('uncertain')
        with self.assertRaises(FileExistsError):self.run_close(True)
        self.assertEqual(self.db.execute('SELECT state FROM leases WHERE fence=493').fetchone()[0],'uncertain')

    def test_freshness_is_rechecked_inside_transaction(self):
        with self.assertRaisesRegex(RuntimeError,'fresh_runtime_proof'):
            self.run_close(True,clock=lambda:self.now+1000)
        self.assertEqual(self.db.execute('SELECT state FROM leases WHERE fence=493').fetchone()[0],'uncertain')


if __name__=='__main__':unittest.main()
