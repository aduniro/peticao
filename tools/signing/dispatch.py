#!/usr/bin/python3
"""Private scheduler client; no user data, certificate or signing parameters accepted."""
import json, os, re, stat, sys, urllib.error, urllib.request
from pathlib import Path
URL = "http://127.0.0.1:3000/api/cron/a1"
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl): return None

def dispatch(credential_directory, opener=None):
    try:
        directory=Path(credential_directory)
        if not directory.is_absolute(): return {"ok":False,"error":"credential_unavailable"}
        fd=os.open(directory/"cron-token",os.O_RDONLY|os.O_NOFOLLOW)
        try:
            info=os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_uid not in (0,os.geteuid()) or not 16<=info.st_size<=4096: return {"ok":False,"error":"credential_unavailable"}
            raw=os.read(fd,4097)
        finally: os.close(fd)
        token=raw.decode("ascii").rstrip("\r\n")
        if not 16<=len(token)<=4096 or any(ord(x)<33 or ord(x)>126 for x in token): return {"ok":False,"error":"credential_unavailable"}
        request=urllib.request.Request(URL,data=b"",headers={"Authorization":"Bearer "+token},method="POST")
        client=opener or urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
        with client.open(request,timeout=110) as response:
            if response.status!=200: return {"ok":False,"error":"dispatch_unavailable","status":response.status}
            body=response.read(2049)
        if len(body)>2048: return {"ok":False,"error":"dispatch_response_invalid"}
        value=json.loads(body.decode("utf-8"))
        allowed={"disabled","empty","not_claimed","worker_unavailable","validation_failed","input_mismatch","succeeded","not_published","result_uncertain","unavailable"}
        if not isinstance(value,dict) or type(value.get("ran")) is not bool or value.get("state") not in allowed: return {"ok":False,"error":"dispatch_response_invalid"}
        return {"ok":True,"state":value["state"],"ran":value["ran"]}
    except urllib.error.HTTPError as error: return {"ok":False,"error":"dispatch_unavailable","status":error.code}
    except Exception: return {"ok":False,"error":"dispatch_unavailable"}
if __name__=="__main__":
    result=dispatch(os.environ.get("CREDENTIALS_DIRECTORY",""));print(json.dumps(result));sys.exit(0 if result["ok"] else 1)
