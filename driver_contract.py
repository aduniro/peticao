"""Pure real-profile plans and wire-descriptor bridge; no host operations.

A plan hash is never a WorkerRPC profile hash. Global readiness is always false
here; native qualification and the operational catalog remain separate gates.
"""
from copy import deepcopy
import hashlib
import json
from pathlib import PurePosixPath
import re

import artifact_policy
import resource_plan

TOOLS = "/opt/peticao-dev-profile-tools-v1"
PROGRAM = TOOLS + "/driver.py"
PYTHON = TOOLS + "/python312/bin/python3.12"
POLICY_PATH = TOOLS + "/driver-policy.json"
KINDS = frozenset({"admin-typecheck-v1", "admin-build-v1", "admin-qa-v1"})
HELPERS = frozenset({"driver_contract.py", "input_provider.py", "artifact_policy.py", "resource_plan.py", "qa_adapter.py", "process_runner.py", "sealed_policy.py", "runtime_steps.py"})
SOURCE = {"app_commit": "c472837fb5a4584d81f34c420f4de30989084f85", "site_tree": "14409ebfce08daa337f6b2dfc392fe38b54ee86d", "harness_commit": "09d1d66d0e821e92d96bd83de70afdb832a31bc6", "sha256": "19db95b7c0628dac9fbcec961adbdf3a01bfa00b1519f28a376427e80707a4d5", "bytes":11959902, "path":TOOLS+"/inputs/source.tar.gz"}
PARENT_DEPS = {"sha256":"3009712141b019777b6395e36a628f4e1c0b8720fb617e4ffe5c814d91670698", "bytes":207013889}
NODE_SHA = "b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac"
QA_COUNTS = {"backend":43,"http":7,"browser":40,"maps":2,"http_reset":8}
TOOL_REFS = {
 "node":{"path":TOOLS+"/node20","version":"20.19.2","sha256":NODE_SHA,"bytes":99836400},
 "python":{"path":PYTHON,"version":"3.12.3","sha256":None,"bytes":None},
 "postgres":{"path":TOOLS+"/postgres/bin/postgres","version":"18.4","sha256":"de0a4a7646c51f032e0088ae6fe9d0833fa280b78d4455681574a32937b32838","bytes":9788000},
 "initdb":{"path":TOOLS+"/postgres/bin/initdb","version":"18.4","sha256":"515186eed81a1f2741bdcbfeb080af093a59a27fb2896237b04dd6c48bae349d","bytes":191688},
 "pg_ctl":{"path":TOOLS+"/postgres/bin/pg_ctl","version":"18.4","sha256":"6beab6014ea28dcc78b8c6a43ec9e3e20536e13a175d75151107410ac866c481","bytes":77832},
 "chromium":{"path":TOOLS+"/chromium/chrome-linux64/chrome","version":"151.0.7922.34","sha256":None,"bytes":None},
}
DESCRIPTOR_KEYS = frozenset({"version","name","program","program_sha256","python_path","python_sha256","source_sha256","dependencies_sha256","artifact_policy_sha256","plan_sha256","resources","artifact_policy"})


def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(",",":"),allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def hex_value(value):
    if type(value) is not str or not re.fullmatch("[a-f0-9]{64}",value) or value=="0"*64:
        raise ValueError("nonzero_sha256_required")
    return value


def integer(value,minimum=0,maximum=2**63-1):
    if type(value) is not int or not minimum<=value<=maximum:
        raise ValueError("bounded_typed_integer_required")
    return value


def exact(value,keys):
    if type(value) is not dict or set(value)!=set(keys):
        raise ValueError("exact_schema_required")
    return value


def dependencies_reference():
    return {"version":1,"parent_archive":deepcopy(PARENT_DEPS),
            "normalized_archive":{"path":TOOLS+"/inputs/dependencies.normalized.tar.gz","sha256":None,"bytes":None},
            "normalization_receipt_sha256":None,"toolchain":deepcopy(TOOL_REFS),
            "toolchain_inventory_sha256":None,"qa_closure_sha256":None,
            "full_integrity_attestation":{"manifest_event":None,"inventory_sha256":None,"evidence_sha256":None},
            "original_cache_full_integrity_verified":False}


def validate_dependencies(value, execution=False):
    exact(value,dependencies_reference())
    if type(value["version"]) is not int or value["version"]!=1 or canonical(value["parent_archive"])!=canonical(PARENT_DEPS) or value["original_cache_full_integrity_verified"] is not False:
        raise ValueError("frozen_dependency_provenance_required")
    archive=exact(value["normalized_archive"],{"path","sha256","bytes"})
    if archive["path"]!=TOOLS+"/inputs/dependencies.normalized.tar.gz":raise ValueError("fixed_normalized_archive_path_required")
    pending=[]
    for field in ("sha256","bytes"):
        if archive[field] is None:pending.append("normalized_archive."+field)
        elif field=="sha256":hex_value(archive[field])
        else:integer(archive[field],1,2**32)
    for field in ("normalization_receipt_sha256","toolchain_inventory_sha256","qa_closure_sha256"):
        if value[field] is None:pending.append(field)
        else:hex_value(value[field])
    tools=exact(value["toolchain"],TOOL_REFS)
    for name,ref in TOOL_REFS.items():
        tool=exact(tools[name],ref)
        if tool["path"]!=ref["path"] or tool["version"]!=ref["version"]:raise ValueError("fixed_tool_path_and_version_required")
        for field in ("sha256","bytes"):
            actual=tool[field]
            if actual is None:pending.append("toolchain."+name+"."+field)
            elif field=="sha256":
                hex_value(actual)
                if ref[field] is not None and actual!=ref[field]:raise ValueError("frozen_tool_binary_pin_changed")
            else:
                integer(actual,1,2**32)
                if ref[field] is not None and actual!=ref[field]:raise ValueError("frozen_tool_binary_size_changed")
    proof=exact(value["full_integrity_attestation"],{"manifest_event","inventory_sha256","evidence_sha256"})
    for field in proof:
        if proof[field] is None:pending.append("full_integrity_attestation."+field)
        elif field=="manifest_event":integer(proof[field],1,2**53)
        else:hex_value(proof[field])
    if execution and pending:raise PermissionError("complete_sealed_inputs_required")
    return pending


def plan(kind, dependencies=None, budget=None):
    if type(kind) is not str or kind not in KINDS:raise ValueError("fixed_real_profile_required")
    deps=deepcopy(dependencies_reference() if dependencies is None else dependencies)
    missing=validate_dependencies(deps)
    budget=budget or ("balanced-v1" if kind=="admin-typecheck-v1" else "heavy-candidate-v1")
    resources=resource_plan.plan(budget)
    phases=["verify-inputs","prepare-offline-assets","typecheck"]
    if kind!="admin-typecheck-v1":phases += ["build","export-runtime"]
    if kind=="admin-qa-v1":phases += ["qa100"]
    phases += ["drain"]
    return {"version":1,"name":kind,"source":deepcopy(SOURCE),"dependencies":deps,
            "resources":resources,"artifact_policy":artifact_policy.policy(),"phases":phases,
            "layout":{"source":"source","site":"source/site","tmp":"t","empty_config":"e","postgres":"p","compiled":"compiled","artifacts":"artifacts","relative_to":"trusted_StateDirectory_namespace_alias","fresh_job_root_required":True,"old_paths_or_units_reused":False},
            "environment_policy":{"inherit":False,"dotenv_allowed":False,"credentials_allowed":False,"mail":"development_fixture_only","whatsapp":False,"cron":False,"external_network":False,"loopback_fixtures_only":True},
            "qa_counts":deepcopy(QA_COUNTS) if kind=="admin-qa-v1" else None,
            "qa_steps":["postgres-init","backend43","fixture-seed","runtime-start","http7","browser40","maps2","http-reset8","fixture-refresh"] if kind=="admin-qa-v1" else None,
            "qualification":{"qualified":False,"operationalReady":False,"qualification_manifest_event":None},
            "pending_pins":missing,"historical_budget_is_measured_minimum":False}


def worker_descriptor(kind,driver_sha256,dependencies,budget=None):
    """A sealed candidate descriptor, never a qualified operational admission."""
    hex_value(driver_sha256);validate_dependencies(dependencies,execution=True)
    p=plan(kind,dependencies,budget)
    result={"version":2,"name":kind,"program":PROGRAM,"program_sha256":driver_sha256,
            "python_path":PYTHON,"python_sha256":dependencies["toolchain"]["python"]["sha256"],
            "source_sha256":SOURCE["sha256"],"dependencies_sha256":digest(dependencies),
            "artifact_policy_sha256":artifact_policy.digest_policy(),"plan_sha256":digest(p),
            "resources":deepcopy(p["resources"]),"artifact_policy":artifact_policy.policy()}
    validate_worker_descriptor(result)
    return result


def validate_worker_descriptor(value):
    exact(value,DESCRIPTOR_KEYS)
    if type(value["version"]) is not int or value["version"]!=2 or type(value["name"]) is not str or value["name"] not in KINDS or value["program"]!=PROGRAM or value["python_path"]!=PYTHON:
        raise ValueError("fixed_driver_descriptor_v2_required")
    for key in ("program_sha256","python_sha256","source_sha256","dependencies_sha256","artifact_policy_sha256","plan_sha256"):hex_value(value[key])
    if value["source_sha256"]!=SOURCE["sha256"] or canonical(value["artifact_policy"])!=canonical(artifact_policy.policy()) or value["artifact_policy_sha256"]!=artifact_policy.digest_policy():
        raise ValueError("frozen_source_and_artifact_policy_required")
    resource_plan.validate(value["resources"])
    return deepcopy(value)


def catalog_candidate(kind,driver_sha256=None,dependencies=None,budget=None):
    deps=deepcopy(dependencies_reference() if dependencies is None else dependencies);p=plan(kind,deps,budget)
    missing=validate_dependencies(deps)
    if driver_sha256 is None:missing=[*missing,"driver.program_sha256"]
    descriptor=None
    if not missing:descriptor=worker_descriptor(kind,driver_sha256,deps,budget)
    return {"version":2,"kind":kind,"plan_sha256":digest(p),"worker_descriptor":descriptor,
            "profile_sha256":digest(descriptor) if descriptor is not None else None,
            "qualified":False,"operationalReady":False,"missing_pins":missing,
            "requires_native_profile_qualification":True,"requires_runtime_successor":True}


def relative_path(value):
    if type(value) is not str or not value or value.startswith('/') or '\\' in value:
        raise ValueError("relative_job_path_required")
    parts=PurePosixPath(value).parts
    if any(x in {'','..','.'} for x in parts) or str(PurePosixPath(value))!=value:
        raise ValueError("canonical_relative_job_path_required")
    return value
