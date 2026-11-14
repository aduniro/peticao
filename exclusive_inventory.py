"""Read-only, exclusive-account collector for this single Civo allocation.

Only the owned NYC instance/volume are priceable here. Other resources or
nonzero unsupported billable quotas close admission rather than guessing costs.
Zero quota counters are reported as counters, not fabricated resource records.
"""
from datetime import datetime, timezone


CATEGORIES={
    'instances':('iaas','/v2/instances'),
    'volumes':('volume','/v2/volumes'),
    'databases':('dbaas','/v2/databases'),
    'kubernetes':('kubernetes','/v2/kubernetes/clusters'),
    'objectstores':('object_store','/v2/objectstores'),
    'loadbalancers':('loadbalancer','/v2/loadbalancers'),
    'ips':('iaas','/v2/ips'),
}
ZERO_QUOTAS={
    'instance_snapshot_count_usage','disk_snapshot_count_usage','disk_snapshot_disk_usage',
    'disk_volume_snapshot_count_usage','loadbalancer_count_usage','app_count_usage',
    'app_process_count_usage','objectstore_gb_usage','objectstore_credential_usage',
    'filestore_count_usage','filestore_gb_usage','database_count_usage',
    'database_snapshot_count_usage','database_cpu_core_usage','database_ram_mb_usage',
    'database_disk_gb_usage',
}
FREE_QUOTAS={'network_count_usage','subnet_count_usage','security_group_usage',
             'security_group_rule_usage','port_count_usage'}
OWN_QUOTAS={'instance_count_usage','cpu_core_usage','ram_mb_usage','disk_gb_usage',
            'disk_volume_count_usage','public_ip_address_usage'}


def listing(api,path,region):
    rows=[]
    for page in range(1,1001):
        value=api.request('GET',path,query={'region':region,'page':page,'per_page':100})
        if isinstance(value,list):
            if page!=1:raise ValueError('List envelope changed during pagination')
            return value
        if not isinstance(value,dict) or not isinstance(value.get('items'),list):
            raise ValueError('Incomplete inventory listing')
        if value.get('page')!=page or type(value.get('pages')) is not int:
            raise ValueError('Unproven inventory pagination')
        rows.extend(value['items'])
        if value['pages']<page:raise ValueError('Invalid inventory page count')
        if page==value['pages']:return rows
    raise ValueError('Inventory pagination limit reached')


def collect(api, account_id, receipt, horizon_until, *, now=None):
    clock=now or (lambda:datetime.now(timezone.utc))
    before=api.request('GET','/v2/quota')
    regions=api.request('GET','/v2/regions')
    if not isinstance(regions,list) or not regions:raise ValueError('Region inventory incomplete')
    resources=[];coverage=[]
    for region in regions:
        code=region.get('code')
        if not isinstance(code,str) or not code:raise ValueError('Region code missing')
        if region.get('connected') is not True:raise ValueError('Unconnected region: scope unproven')
        features=region.get('features')
        if not isinstance(features,dict):raise ValueError('Region feature scope missing')
        for category,(feature,path) in CATEGORIES.items():
            if features.get(feature) is False:
                coverage.append(dict(region=code,category=category,evidence='provider_feature_disabled'))
                continue
            if features.get(feature) is not True:raise ValueError('Region feature support unknown')
            rows=listing(api,path,code)
            coverage.append(dict(region=code,category=category,pages_complete=True,count=len(rows)))
            for row in rows:
                if not isinstance(row,dict) or not isinstance(row.get('id'),str):
                    raise ValueError('Resource ID missing')
                resources.append((code.upper(),category,row))
    after=api.request('GET','/v2/quota')
    usage=lambda d:{k:v for k,v in d.items() if k.endswith('_usage')}
    if usage(before)!=usage(after):raise ValueError('Account changed during inventory')
    for key in ZERO_QUOTAS:
        if type(after.get(key)) is not int or after[key]!=0:
            raise ValueError('Other billable account usage: '+key)
    for key,value in usage(after).items():
        if key not in ZERO_QUOTAS|FREE_QUOTAS|OWN_QUOTAS and value!=0:
            raise ValueError('Unknown billable quota: '+key)
    owned={} if receipt is None else {(x['kind'],x['id']):x for x in receipt['resources']}
    own_instance=None;own_volume=None
    for region,category,row in resources:
        if (category,row['id']) in owned and region=='NYC1':
            expected=owned[(category,row['id'])]['expected']
            if any(str(row.get(k))!=str(v) for k,v in expected.items()):
                raise ValueError('Owned resource changed during inventory')
            if category=='instances':own_instance=row
            if category=='volumes':own_volume=row
        elif category=='ips' and own_instance is not None and row.get('assigned_to',{}).get('id')==own_instance['id']:
            # This permits the single owned IP only when explicit attribution is
            # present. Unknown IP envelopes never become guessed free addresses.
            continue
        else:raise ValueError('Unpriced other resource present')
    expected={'instance_count_usage':int(own_instance is not None),
              'disk_volume_count_usage':int(own_volume is not None)}
    if own_instance is None:
        expected.update(cpu_core_usage=0,ram_mb_usage=0,disk_gb_usage=0,public_ip_address_usage=0)
    else:
        if own_instance.get('size')!='g4c.medium':raise ValueError('Unexpected owned compute size')
        expected.update(cpu_core_usage=16,ram_mb_usage=32768,
                        disk_gb_usage=80+(200 if own_volume else 0),
                        public_ip_address_usage=1)
    if any(after.get(k)!=v for k,v in expected.items()):
        raise ValueError('Quota/resource reconciliation incomplete')
    return dict(observed_at=clock().isoformat(),account_scope_id=account_id,currency='USD',
                complete_billable_scope=True,liability_horizon_until=horizon_until.isoformat(),
                other_unposted_upper_bound_usd='0',other_future_liability_usd='0',
                basis='exclusive owned allocation; enumerated supported regional resources plus zero unsupported billable quota counters',
                coverage=coverage,zero_quota_counters={k:after[k] for k in ZERO_QUOTAS},
                provider_credit_balance_verified=False)
