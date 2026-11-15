import copy
import unittest
import qualification_contract as q


def request():
    return dict(version=1, operation_id='1'*32, jobs=dict(success='2'*32,failure='3'*32,cancellation='4'*32),prestart_job_id='5'*32,runtime_commit='a'*40,broker_commit='b'*40,runtime_sha256={n:'a'*64 for n in q.RUNTIME},broker_sha256={n:'b'*64 for n in q.BROKER},harness_sha256={n:'c'*64 for n in q.HARNESS},execute=False,systemd_major=255,systemd_version_sha256='d'*64)


class ContractTests(unittest.TestCase):
    def test_preparation_is_explicit(self):
        q.operation(request(), execution=False)
        with self.assertRaises(PermissionError): q.operation(request())
    def test_execution_requires_all_pins(self):
        r=request();r['execute']=True;q.operation(r)
        for field in ('runtime_sha256','broker_sha256','harness_sha256'):
            changed=copy.deepcopy(r);changed[field][next(iter(changed[field]))]='0'*64
            with self.assertRaises(PermissionError):q.operation(changed)
    def test_prestart_never_reuses_unit_job(self):
        r=request();r['prestart_job_id']=r['jobs']['success']
        with self.assertRaises(ValueError):q.operation(r,execution=False)
    def test_closed_file_sets(self):
        for f in ('runtime_sha256','broker_sha256','harness_sha256'):
            r=request();r[f]['extra.py']='a'*64
            with self.assertRaises(ValueError):q.operation(r,execution=False)
    def test_strict_types(self):
        for f,v in (('execute',1),('version',True),('systemd_major',True),('prestart_job_id','../bad')):
            r=request();r[f]=v
            with self.assertRaises((ValueError,PermissionError)):q.operation(r,execution=False)
    def test_paths_are_isolated(self):
        self.assertEqual(str(q.PUBLIC),'/opt/peticao-dev-short-alias-native-20261115-attempt1')
        self.assertEqual(str(q.SOCKET),'/run/peticao-dev-short-alias-native-20261115-attempt1/worker.sock')
        self.assertEqual(len(q.RUNTIME)+len(q.BROKER)+len(q.HARNESS)+2,25)
    def test_canonical_finite(self):
        with self.assertRaises(ValueError):q.canonical(float('nan'))
        self.assertEqual(q.digest({'b':2,'a':1}),q.digest({'a':1,'b':2}))

if __name__=='__main__':unittest.main()
