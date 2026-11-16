#!/usr/bin/python3
"""Exclusive persistent spool worker. CLI keeps live bridge/mail disabled."""
from __future__ import annotations
import argparse
import fcntl
import json
import os
from pathlib import Path
import signal
import threading
import time
import uuid

try:
    from .executor import Config, Executor, OWNER
except ImportError:
    from executor import Config, Executor, OWNER


class Worker:
    def __init__(self, executor, deliver=None, interval=2, stop_event=None, paused=None, heartbeat=None):
        if not 0.05 <= interval <= 60:
            raise ValueError('worker_interval_limit')
        self.executor=executor
        self.deliver=deliver
        self.interval=interval
        self.stop=stop_event or threading.Event()
        self.paused=paused or (lambda:False)
        self.heartbeat=heartbeat
        self.cycles=0

    def deliver_once(self):
        # No callback means unavailable transport, not a failed/attempted delivery.
        if self.deliver is None:
            return {'state':'transport_unavailable','claimed':False}
        message=self.executor.outbox_claim()
        if not message:
            return None
        if message['recipient']!=OWNER:
            raise PermissionError('fixed_owner_recipient_required')
        try:
            result=self.deliver(message)
            if not isinstance(result,dict) or result.get('state') not in {'accepted','rejected','uncertain'}:
                result={'state':'uncertain'}
            receipt=result.get('provider_id')
            if receipt is not None and (not isinstance(receipt,str) or len(receipt)>256):
                result,receipt={'state':'uncertain'},None
        except Exception:
            result,receipt={'state':'uncertain'},None
        return self.executor.outbox_result(message['id'],result['state'],receipt)

    def pulse(self, state, **extra):
        value={'state':state,'at':int(time.time()),'cycles':self.cycles,'bridge_mode':self.executor.adapter.mode,'mail_transport_configured':self.deliver is not None,**extra}
        if self.heartbeat:
            self.heartbeat(value)
        return value

    def run(self, max_cycles=None):
        """max_cycles is a bounded fixture harness; production CLI runs until stop."""
        if max_cycles is not None and (type(max_cycles) is not int or max_cycles<1):
            raise ValueError('positive_fixture_cycles_required')
        lock_path=self.executor.path.with_suffix('.worker.lock')
        if lock_path.is_symlink():
            raise PermissionError('worker_lock_symlink_refused')
        with lock_path.open('a') as lock:
            os.chmod(lock_path,0o600)
            try:
                fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError:
                raise BlockingIOError('executor_worker_already_running') from None
            # Recovery happens once only, while holding the complete lifetime lock.
            self.executor.recover()
            self.pulse('started')
            while not self.stop.is_set():
                error=False
                try:
                    is_paused=self.paused()
                    if type(is_paused) is not bool:
                        raise ValueError('pause_callback_must_return_bool')
                    if not is_paused:
                        self.executor.dispatch_once()
                    # Poll is observation only; it must not resume a paused session.
                    self.executor.poll_once()
                    delivery=self.deliver_once()
                except Exception:
                    # Durable submit/outbox intentions stay in the journal. Never
                    # run recovery in this loop or replay a submit on an exception.
                    error=True
                    delivery=None
                self.cycles+=1
                self.pulse('running' if not error else 'error',paused=is_paused if not error else None,delivery_state=delivery.get('state') if isinstance(delivery,dict) else None)
                if error:
                    # A supervisor may restart later; this process never recovers
                    # or replays an ambiguous operation midway through its loop.
                    return self.pulse('failed',error='worker_cycle_requires_restart_and_reconciliation')
                if max_cycles is not None and self.cycles>=max_cycles:
                    break
                self.stop.wait(self.interval)
            return self.pulse('stopped')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config',required=True)
    parser.add_argument('--database',required=True)
    parser.add_argument('--interval',type=float,default=2)
    args=parser.parse_args()
    os.umask(0o077)
    database=Path(args.database)
    if not database.is_absolute():
        raise ValueError('absolute_database_required')
    executor=Executor(database,Config.load(args.config))
    stopped=threading.Event()
    signal.signal(signal.SIGTERM,lambda *_:stopped.set())
    signal.signal(signal.SIGINT,lambda *_:stopped.set())
    # No shell/config string can enable live bridge, mail or arbitrary callbacks.
    worker=Worker(executor,interval=args.interval,stop_event=stopped,heartbeat=lambda value:print(json.dumps(value),flush=True))
    if worker.run()['state']=='failed':
        raise SystemExit(1)


if __name__=='__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'state':'error','error':type(error).__name__,'trace_id':uuid.uuid4().hex}),flush=True)
        raise SystemExit(1)
