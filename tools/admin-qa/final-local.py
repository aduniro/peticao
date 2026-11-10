#!/usr/bin/python3
"""Isolated final candidate checks. No production configuration, providers or databases."""
import argparse, fcntl, hashlib, json, os, socket, subprocess, time, shutil
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
SITE = ROOT / "site"
NODE = Path("/home/barre/.cache/peticao-qa-node20-20.19.2/node-v20.19.2-linux-x64/bin/node")
NODE_SHA = "b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac"
parser = argparse.ArgumentParser()
parser.add_argument("mode", choices=["types", "build", "targeted", "schema", "full", "regression", "documents", "a1-http", "base-validation"])
args = parser.parse_args()
assert ROOT == Path("/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109")
assert hashlib.sha256(NODE.read_bytes()).hexdigest() == NODE_SHA
for name in [".env", ".env.local", ".env.production", ".env.production.local"]:
    assert not (SITE / name).exists(), "Real environment files are forbidden"
base = ROOT.parent / "admin-v2-retomada-20261109" / "integrated"
base.mkdir(mode=0o700, parents=True, exist_ok=True)
# Next build replaces .next/types; serialise it with tsc. DB modes share one port.
resource = "next-output" if args.mode in ["types", "build"] else "qa-postgres"
lock = (base / (resource + ".lock")).open("a")
os.chmod(lock.name, 0o600)
try:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    print("Waiting for isolated QA resource:", resource, flush=True)
    fcntl.flock(lock, fcntl.LOCK_EX)
commit_before = subprocess.check_output(["/usr/bin/git", "-C", str(ROOT), "rev-parse", "HEAD"], text=True).strip()
scratch = base / (args.mode + "-" + str(time.time_ns()))
scratch.mkdir(mode=0o700, parents=True)
for d in ["empty", "tmp"]: (scratch / d).mkdir(mode=0o700)
assert not subprocess.check_output(["/usr/bin/git", "-C", str(ROOT), "ls-files", "--others", "--exclude-standard", "site", "deploy/test", "tools/signing"], text=True).strip(), "Track source files before freezing QA"
tracked = subprocess.check_output(["/usr/bin/git", "-C", str(ROOT), "ls-files", "site", "deploy/test", "tools/signing"], text=True).splitlines()
def manifest():
    return {f: hashlib.sha256((ROOT/f).read_bytes()).hexdigest() for f in tracked if (ROOT/f).is_file()}
short = Path("/mnt/apps/peticao-final/_qa") / ("a1-" + str(time.time_ns()))
short.mkdir(mode=0o700, parents=True)
geo = Path("/mnt/apps/peticao-final/peticao/site/geo-data")
geo_hashes = {name: hashlib.sha256((geo/name).read_bytes()).hexdigest() for name in ["dbip-city-lite.mmdb", "dbip-asn-lite.mmdb"]}
before = manifest()
env = {k: os.environ[k] for k in ["HOME", "LANG", "LC_ALL"] if k in os.environ}
env.update(PATH=str(NODE.parent)+":/usr/bin:/bin", NODE_ENV="test", MAIL_PROVIDER="dev", SIGNER="none", NEXT_TELEMETRY_DISABLED="1",
    GEO_DIR=str(geo), DEV_DB_PORT="54375", DEV_DB_DIR=str(scratch/"postgres"), TMPDIR=str(short), DATABASE_URL="postgres://peticao:peticao@127.0.0.1:54375/peticao",
    HASH_PEPPER="QA-ADMIN-FINAL-NEVER-PRODUCTION-0123456789", SECRETS_DIR=str(scratch/"empty"), PETICAO_CONFIG_DIR=str(scratch/"empty"), CREDENTIALS_DIRECTORY=str(scratch/"empty"))
if args.mode in ["targeted", "full", "schema", "regression", "documents", "a1-http"]:
    with socket.socket() as s: assert s.connect_ex(("127.0.0.1",54375)) != 0, "QA port occupied"
if args.mode == "types": command=[str(NODE),"node_modules/typescript/bin/tsc","--noEmit","--incremental","false"]
elif args.mode == "build":
    env.update(NODE_ENV="production", PREVIEW_MODE="1", DATABASE_URL="postgres://peticao:peticao@127.0.0.1:1/peticao", ADMIN_PASSWORD="QA-FINAL-NOT-REAL", CPF_CACHE_ENCRYPTION_KEY="QA-ADMIN-FINAL-CACHE-KEY-FICTITIOUS", MAIL_PROVIDERS="dev")
    command=[str(NODE),"node_modules/next/dist/bin/next","build"]
elif args.mode == "base-validation": command=[str(NODE),"--import","tsx","--test","--test-concurrency=1","src/lib/petition-base-validation-http.test.ts","src/lib/petition-base-validation.test.ts"]
elif args.mode == "schema": command=[str(NODE),"scripts/with-db.mjs",str(NODE),"--import","tsx","../deploy/test/admin-schema-upgrade.mjs"]
else:
    if args.mode == "full": files=sorted(str(p.relative_to(SITE)) for folder in [SITE/"src/lib",SITE/"src/i18n"] for p in folder.glob("*.test.ts"))
    elif args.mode == "a1-http": files=["src/lib/"+f+".test.ts" for f in ["a1-job-view", "a1-request", "a1-reconciliation", "batch-a1-jobs", "batch-a1-route"]]
    elif args.mode == "documents": files=sorted(str(p.relative_to(SITE)) for p in (SITE/"src/lib").glob("*.test.ts") if p.name.startswith(("batch", "document", "president", "a1-", "petition-base")))
    elif args.mode == "regression": files=["src/lib/"+f+".test.ts" for f in ["admin-ip", "ai-context", "batch-document-history", "contact-campus-references", "contact-triage", "geo-coexistencia", "geo-retry", "painel-ui"]]
    else: files=["src/lib/"+f+".test.ts" for f in ["a1-worker-contract","a1-worker-client","a1-validation","a1-job-view","batch-a1-executor","batch-a1-jobs","batch-a1-route","batch-document-history","admin-settings-domains","institution-registry","institutional","server-email","sign-flow"]]
    command=[str(NODE),"scripts/with-db.mjs",str(NODE),"--import","tsx","--test","--test-concurrency=1",*files]
print("Check:",args.mode,"; evidence:",scratch,flush=True)
with (scratch/"validation.log").open("w") as log: code=subprocess.run(command,cwd=SITE,env=env,stdout=log,stderr=subprocess.STDOUT).returncode
same = before == manifest()
shutil.rmtree(short)
commit_after = subprocess.check_output(["/usr/bin/git", "-C", str(ROOT), "rev-parse", "HEAD"], text=True).strip()
result={"commitStable": commit_before == commit_after, "startedCommit": commit_before, "mode":args.mode,"exit":code,"sourceStable":same,"node":"20.19.2","nodeSha256":NODE_SHA,"commit":subprocess.check_output(["/usr/bin/git","-C",str(ROOT),"rev-parse","HEAD"],text=True).strip(),"command":command,"trackedFiles":len(before),"geoData":geo_hashes,"log":str(scratch/"validation.log")}
(scratch/"result.json").write_text(json.dumps(result,indent=2));(scratch/"source-manifest.json").write_text(json.dumps(before,sort_keys=True))
print(json.dumps(result),flush=True)
if code: print((scratch/"validation.log").read_text()[-6000:])
raise SystemExit(code if same and commit_before == commit_after else 2)
