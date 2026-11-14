"""Conservative Civo allocation deadlines, not a second task queue.

Pure calculations only. This module neither creates nor deletes resources.
Observed charges must include every billable Civo resource and be fresh.
The credit grant is owner-provided evidence, never a claimed API balance.
"""
from datetime import datetime, timedelta
from decimal import Decimal


def amount(value):
    result = Decimal(str(value))
    if not result.is_finite() or result < 0:
        raise ValueError('nonnegative finite money required')
    return result


def instant(value):
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('timezone required')
    return result


def deadlines(grant, quote, allocated_at):
    """Reserve 20% of grant and allow 48h for drain/export/reconciliation.

    The 20% rate markup is additional to the untouched 20% grant reserve.
    All root-disk, volume and mandatory network costs must be in hourly_usd.
    No unused grant is assumed renewable; the expiry always caps allocation.
    """
    if grant.get('provenance') != 'authenticated_owner':
        raise ValueError('missing credit evidence provenance')
    for key in ['account_scope_id', 'grant_evidence_id']:
        if not isinstance(grant.get(key), str) or not grant[key].strip():
            raise ValueError('missing immutable account/grant binding')
    if quote.get('complete_mandatory_costs') is not True:
        raise ValueError('incomplete price quote')
    if quote.get('currency') != 'USD' or grant.get('currency') != 'USD':
        raise ValueError('currency mismatch')
    start = instant(allocated_at)
    expiry = instant(grant['expires_at'])
    total = amount(grant['initial_usd'])
    spent = amount(grant['baseline_spent_usd'])
    hourly = amount(quote['hourly_usd']) * Decimal('1.20')
    if hourly <= 0:
        raise ValueError('positive hourly cost required')
    reserve = total * Decimal('0.20')
    usable = total - reserve - spent
    if usable <= 0 or start >= expiry:
        raise ValueError('no funded lifetime')
    # Floor seconds: rounding must never expand the affordable lifetime.
    seconds = int(usable / hourly * 3600)
    delete_by = min(start + timedelta(seconds=seconds), expiry - timedelta(hours=24))
    drain_by = delete_by - timedelta(hours=48)
    if drain_by <= start:
        raise ValueError('insufficient cleanup coverage')
    return dict(allocated_at=start.isoformat(), stop_admission_at=drain_by.isoformat(),
                delete_by=delete_by.isoformat(), reserved_usd=str(reserve),
                baseline_spent_usd=str(spent),
                grant_initial_usd=str(total), currency='USD',
                account_scope_id=grant['account_scope_id'],
                grant_evidence_id=grant['grant_evidence_id'],
                conservative_hourly_usd=str(hourly),
                credit_source='authenticated_owner_not_provider_balance',
                stopping_does_not_stop_billing=True)


def admit(schedule, now, timeout_seconds, *, charges, other_reservations_usd='0'):
    """Evaluate against the existing queue's claim; caller must commit atomically.

    Fresh complete account-wide observations are required. Missing observations
    reject new work; existing jobs must still drain/export under the executor.
    Provider charges may lag, so elapsed allocation is also charged conservatively.
    """
    if type(timeout_seconds) is not int or timeout_seconds <= 0:
        return dict(allowed=False, reason='invalid_task_timeout')
    if charges.get('complete_account_scope') is not True:
        return dict(allowed=False, reason='incomplete_charge_scope')
    if (charges.get('account_scope_id') != schedule['account_scope_id']
            or charges.get('grant_evidence_id') != schedule['grant_evidence_id']
            or charges.get('currency') != schedule['currency']
            or amount(charges.get('grant_initial_usd')) != amount(schedule['grant_initial_usd'])):
        return dict(allowed=False, reason='account_grant_or_currency_mismatch')
    seen = instant(charges['observed_at'])
    if now < seen or now - seen > timedelta(hours=1):
        return dict(allowed=False, reason='stale_or_future_charge_observation')
    start = instant(schedule['allocated_at'])
    if now < start or now + timedelta(seconds=timeout_seconds) >= instant(schedule['stop_admission_at']):
        return dict(allowed=False, reason='task_exceeds_funded_execution_window')
    rate = amount(schedule['conservative_hourly_usd'])
    elapsed = Decimal(str((now - start).total_seconds())) / 3600 * rate
    used = max(amount(charges['account_total_usd']), amount(schedule['baseline_spent_usd']) + elapsed)
    usable = (amount(schedule['grant_initial_usd']) - amount(schedule['reserved_usd'])
              - used - amount(other_reservations_usd))
    required = rate * (Decimal(timeout_seconds) / 3600 + 48)
    return dict(allowed=usable >= required,
                reason='covered' if usable >= required else 'cleanup_coverage_insufficient',
                queue_claim_commit_required=True)
