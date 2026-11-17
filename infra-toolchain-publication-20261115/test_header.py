"""Actual wire validation without mocked authority/pin/schema functions or effects."""
import copy,hashlib,time,unittest
from pathlib import Path
import root_entry as e
from test_materializer import package

class HeaderTests(unittest.TestCase):
    def setUp(self):
        _,files=package()
        pins={'node20':'b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac','inputs/source.tar.gz':'19db95b7c0628dac9fbcec961adbdf3a01bfa00b1519f28a376427e80707a4d5','inputs/dependencies.normalized.tar.gz':'4b2c828ffdd182a8eef3e7fab1dcc8e3a6784318cc2f0c727efd8f978933605f'}
        for n,h in pins.items():files[n]['sha256']=h
        self.plan=dict(version=1,operation_id='a'*32,operator_session=e.SESSION,scope='new-civo-sealed-toolchain-no-dispatch',source_notice=1,execution_notice=2,root_window_event=3,qualification_release_event=4,full_integrity_event=3429,expected_boot_id=Path('/proc/sys/kernel/random/boot_id').read_text().strip(),payload_sha256='a'*64,payload_bytes=1,unpacked_bytes=sum(x['bytes']for x in files.values()),files=files,deadline_unix=time.time()+120)
    def test_complete_exact_header_accepted_without_effect(self):
        self.assertIs(e.header(self.plan),self.plan)
    def test_events_reject_bool_zero_and_missing_extra_fields(self):
        for name in ('source_notice','execution_notice','root_window_event','qualification_release_event','full_integrity_event'):
            for value in (True,0,'1'):
                plan=copy.deepcopy(self.plan);plan[name]=value
                with self.assertRaises(ValueError):e.header(plan)
        for field in self.plan:
            plan=copy.deepcopy(self.plan);del plan[field]
            with self.assertRaises(ValueError):e.header(plan)
        plan=copy.deepcopy(self.plan);plan['fixture_uid']=0
        with self.assertRaises(ValueError):e.header(plan)
    def test_frozen_node_and_R1_pins_cannot_be_substituted(self):
        for name in ('node20','inputs/source.tar.gz','inputs/dependencies.normalized.tar.gz'):
            plan=copy.deepcopy(self.plan);plan['files'][name]['sha256']='0'*64
            with self.assertRaises(PermissionError):e.header(plan)
    def test_install_current_boot_and_finite_bounded_future_deadline(self):
        plan=copy.deepcopy(self.plan);plan['expected_boot_id']='00000000-0000-0000-0000-000000000000'
        with self.assertRaises(PermissionError):e.header(plan)
        for deadline in (True,0,time.time()-1,time.time()+1000,float('nan'),float('inf')):
            plan=copy.deepcopy(self.plan);plan['deadline_unix']=deadline
            with self.assertRaises(PermissionError):e.header(plan)
    def test_observe_original_expired_header_is_only_data(self):
        plan=copy.deepcopy(self.plan);plan['deadline_unix']=1;plan['expected_boot_id']='00000000-0000-0000-0000-000000000000'
        self.assertIs(e.header(plan,observing=True),plan)
        with self.assertRaises(PermissionError):e.header(plan)

if __name__=='__main__':unittest.main()
