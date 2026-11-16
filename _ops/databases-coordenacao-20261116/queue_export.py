"""Read-only admin queue projection. Run on its host, never through mutating RPC."""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3


def export(path, source_id):
    with sqlite3.connect(Path(path).resolve().as_uri()+'?mode=ro',uri=True) as db:
        db.row_factory=sqlite3.Row;db.execute('PRAGMA query_only=ON');db.execute('BEGIN')
        count=db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0]
        if count>10000:raise ValueError('requires_explicit_pagination')
        snapshot={'source_id':source_id,'watermark':db.execute('SELECT COALESCE(MAX(seq),0) FROM events').fetchone()[0],
                  'jobs':[dict(r) for r in db.execute('SELECT id,state,generation,digest,created_at,updated_at FROM jobs ORDER BY id')]}
    raw=json.dumps(snapshot,sort_keys=True,ensure_ascii=False,separators=(',',':'))
    snapshot['sha256']=hashlib.sha256(raw.encode()).hexdigest()
    return snapshot


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source',required=True);p.add_argument('--source-id',default='santiago-admin');a=p.parse_args()
    print(json.dumps(export(a.source,a.source_id),ensure_ascii=False,separators=(',',':')))
