import hashlib,io,json,tarfile,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import sync

class SyncTests(unittest.TestCase):
 def test_archive_refuses_symlinks_even_with_valid_checksum(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);archive=root/'source.tar.gz';target=root/'out';target.mkdir()
   with tarfile.open(archive,'w:gz') as t:
    item=tarfile.TarInfo('signatures.json');item.type=tarfile.SYMTYPE;item.linkname='/etc/passwd';t.addfile(item)
   with self.assertRaises(RuntimeError):sync.validate_archive(archive,target,hashlib.sha256(archive.read_bytes()).hexdigest())
   self.assertFalse((target/'signatures.json').exists())
 def test_unchanged_source_does_not_download_or_replace_decisions(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);report={'changed':False,'read_only':True,'source_at':'2026-11-06T12:00:00Z','validation_version':'version-2','build_id':'fixture'}
   class Process:returncode=0;stdout=json.dumps(report)
   with patch.object(sync,'BASE',root),patch.object(sync,'stats',return_value={'decisions':{'rejected':1},'source_at':'old'}),patch.object(sync.subprocess,'run',return_value=Process()) as run:
    result=sync.sync();self.assertEqual(run.call_count,1);self.assertEqual(result['decisions'],{'rejected':1});self.assertEqual(result['sync']['state'],'online');self.assertEqual(list((root/'fontes').iterdir()),[])
 def test_archive_checksum_failure_prevents_extraction(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);archive=root/'source.tar.gz';archive.write_bytes(b'not-an-archive')
   with self.assertRaises(RuntimeError):sync.validate_archive(archive,root,'0'*64)

 def test_ssh_failure_preserves_checkpoint_and_database_then_reconnects(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);(root/'revisao.sqlite').write_bytes(b'UNCHANGED_LOCAL_DATABASE')
   checkpoint={'fingerprint':'a'*64,'static_id':'b'*64,'state':'online','last_success_at':'2026-11-06T11:00:00Z'}
   (root/'sync-state.json').write_text(json.dumps(checkpoint))
   class Failed:returncode=255;stdout=''
   class Recovered:returncode=0;stdout=json.dumps({'changed':False,'read_only':True,'source_at':'2026-11-06T12:00:00Z','validation_version':'fixture','build_id':'fixture'})
   with patch.object(sync,'BASE',root),patch.object(sync,'stats',return_value={'decisions':{'rejected':1},'source_at':'old'}),patch.object(sync,'ingest') as ingest,patch.object(sync.subprocess,'run',side_effect=[Failed(),Recovered()]):
    with self.assertRaises(RuntimeError):sync.sync()
    offline=sync.read_state();self.assertEqual(offline['state'],'offline');self.assertEqual(offline['fingerprint'],checkpoint['fingerprint']);self.assertEqual(offline['last_success_at'],checkpoint['last_success_at'])
    result=sync.sync();self.assertEqual(result['sync']['state'],'online');self.assertEqual(result['decisions'],{'rejected':1});self.assertEqual(result['sync']['fingerprint'],checkpoint['fingerprint']);ingest.assert_not_called()
   self.assertEqual((root/'revisao.sqlite').read_bytes(),b'UNCHANGED_LOCAL_DATABASE')

if __name__=='__main__':unittest.main()
