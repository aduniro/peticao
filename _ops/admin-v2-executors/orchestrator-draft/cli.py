#!/usr/bin/python3
"""Default dry-run local CLI; there is no remote runner, SSH command or daemon."""
import argparse
from dataclasses import asdict
import json
from pathlib import Path
import sys
import sqlite3
import time

from protocol import ValidationError, canonical_sha256, validate_config, validate_job, validate_ready
from admin_exec.queue import Queue, QueueError

ROOT=Path(__file__).resolve().parent

def read_json(path):
    p=Path(path)
    if p.stat().st_size>2*1024*1024:raise ValidationError("input_too_large")
    def pairs(items):
        result={}
        for key,value in items:
            if key in result:raise ValidationError("duplicate_json_key")
            result[key]=value
        return result
    def invalid_constant(_):raise ValidationError("invalid_json_constant")
    return json.loads(p.read_text(),object_pairs_hook=pairs,parse_constant=invalid_constant)

def parser():
    p=argparse.ArgumentParser(description="Local executor coordination; dry-run by default; never starts remote code")
    p.add_argument("--config",type=Path,default=ROOT/"config.json")
    sub=p.add_subparsers(dest="command",required=True)
    s=sub.add_parser("status");s.add_argument("--job-id")
    s=sub.add_parser("validate");s.add_argument("--job",required=True,type=Path)
    for name in ["enqueue","ready","claim","start","heartbeat","finish","expire"]:
        s=sub.add_parser(name);s.add_argument("--apply-local",action="store_true",help="Persist local queue metadata only; never executes code")
        if name=="enqueue":s.add_argument("--job",required=True,type=Path)
        elif name=="ready":s.add_argument("--ready",required=True,type=Path)
        else:
            s.add_argument("--job-id",required=True)
            if name!="expire":s.add_argument("--expected-version",required=True,type=int)
            if name=="claim":s.add_argument("--worker",required=True,choices=["santiago"])
            if name in ["start","heartbeat","finish"]:
                s.add_argument("--claim-id",required=True);s.add_argument("--generation",required=True,type=int)
            if name=="start":s.add_argument("--process",required=True,type=Path)
            if name=="heartbeat":s.add_argument("--message-id",required=True);s.add_argument("--phase",required=True,choices=["claimed","preparing","building","testing","collecting"])
            if name=="finish":s.add_argument("--result",required=True,type=Path)
    s=sub.add_parser("receipt");s.add_argument("--job-id",required=True)
    return p

def main(argv=None):
    args=parser().parse_args(argv)
    try:
        config=validate_config(read_json(args.config));q=Queue(config["state_path"],config)
        if args.command=="status":result=q.status(args.job_id)
        elif args.command=="validate":
            spec=validate_job(read_json(args.job),config)
            result={"valid_protocol":True,"provenance_verified":False,"dry_run":True,"payload_sha256":spec.payload_sha256,"execution_sha256":spec.execution_sha256,"execution_enabled":config["execution_enabled"]}
        elif args.command=="receipt":result={"receipt":asdict(q.completed_receipt(args.job_id)),"automatic_promotion":False}
        else:
            payload=None
            if args.command=="enqueue":payload=validate_job(read_json(args.job),config)
            if args.command=="ready":payload=validate_ready(read_json(args.ready),config,time.time())
            if not args.apply_local:
                result={"dry_run":True,"action":args.command,"local_metadata_changed":False,"remote_execution":False,"execution_enabled":config["execution_enabled"],"queue":q.status()}
                if payload is not None:result["validated_payload_sha256"]=payload.payload_sha256 if hasattr(payload,"payload_sha256")else canonical_sha256(payload)
            elif args.command=="enqueue":result=q.enqueue(payload)
            elif args.command=="ready":result=q.register_ready(payload)
            elif args.command=="claim":result=q.claim(args.job_id,args.worker,args.expected_version)
            elif args.command=="start":result=q.start(args.job_id,args.claim_id,args.generation,args.expected_version,read_json(args.process))
            elif args.command=="heartbeat":result=q.heartbeat(args.job_id,args.claim_id,args.generation,args.expected_version,args.message_id,args.phase)
            elif args.command=="finish":result=q.finish(args.job_id,args.claim_id,args.generation,args.expected_version,read_json(args.result))
            elif args.command=="expire":result=q.expire(args.job_id)
            else:raise QueueError("unknown_action")
            result["remote_execution"]=False
        print(json.dumps(result,ensure_ascii=False,sort_keys=True));return 0
    except (ValidationError,QueueError,ValueError,OSError,sqlite3.Error) as error:
        code=str(error) if isinstance(error,(ValidationError,QueueError))else type(error).__name__
        print(json.dumps({"ok":False,"error":code,"remote_execution":False},sort_keys=True));return 2

if __name__=="__main__":raise SystemExit(main())
