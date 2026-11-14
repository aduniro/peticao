from copy import deepcopy
from datetime import datetime, timezone, timedelta
import unittest
from exclusive_inventory import collect,ZERO_QUOTAS,OWN_QUOTAS,CATEGORIES


class InventoryApi:
    def __init__(self):
        self.quota={key:0 for key in ZERO_QUOTAS|OWN_QUOTAS};self.quota['network_count_usage']=5
        self.quota_calls=0;self.changed=False;self.extra=False;self.second_page=False;self.calls=[]
    def request(self,method,path,query=None):
        self.calls.append((path,query))
        if path=='/v2/quota':
            self.quota_calls+=1;value=deepcopy(self.quota)
            if self.changed and self.quota_calls>1:value['instance_count_usage']=1
            return value
        if path=='/v2/regions':
            return [{'code':'nyc1','connected':True,'features':{feature:True for feature,_ in CATEGORIES.values()}}]
        if path=='/v2/instances' and self.second_page:
            if query['page']==1:return {'items':[],'page':1,'pages':2}
            return {'items':[{'id':'unpriced-on-second-page'}],'page':2,'pages':2}
        if path=='/v2/instances' and self.extra:return [{'id':'other-resource'}]
        return []


class Coverage(unittest.TestCase):
    def setUp(self):self.api=InventoryApi();self.now=datetime(2026,11,14,tzinfo=timezone.utc)
    def history(self):
        return dict(kind='verified_account_liability_bound',account_scope_id='a',currency='USD',
                    source_ref='test-only-provider-evidence',verified_at=self.now.isoformat(),
                    covered_from=(self.now-timedelta(days=1)).isoformat(),covered_through=self.now.isoformat(),
                    unposted_upper_bound_usd='7.50')
    def run_collect(self):return collect(self.api,'a',None,self.now+timedelta(days=10),now=lambda:self.now,
                               historical_liability=self.history(),grant_starts_at=(self.now-timedelta(days=1)).isoformat())
    def test_empty_account_reconciles_listings_and_quota(self):
        self.assertTrue(self.run_collect()['complete_billable_scope'])
        self.assertEqual(self.api.quota_calls,2)
        self.assertEqual(self.run_collect()['other_unposted_upper_bound_usd'],'7.50')
    def test_other_resource_refuses_exclusive_liability_claim(self):
        self.api.extra=True
        with self.assertRaises(ValueError):self.run_collect()
    def test_second_page_is_read_before_concluding_account_empty(self):
        self.api.second_page=True
        with self.assertRaises(ValueError):self.run_collect()
        self.assertTrue(any(path=='/v2/instances' and query['page']==2 for path,query in self.api.calls))
    def test_concurrent_account_change_refuses_scope_attestation(self):
        self.api.changed=True
        with self.assertRaises(ValueError):self.run_collect()

    def test_deleted_past_resource_unknown_cost_is_not_inferred_zero(self):
        result=collect(self.api,'a',None,self.now+timedelta(days=10),now=lambda:self.now)
        self.assertFalse(result['complete_billable_scope'])
        self.assertEqual(result['historical_liability_status'],'unknown')
        self.assertNotIn('other_unposted_upper_bound_usd',result)

    def test_history_must_cover_credit_start_and_observation_time(self):
        for field,value in [('covered_from',self.now.isoformat()),
                            ('covered_through',(self.now-timedelta(seconds=1)).isoformat())]:
            proof=self.history();proof[field]=value
            with self.subTest(field=field),self.assertRaises(ValueError):
                collect(self.api,'a',None,self.now+timedelta(days=10),now=lambda:self.now,
                        historical_liability=proof,grant_starts_at=(self.now-timedelta(days=1)).isoformat())


if __name__=='__main__':unittest.main()
