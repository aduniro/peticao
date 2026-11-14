"""Financial rows inside the EXISTING development queue SQLite transaction.

No new tasks, queue, dispatcher, authority or actor are created. The existing
coordinator must call reserve() inside its BEGIN IMMEDIATE claim transaction,
commit the task claim and financial row together, and only then dispatch.
This integration is prepared only; the live queue has not been modified.
"""
from datetime import timedelta
from decimal import Decimal
import json

from financial_guard import admit, amount


def initialize(db):
    if db.in_transaction:raise ValueError('Schema setup needs a separate reviewed migration')
    db.execute('''CREATE TABLE IF NOT EXISTS civo_financial_reservations (
        allocation_id TEXT NOT NULL, job_id TEXT NOT NULL,
        grant_evidence_id TEXT NOT NULL, account_scope_id TEXT NOT NULL,
        currency TEXT NOT NULL, timeout_seconds INTEGER NOT NULL,
        amount_usd TEXT NOT NULL, state TEXT NOT NULL,
        reserved_at TEXT NOT NULL, released_at TEXT,
        PRIMARY KEY(allocation_id,job_id), FOREIGN KEY(job_id) REFERENCES jobs(id),
        CHECK(state IN ('reserved','released'))
    )''')
    db.commit()


def reserve(db, allocation_id, job_id, schedule, charges, now, timeout_seconds):
    if not db.in_transaction:
        raise ValueError('Queue claim and financial reserve require the same transaction')
    if type(timeout_seconds) is not int or timeout_seconds<1:
        raise ValueError('Finite positive task timeout required')
    row=db.execute('SELECT state FROM jobs WHERE id=?',(job_id,)).fetchone()
    if not row or row[0]!='queued':raise ValueError('Only an existing queued job may reserve funds')
    existing=db.execute('''SELECT grant_evidence_id,account_scope_id,currency,timeout_seconds,state
                          FROM civo_financial_reservations WHERE allocation_id=? AND job_id=?''',
                        (allocation_id,job_id)).fetchone()
    if existing:
        if tuple(existing)!=(schedule['grant_evidence_id'],schedule['account_scope_id'],schedule['currency'],timeout_seconds,'reserved'):
            raise ValueError('Existing reservation cannot change its grant or amount')
    # Include every active reservation on this grant, not just the current VM.
    # SQLite BEGIN IMMEDIATE belongs to caller and serializes competing claims.
    rows=db.execute('''SELECT amount_usd FROM civo_financial_reservations
                       WHERE grant_evidence_id=? AND account_scope_id=? AND currency=? AND state='reserved'
                       AND NOT (allocation_id=? AND job_id=?)''',
                    (schedule['grant_evidence_id'],schedule['account_scope_id'],schedule['currency'],allocation_id,job_id)).fetchall()
    other=sum((amount(x[0]) for x in rows),Decimal('0'))
    decision=admit(schedule,now,timeout_seconds,charges=charges,other_reservations_usd=other)
    if not decision['allowed']:return decision
    if existing:return dict(decision,existing_financial_reservation=True)
    cost=amount(schedule['conservative_hourly_usd'])*Decimal(timeout_seconds)/3600
    db.execute('''INSERT INTO civo_financial_reservations
                  VALUES (?,?,?,?,?,?,?,'reserved',?,NULL)''',
               (allocation_id,job_id,schedule['grant_evidence_id'],schedule['account_scope_id'],
                schedule['currency'],timeout_seconds,str(cost),now.isoformat()))
    return dict(decision,reserved_task_usd=str(cost))


def release(db, allocation_id, job_id, proof, now):
    if not db.in_transaction:raise ValueError('Financial release requires queue transaction')
    row=db.execute('SELECT state FROM jobs WHERE id=?',(job_id,)).fetchone()
    if not row or row[0] not in {'completed','failed','canceled','interrupted'}:
        raise ValueError('Job is not terminal')
    if (proof.get('allocation_id')!=allocation_id or proof.get('job_id')!=job_id
            or proof.get('processes_stopped') is not True or proof.get('artifacts_exported_verified') is not True):
        raise ValueError('Finalization/export proof required')
    db.execute('''UPDATE civo_financial_reservations SET state='released',released_at=?
                  WHERE allocation_id=? AND job_id=? AND state='reserved' ''',
               (now.isoformat(),allocation_id,job_id))
