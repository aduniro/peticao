#!/usr/bin/env python3
"""One-way live receiver. Its stdout contains aggregate state only."""
import json,os,time
from sync import sync,SyncBusy
from name_alerts import refresh_alert_queue
interval=max(15,int(os.environ.get('CPF_REVIEW_SYNC_INTERVAL','30')))
while True:
 started=time.monotonic()
 try:
  result=sync();state=result['sync']
  refresh_alert_queue()
  print(json.dumps({'state':state['state'],'source_at':state.get('last_source_at'),'changed_records':state.get('last_changed_records',0)}),flush=True)
 except SyncBusy:print('SYNC_BUSY',flush=True)
 except Exception as error:print('SYNC_RETRY '+type(error).__name__,flush=True)
 time.sleep(max(1,interval-(time.monotonic()-started)))
