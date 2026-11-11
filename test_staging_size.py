import hashlib,io,tarfile,tempfile,unittest
from pathlib import Path
from unittest import mock
from frozen import staging

class RepeatedZeros(io.RawIOBase):
 def __init__(self,size):self.remaining=size
 def read(self,size=-1):
  size=min(self.remaining,size if size>=0 else self.remaining);self.remaining-=size;return b'\0'*size

class SizeRegression(unittest.TestCase):
 def exercise(self,size,manifest_size=None):
  h=hashlib.sha256();left=size
  while left:
   n=min(left,1024**2);h.update(b'\0'*n);left-=n
  t=tarfile.TarInfo('runtime/.next/fixture');t.size=size
  archive=mock.MagicMock();archive.__enter__.return_value=archive;archive.__iter__.return_value=iter([t]);archive.extractfile.side_effect=lambda _:RepeatedZeros(size)
  with tempfile.TemporaryDirectory()as tmp,mock.patch.object(staging,'pinned'),mock.patch.object(staging.tarfile,'open',return_value=archive):
   return staging.extract(Path(tmp)/'input.tar','fixture',{'.next/fixture':{'bytes':size if manifest_size is None else manifest_size,'sha256':h.hexdigest()}},Path(tmp)/'out',prefix='runtime/')
 def test_real_swc_size_above_old_limit_is_verified_without_retaining_compiled_bytes(self):
  self.assertEqual(list(self.exercise(156809432)),['.next/fixture'])
 def test_manifest_size_mismatch_still_rejected(self):
  with self.assertRaisesRegex(staging.StagingError,'member size'):self.exercise(1024,1023)
 def test_above_new_bound_still_rejected(self):
  with self.assertRaisesRegex(staging.StagingError,'member size'):self.exercise(256*1024**2+1)

if __name__=='__main__':unittest.main()
