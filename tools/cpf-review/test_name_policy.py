import unittest,json
from pathlib import Path
from name_dictionary import suggest
from name_policy import policy

class CentralPolicyTests(unittest.TestCase):
 def test_shared_application_cases(self):
  cases=json.loads((Path(__file__).resolve().parents[2]/'site/src/content/name-print-policy-cases.json').read_text())
  for row in cases:
   with self.subTest(entered=row['entered'],api=row['api']):
    result=suggest({'name':row['entered'],'nome_api':row['api']})
    self.assertEqual(result['proposed'],row['proposed']);self.assertEqual(result['proposed_source'],row['source']);self.assertEqual(result['major_divergence'],row['major']);self.assertEqual(result['policy_version'],policy()['version'])
 def test_no_invented_particles(self):
  result=suggest({'name':'Ana Silva','nome_api':'ANA MARIA SILVA'})
  self.assertEqual(result['proposed'],'Ana Maria Silva')
