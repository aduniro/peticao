"""Convert complete Civo usage records to conservative monetary observations.

Civo /charges returns usage, NOT a credit balance. Unknown products block
admission. The observer never enlarges the owner's immutable grant.
"""
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_CEILING
from financial_guard import amount, instant


def windows(start, end):
    if start > end: raise ValueError('Invalid usage range')
    while start < end:
        stop = min(end, start+timedelta(days=30))
        yield start, stop
        start = stop


def summarize(records, rates, start, end):
    """Rates specify USD per billed hour, optionally multiplied by size_gb.

    Records must be full unmodified API entries, with product IDs and explicit
    periods. Boundaries use half-open intervals; exact duplicate rows are counted
    once. Differing overlapping entries are not silently deduplicated.
    """
    total, seen = Decimal('0'), set()
    for row in records:
        if not isinstance(row, dict): raise ValueError('Malformed usage record')
        code = row.get('code')
        rate_key = str(row.get('region'))+':'+str(code)
        if rate_key not in rates: raise ValueError('Unknown region/product price; admission blocked')
        if not isinstance(row.get('product_id'), str) or not row['product_id']:
            raise ValueError('Usage attribution missing')
        a, b = instant(row['from']), instant(row['to'])
        if b < a or a < start or b > end:
            raise ValueError('Usage period outside queried coverage')
        identity = (code, row['product_id'], a, b, str(row.get('size_gb')),
                    str(row.get('num_hours')))
        if identity in seen: continue
        seen.add(identity)
        hours = amount(row['num_hours'])
        # Never infer missing hours or truncate a fraction supplied by provider.
        elapsed = Decimal(str((b-a).total_seconds()))/3600
        if hours < elapsed: hours = elapsed.to_integral_value(rounding=ROUND_CEILING)
        spec = rates[rate_key]
        rate = amount(spec['usd_per_hour'])
        size = amount(row['size_gb']) if spec.get('per_gb') is True else Decimal('1')
        total += hours * rate * size
    return total


def observe(api, grant, rates, now, *, inventory, horizon_until):
    """The live inventory collector is a separate required integration.

    /charges alone cannot prove other resources have no unposted/future costs.
    The caller must supply independently collected account-wide inventory and
    conservative liabilities through the intended task/cleanup horizon.
    """
    if (inventory.get('complete_billable_scope') is not True
            or inventory.get('account_scope_id') != grant['account_scope_id']
            or inventory.get('currency') != grant['currency']):
        raise ValueError('Complete account inventory missing')
    seen = instant(inventory['observed_at'])
    if seen > now or now-seen > timedelta(minutes=5):
        raise ValueError('Inventory stale or from future')
    if instant(inventory['liability_horizon_until']) < horizon_until:
        raise ValueError('Other resource liability coverage too short')
    start = instant(grant['starts_at'])
    records = []
    for a,b in windows(start, now):
        page = api.request('GET','/v2/charges',query={'from':a.isoformat(),'to':b.isoformat()})
        if not isinstance(page, list): raise ValueError('Incomplete usage list')
        records.extend(page)
    total = summarize(records, rates, start, now)
    total += amount(inventory['other_unposted_upper_bound_usd'])
    total += amount(inventory['other_future_liability_usd'])
    return {'observed_at':now.isoformat(), 'account_total_usd':str(total),
            'grant_initial_usd':grant['initial_usd'], 'currency':grant['currency'],
            'account_scope_id':grant['account_scope_id'],
            'grant_evidence_id':grant['grant_evidence_id'],
            'complete_account_scope':True, 'source':'Civo hourly usage converted with pinned prices',
            'provider_credit_balance_verified':False}
