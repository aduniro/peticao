import dataclasses
import fcntl
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import time
import unittest
import uuid
from unittest.mock import patch

SPEC=importlib.util.spec_from_file_location('sp_adapter',Path(__file__).resolve().parents[1]/'deploy'/'sp_adapter.py')
sp=importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name]=sp
SPEC.loader.exec_module(sp)


class Crash(BaseException):
    pass


class Callbacks:
    def __init__(self,root):
        self.root=root
        self.calls=[]
        self.smoke=True
        self.qualified=True
        self.lease_valid=True
        self.pg_good=True
        self.database=root/'fictitious-database.txt'
        self.database.write_text('original data')

    def call(self,name,value):
        self.calls.append((name,value))
        if name=='lease':
            valid=self.lease_valid and value['proof']=={'fixture_fence':'fixture-generation-1'}
            return {'valid':valid,'job_id':value['scope']['job_id'],'generation':1,'expires_at':int(time.time())+300}
        if name=='preflight':
            return {'ready':True,'protected_config_external':True,'service_user':'peticao','service_group':'peticao','runtime_format':'next-start-v1','environment_file':'/etc/peticao/app.env'}
        if name=='qualify':
            return {**{k:self.qualified for k in ('runtime_complete','tests_passed','schema_compatible','rollback_compatible','catalog_sealed')},'manifest_hash':value['scope']['manifest_hash'],'runtime_manifest_sha256':value['scope']['runtime_manifest_sha256'],'source_commit':value['manifest']['source_commit'],'runtime_format':'next-start-v1'}
        if name=='backup_app':
            with tarfile.open(value['output'],'w') as tar:
                tar.add(value['app'],arcname='app')
            return {'verified':True,'sha256':sp.sha(value['output'])}
        if name=='backup_pg':
            Path(value['output']).write_bytes(self.database.read_bytes())
            return {'verified':self.pg_good,'consistent':self.pg_good,'sha256':sp.sha(value['output'])}
        if name=='service':
            if value['operation']=='start':
                self.database.write_text('DB novas dadas after deployment')
            return {'state':'inactive' if value['operation']=='stop' else 'active'}
        if name=='health':
            return {'healthy':self.smoke if value['phase']=='publish' else True}
        if name=='migration':
            return {'completed':True}
        raise AssertionError(name)


class DeployTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
        self.app=self.root/'app'
        self.app.mkdir()
        (self.app/'version.txt').write_text('old-version')
        self.environment=self.root/'external-app.env'
        self.environment.write_text('HASH_PEPPER=fictitious-unchanged-value')
        self.config=sp.Config(fixture=True,app=self.app,state=self.root/'state',staging=self.root/'stage',backups=self.root/'backups',grant_key=b'f'*32)
        self.callbacks=Callbacks(self.root)
        self.engine=sp.Engine(self.config,self.callbacks)

    def tearDown(self):
        self.temp.cleanup()

    def artifact(self,extras=None,change=None):
        files={'package.json':b'{"name":"fixture"}','node_modules/next/package.json':b'{"name":"next"}','node_modules/next/dist/bin/next':b'fixture next CLI','.next/BUILD_ID':b'fixture-build','.next/server/page.js':b'fixture server','.next/static/page.js':b'fixture static','version.txt':b'new-version'}
        manifest={'schema_version':1,'release_id':'r0001-fixture','source_commit':'a'*40,'runtime_format':'next-start-v1','entrypoint':'node_modules/next/dist/bin/next','files':{name:{'sha256':hashlib.sha256(value).hexdigest(),'bytes':len(value)} for name,value in files.items()},'migration_id':None,'migration_ack_sha256':None}
        if change:
            change(manifest)
        raw=sp.canonical(manifest)
        stream=io.BytesIO()
        with tarfile.open(fileobj=stream,mode='w') as tar:
            for name,value in {'release-manifest.json':raw,**{'runtime/'+name:value for name,value in files.items()}}.items():
                member=tarfile.TarInfo(name);member.size=len(value)
                tar.addfile(member,io.BytesIO(value))
            if extras:
                extras(tar)
        return stream.getvalue(),hashlib.sha256(raw).hexdigest()

    def header(self,data,manifest_hash,action='preflight',request_id=None):
        scope={'request_id':request_id or uuid.uuid4().hex,'job_id':uuid.uuid4().hex,'release_id':'r0001-fixture','manifest_hash':'b'*64,'runtime_manifest_sha256':manifest_hash,'artifact_sha256':hashlib.sha256(data).hexdigest(),'artifact_size':len(data),'destination':'sp-production'}
        claims={**scope,'owner':'operator-1608598f41@example.invalid','owner_nonce':uuid.uuid4().hex,'operation':'deploy','issued_at':int(time.time()),'expires_at':int(time.time())+300,'migration_id':None,'migration_ack_sha256':None}
        return {**scope,'action':action,'grant':{'claims':claims,'signature':sp.signed(self.config.grant_key,claims)},'lease':{'fixture_fence':'fixture-generation-1'}}

    def action(self,header,action):
        result={**header,'action':action}
        claims={**header['grant']['claims'],'operation':'rollback' if action=='rollback' else 'deploy'}
        result['grant']={'claims':claims,'signature':sp.signed(self.config.grant_key,claims)}
        return result

    def prepare(self,data=None,manifest_hash=None):
        if data is None:
            data,manifest_hash=self.artifact()
        header=self.header(data,manifest_hash)
        self.assertEqual(self.engine.invoke(header)['state'],'preflighted')
        self.assertEqual(self.engine.invoke(self.action(header,'upload'),io.BytesIO(data))['state'],'uploaded')
        self.assertEqual(self.engine.invoke(self.action(header,'prepared'))['state'],'prepared')
        return header

    def test_success_idempotency_fixed_runtime_and_external_environment(self):
        header=self.prepare()
        result=self.engine.invoke(self.action(header,'publish'))
        self.assertEqual(result['state'],'completed')
        self.assertEqual((self.app/'version.txt').read_text(),'new-version')
        self.assertEqual(self.environment.read_text(),'HASH_PEPPER=fictitious-unchanged-value')
        self.assertTrue((self.config.backups/header['request_id']/'postgres.dump').is_file())
        calls=len(self.callbacks.calls)
        self.engine.invoke(self.action(header,'publish'))
        # Only a read-only lease check is repeated, never service/backup/exchange.
        self.assertEqual([name for name,_ in self.callbacks.calls[calls:]],['lease'])
        self.assertEqual(result['directory_observation'],{'app':'candidate','staging':'previous'})

    def test_smoke_failure_rolls_back_code_and_keeps_new_database_data(self):
        header=self.prepare()
        self.callbacks.smoke=False
        result=self.engine.invoke(self.action(header,'publish'))
        self.assertEqual(result['state'],'rolled_back')
        self.assertEqual((self.app/'version.txt').read_text(),'old-version')
        self.assertEqual(self.callbacks.database.read_text(),'DB novas dadas after deployment')
        self.assertEqual((self.config.backups/header['request_id']/'postgres.dump').read_text(),'original data')
        self.assertFalse(result['detail']['database_restored'])

    def test_manual_rollback_requires_distinct_owner_operation_and_never_restores_db(self):
        header=self.prepare()
        self.engine.invoke(self.action(header,'publish'))
        bad={**header,'action':'rollback'}
        with self.assertRaises(PermissionError):self.engine.invoke(bad)
        self.callbacks.database.write_text('new signatures after cutover')
        # This fixture's service callback deliberately adds fresh writes on start.
        result=self.engine.invoke(self.action(header,'rollback'))
        self.assertEqual(result['state'],'rolled_back')
        self.assertNotEqual(self.callbacks.database.read_text(),'original data')
        self.assertEqual((self.app/'version.txt').read_text(),'old-version')

    def test_crash_after_exchange_is_uncertain_and_not_replayed(self):
        header=self.prepare()
        def crash(phase):
            if phase=='exchange_performed':raise Crash()
        self.engine.crash_hook=crash
        with self.assertRaises(Crash):self.engine.invoke(self.action(header,'publish'))
        restarted=sp.Engine(self.config,self.callbacks)
        state=restarted.invoke(self.action(header,'status'))
        self.assertEqual(state['state'],'uncertain')
        self.assertEqual(state['directory_observation']['app'],'candidate')
        calls=len(self.callbacks.calls)
        self.assertEqual(restarted.invoke(self.action(header,'publish'))['state'],'uncertain')
        self.assertEqual([name for name,_ in self.callbacks.calls[calls:]],['lease'])
        self.assertEqual(restarted.invoke(self.action(header,'rollback'))['state'],'rolled_back')

    def test_hash_mismatch_and_truncated_upload_do_not_touch_live_app(self):
        for broken in (b'bad',None):
            with self.subTest(broken=broken):
                data,mh=self.artifact();header=self.header(data,mh)
                self.engine.invoke(header)
                stream=io.BytesIO(broken if broken else bytes([data[0]^1])+data[1:])
                with self.assertRaises(ValueError):self.engine.invoke(self.action(header,'upload'),stream)
                self.assertEqual((self.app/'version.txt').read_text(),'old-version')
                self.assertEqual(self.engine.public(header['request_id'])['state'],'failed')

    def test_hostile_tar_traversal_links_and_secret_files_rejected(self):
        def traversal(tar):
            info=tarfile.TarInfo('../escape');info.size=1;tar.addfile(info,io.BytesIO(b'x'))
        def link(tar):
            info=tarfile.TarInfo('runtime/link');info.type=tarfile.SYMTYPE;info.linkname='/etc/passwd';tar.addfile(info)
        def secret(tar):
            info=tarfile.TarInfo('runtime/.env.local');info.size=1;tar.addfile(info,io.BytesIO(b'x'))
        for attack in (traversal,link,secret):
            with self.subTest(attack=attack.__name__):
                data,mh=self.artifact(extras=attack)
                header=self.header(data,mh);self.engine.invoke(header)
                self.engine.invoke(self.action(header,'upload'),io.BytesIO(data))
                with self.assertRaises(ValueError):self.engine.invoke(self.action(header,'prepared'))
                self.assertEqual((self.app/'version.txt').read_text(),'old-version')
        self.assertFalse((self.root/'escape').exists())

    def test_runtime_qualifier_required_and_standalone_rejected(self):
        self.callbacks.qualified=False
        data,mh=self.artifact();header=self.header(data,mh)
        self.engine.invoke(header);self.engine.invoke(self.action(header,'upload'),io.BytesIO(data))
        with self.assertRaises(ValueError):self.engine.invoke(self.action(header,'prepared'))
        self.callbacks.qualified=True
        data,mh=self.artifact(change=lambda manifest:manifest.update(runtime_format='next-standalone-v1',entrypoint='server.js'))
        header=self.header(data,mh)
        self.engine.invoke(header);self.engine.invoke(self.action(header,'upload'),io.BytesIO(data))
        with self.assertRaises(ValueError):self.engine.invoke(self.action(header,'prepared'))

    def test_owner_scope_lease_and_concurrency_guards(self):
        data,mh=self.artifact();header=self.header(data,mh)
        tampered={**header,'release_id':'other-release'}
        with self.assertRaises(PermissionError):self.engine.invoke(tampered)
        self.callbacks.lease_valid=False
        with self.assertRaises(PermissionError):self.engine.invoke(header)
        self.callbacks.lease_valid=True
        with (self.config.state/'publisher.lock').open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError):self.engine.invoke(header)
        self.assertEqual((self.app/'version.txt').read_text(),'old-version')

    def test_bad_pg_backup_prevents_service_stop_and_cutover(self):
        header=self.prepare();self.callbacks.pg_good=False
        with self.assertRaises(ValueError):self.engine.invoke(self.action(header,'publish'))
        self.assertEqual((self.app/'version.txt').read_text(),'old-version')
        self.assertFalse(any(name=='service' for name,_ in self.callbacks.calls))
        self.assertEqual(self.engine.public(header['request_id'])['state'],'uncertain')

    def test_request_fingerprint_and_migration_policy_cannot_change(self):
        data,mh=self.artifact();header=self.header(data,mh)
        self.engine.invoke(header)
        changed={**header,'artifact_sha256':'c'*64}
        claims={**header['grant']['claims'],'artifact_sha256':'c'*64}
        changed['grant']={'claims':claims,'signature':sp.signed(self.config.grant_key,claims)}
        with self.assertRaises(ValueError):self.engine.invoke(changed)
        migration={**header}
        claims={**header['grant']['claims'],'migration_id':'run-arbitrary-sql','migration_ack_sha256':'d'*64}
        migration['grant']={'claims':claims,'signature':sp.signed(self.config.grant_key,claims)}
        with self.assertRaises(PermissionError):self.engine.invoke(migration)

    def test_runtime_tampering_after_qualification_blocks_cutover(self):
        header=self.prepare()
        (self.config.staging/header['request_id']/'runtime'/'version.txt').write_text('tampered')
        with self.assertRaises(ValueError):self.engine.invoke(self.action(header,'publish'))
        self.assertEqual((self.app/'version.txt').read_text(),'old-version')
        self.assertFalse(any(name=='service' for name,_ in self.callbacks.calls))

    def test_production_default_is_disabled_before_any_callback(self):
        config=dataclasses.replace(self.config,fixture=False,app=sp.APP)
        with patch.object(sp.os,'geteuid',return_value=0),patch.object(sp.socket,'gethostname',return_value='peticao-sp'),patch.object(sp,'root_owned'):
            engine=sp.Engine(config,self.callbacks)
            data,mh=self.artifact();header=self.header(data,mh)
            with self.assertRaises(PermissionError):engine.invoke(header)
        self.assertEqual(self.callbacks.calls,[])

    def test_crash_before_exchange_only_manual_rollback_restarts_previous_code(self):
        header=self.prepare()
        def crash(phase):
            if phase=='stop':raise Crash()
        self.engine.crash_hook=crash
        with self.assertRaises(Crash):self.engine.invoke(self.action(header,'publish'))
        restart=sp.Engine(self.config,self.callbacks)
        state=restart.invoke(self.action(header,'status'))
        self.assertEqual(state['state'],'uncertain')
        self.assertEqual(state['directory_observation']['app'],'previous')
        self.assertEqual(restart.invoke(self.action(header,'rollback'))['state'],'rolled_back')
        self.assertEqual((self.app/'version.txt').read_text(),'old-version')


if __name__=='__main__':unittest.main()
