import unittest
from reconcile import classify, reconcile


class ReconciliationTests(unittest.TestCase):
    def setUp(self):
        self.signature = {'id':1,'name':'João da Silva','category':'servidor',
                          'status':'pending','cpf_hash':'a'*64,'cpf_name_check':None}
        self.recovered = {'signature_id':1,'name':'João da Silva','cpf':'52998224725'}
        self.lookup = {'status':'ok','name':'JOAO DA SILVA','returned_cpf':'52998224725','queried_at':'2026-11-05T12:00:00Z'}

    def test_complete_name_accepts_accents_but_preserves_original(self):
        group,_ = classify(self.signature,self.recovered,self.lookup)
        self.assertEqual(group,'correspondencia_completa')
        self.assertEqual(self.signature['name'],'João da Silva')

    def test_particles_and_initials_are_held_for_review(self):
        for name in ('JOAO SILVA','J DA SILVA'):
            with self.subTest(name=name):
                lookup=dict(self.lookup,name=name)
                self.assertNotEqual(classify(self.signature,self.recovered,lookup)[0],'correspondencia_completa')

    def test_replaced_id_or_changed_name_never_silently_passes(self):
        self.assertEqual(classify(dict(self.signature,id=2),self.recovered,self.lookup)[0],'cadastro_substituido')
        self.assertEqual(classify(dict(self.signature,name='José da Silva'),self.recovered,self.lookup)[0],'nome_alterado_desde_snapshot')

    def test_wrong_returned_cpf_cannot_pass(self):
        self.assertEqual(classify(self.signature,self.recovered,dict(self.lookup,returned_cpf='00000000000'))[0],'cpf_retornado_divergente')

    def test_no_data_is_not_name_mismatch(self):
        self.assertEqual(classify(self.signature,None,None)[0],'sem_consulta_associada')
        self.assertEqual(classify(dict(self.signature,cpf_name_check='match'),None,None)[0],'match_app_sem_retorno_auditavel')

    def test_pending_remains_pending_and_already_verified_is_not_rewritten(self):
        snapshot={'at':'2026-11-06','signatures':[self.signature,dict(self.signature,id=2,cpf_hash='b'*64,cpf_name_check='match')]}
        recovered={'a'*64:self.recovered,'b'*64:dict(self.recovered,signature_id=2)}
        summary,report,eligible,changes=reconcile(snapshot,recovered,{'52998224725':self.lookup})
        self.assertEqual(len(changes),1)
        self.assertEqual(changes[0]['expected']['status'],'pending')
        self.assertEqual(summary['atualizacoes_por_status'],{'pending':1})
        self.assertEqual(snapshot['signatures'][0]['cpf_name_check'],None)


if __name__ == '__main__':
    unittest.main()
