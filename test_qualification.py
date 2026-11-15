import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest import mock

import qualification_contract as q
import qualification_helper as helper
import qualification_client as client
import review_gate as gate
from runtime import cgroups as shared_cgroups

HERE = Path(__file__).resolve().parent


def operation(execute=False):
    return {"version": 1, "operation_id": "a"*32, "jobs": {"success":"1"*32,"failure":"2"*32,"cancellation":"3"*32},
            "runtime_commit":"b"*40,"runtime_sha256":{name:"c"*64 for name in q.RUNTIME},
            "harness_sha256":{name:"d"*64 for name in q.HARNESS},"execute":execute}


def outcomes():
    return {name:{"state":state,"exit_code":code,"invocation_id":str(i)*32,"unit_stopped":True,"cgroup_empty":True,
                  "cgroup_pids_before_stop":2 if name=="cancellation" else 0,"state_directory_persisted":True,
                  "artifact_verified":True,"receipt_sha256":"a"*64,
                  "isolation":{key:True for key in q.CHECKS}}
            for i,(name,state,code) in enumerate((("success","completed",0),("failure","failed",7),("cancellation","canceled",None)),1)}


class Contracts(unittest.TestCase):
    def test_preparation_default_cannot_execute(self):
        q.operation(operation())
        with self.assertRaises(PermissionError):q.operation(operation(),True)

    def test_exact_keys_types_and_pins_required(self):
        for key in operation():
            value=operation();value.pop(key)
            with self.assertRaises(ValueError):q.operation(value)
        for key,field in (("version",True),("jobs",[]),("runtime_commit","bad"),("runtime_sha256",{"../worker.py":"c"*64}),("execute",1)):
            value=operation();value[key]=field
            with self.assertRaises((ValueError,PermissionError)):q.operation(value)

    def test_no_duplicate_or_unsafe_unit_names(self):
        value=operation();value["jobs"]["failure"]=value["jobs"]["success"]
        with self.assertRaises(ValueError):q.operation(value)
        for job in ("*","../else",True,"f"*31,"F"*32):
            with self.assertRaises(ValueError):q.unit(job)
        self.assertEqual(q.unit("a"*32),"admin-dev-"+"a"*32+"-g1.service")

    def test_unfrozen_runtime_cannot_execute(self):
        value=operation(True);value["runtime_commit"]="0"*40
        with self.assertRaises(PermissionError):q.operation(value,True)
        value=operation(True);value["runtime_sha256"]["worker.py"]="0"*64
        with self.assertRaises(PermissionError):q.operation(value,True)

    def test_actual_property_limits_cannot_be_omitted_or_weakened(self):
        props={**q.LIMIT_PROPERTIES,"InvocationID":"a"*32}
        q.properties(props)
        for key in q.LIMIT_PROPERTIES:
            changed=dict(props);changed[key]="incorrect"
            with self.assertRaises(PermissionError):q.properties(changed)

    def test_synthetic_or_missing_invocation_id_refused(self):
        for inv in ("synthetic-123",None,True,"Z"*32):
            with self.assertRaises(ValueError):q.properties({**q.LIMIT_PROPERTIES,"InvocationID":inv})

    def test_three_outcomes_cannot_be_conflated(self):
        self.assertTrue(q.accept_results(outcomes()))
        for name in outcomes():
            value=outcomes();value[name]["state"]="completed" if name!="success" else "failed"
            with self.assertRaises(PermissionError):q.accept_results(value)

    def test_false_boolean_exit_not_valid_exit0(self):
        value=outcomes();value["success"]["exit_code"]=False
        with self.assertRaises(PermissionError):q.accept_results(value)

    def test_stop_proof_cgroup_and_checks_required(self):
        for field in ("unit_stopped","cgroup_empty"):
            value=outcomes();value["cancellation"][field]=False
            with self.assertRaises(PermissionError):q.accept_results(value)
        for key in q.CHECKS:
            value=outcomes();value["success"]["isolation"].pop(key)
            with self.assertRaises(PermissionError):q.accept_results(value)

    def test_no_top_level_runtime_or_host_effects(self):
        # Importing the candidate never imports runtime, spawns a process,
        # checks network or writes files. Tests do not run qualification_job.
        spec=importlib.util.spec_from_file_location("isolated_helper",HERE/"qualification_helper.py")
        module=importlib.util.module_from_spec(spec)
        with mock.patch.object(helper.subprocess,"run",side_effect=AssertionError("no commands")),mock.patch.object(helper.subprocess,"Popen",side_effect=AssertionError("no processes")),mock.patch.object(Path,"write_text",side_effect=AssertionError("no writes")):
            spec.loader.exec_module(module)

    def test_wrong_host_or_nonroot_refused_before_code_reads(self):
        with mock.patch.object(helper.os,"geteuid",return_value=1000),mock.patch.object(helper,"read_json",side_effect=AssertionError("no reads")):
            with self.assertRaises(PermissionError):helper.load()
        with mock.patch.object(helper.os,"geteuid",return_value=0),mock.patch.object(helper.socket,"gethostname",return_value="other-node"),mock.patch.object(helper,"read_json",side_effect=AssertionError("no reads")):
            with self.assertRaises(PermissionError):helper.load()

    def test_uninstalled_helper_path_refused_before_reads(self):
        with mock.patch.object(helper.os,"geteuid",return_value=0),mock.patch.object(helper.socket,"gethostname",return_value="peticao-civo"):
            with self.assertRaises(PermissionError):helper.load()

    def fake_public(self, root, execute):
        request=operation(execute)
        for name in q.RUNTIME | q.HARNESS:
            (root/name).write_text("# synthetic code bytes, never executed\n")
        request["runtime_sha256"]={name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in q.RUNTIME}
        request["harness_sha256"]={name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in q.HARNESS}
        (root/"RUN-REQUEST.json").write_text(json.dumps(request))
        (root/"readonly-marker").write_bytes(b"synthetic public readonly marker\n")
        return request

    def test_bad_pin_refused_before_any_dynamic_import(self):
        with tempfile.TemporaryDirectory(dir=HERE,prefix="fixture-") as tmp:
            root=Path(tmp);request=self.fake_public(root,True);request["runtime_sha256"]["worker.py"]="0"*64
            with mock.patch.object(helper,"PUBLIC",root),mock.patch.object(helper,"__file__",str(root/"qualification_helper.py")),mock.patch.object(helper.os,"geteuid",return_value=0),mock.patch.object(helper.socket,"gethostname",return_value="peticao-civo"),mock.patch.object(helper,"root_file",side_effect=lambda p,*a,**k:p),mock.patch.object(helper,"read_json",return_value=request),mock.patch.object(helper.importlib,"import_module") as imports:
                with self.assertRaises(PermissionError):helper.load()
            imports.assert_not_called()

    def test_prepare_flag_refused_before_runtime_imports(self):
        with tempfile.TemporaryDirectory(dir=HERE,prefix="fixture-") as tmp:
            root=Path(tmp);request=self.fake_public(root,False)
            with mock.patch.object(helper,"PUBLIC",root),mock.patch.object(helper,"__file__",str(root/"qualification_helper.py")),mock.patch.object(helper.os,"geteuid",return_value=0),mock.patch.object(helper.socket,"gethostname",return_value="peticao-civo"),mock.patch.object(helper,"root_file",side_effect=lambda p,*a,**k:p),mock.patch.object(helper,"read_json",return_value=request),mock.patch.object(helper.importlib,"import_module",return_value=q) as imports:
                with self.assertRaises(PermissionError):helper.load()
            self.assertEqual([c.args[0] for c in imports.call_args_list],["qualification_contract"])

    def test_bounded_control_json_and_symlinks_refused(self):
        with tempfile.TemporaryDirectory(dir=HERE,prefix="fixture-") as tmp:
            path=Path(tmp)/"control.json";path.write_text("x"*(2*1024*1024+1))
            with mock.patch.object(helper,"root_file",side_effect=lambda p:p):
                with self.assertRaises(ValueError):helper.read_json(path)
            link=Path(tmp)/"link";link.symlink_to(path)
            with self.assertRaises(PermissionError):helper.root_file(link)

    def test_durable_evidence_names_not_client_paths(self):
        fake={"artifacts":mock.Mock()}
        for name in ("../result.json","a/b.json","*.json","result.txt"):
            with self.assertRaises(ValueError):helper.durable(fake,name,{})
        fake["artifacts"].durable_json.assert_not_called()

    def test_occupied_attempt_never_reinitializes(self):
        adapter=mock.Mock();modules={"qualification_contract":q,"remote_contract":mock.Mock(),"artifacts":mock.Mock(),"systemd_adapter":mock.Mock()}
        modules["systemd_adapter"].SystemdAdapter.return_value=adapter
        with mock.patch.object(helper,"root_file"),mock.patch.object(helper.os.path,"lexists",return_value=True):
            with self.assertRaises(PermissionError):helper.bootstrap(operation(True),modules)
        adapter.preflight.assert_not_called()
        modules["artifacts"].durable_json.assert_not_called()

    def test_start_intent_collision_blocks_process_spawn(self):
        modules={"artifacts":mock.Mock()};modules["artifacts"].durable_json.side_effect=FileExistsError
        with mock.patch.object(helper,"root_file"),mock.patch.object(helper.subprocess,"Popen") as spawn:
            with self.assertRaises(FileExistsError):helper.start(operation(True),modules)
        spawn.assert_not_called()

    def test_run_intent_collision_blocks_all_effects(self):
        modules={"artifacts":mock.Mock()};modules["artifacts"].durable_json.side_effect=FileExistsError
        with mock.patch.object(helper,"process_identity",return_value={}),mock.patch.object(helper,"build") as build:
            with self.assertRaises(FileExistsError):helper.run_locked(operation(True),modules)
        build.assert_not_called()

    def test_baseline_never_reads_application_data_or_commandlines(self):
        responses=["sample.service loaded active running synthetic\n","MainPID=5\nInvocationID="+"a"*32+"\n"]
        with mock.patch.object(helper,"command",side_effect=responses) as call:
            value=helper.baseline()
        self.assertIn("sample.service",value)
        self.assertEqual(call.call_count,2)
        self.assertTrue(all(argv[0]=="/usr/bin/systemctl" for argv, in [x.args for x in call.call_args_list]))

    def test_preserve_boot_or_operation_mismatch_without_loading_db(self):
        modules={"remote_contract":mock.Mock(),"qualification_contract":q}
        with mock.patch.object(helper,"root_file"),mock.patch.object(helper,"read_json",return_value={"operation_sha256":"0"*64,"boot_id":"old"}):
            with self.assertRaises(PermissionError):helper.build(operation(True),modules)
        modules["remote_contract"].Claims.assert_not_called()

    def test_default_ssh_gate_refuses_before_network(self):
        with mock.patch.object(client.subprocess,"run") as run:
            with self.assertRaises(PermissionError):client.PinnedSSH().call("observe")
        run.assert_not_called()

    def test_transport_command_is_fixed_pinned_no_root_key_copy(self):
        argv=client.PinnedSSH().argv()
        for required in ("StrictHostKeyChecking=yes","IdentitiesOnly=yes","BatchMode=yes","HostKeyAlias="+client.ALIAS,"UserKnownHostsFile="+client.KNOWN_HOSTS,"root@"+client.HOST):
            self.assertIn(required,argv)
        self.assertEqual(argv[0],"/usr/bin/ssh")
        self.assertNotIn("StrictHostKeyChecking=no",argv)

    def test_unknown_client_phase_cannot_be_generic_command(self):
        with mock.patch.object(client.subprocess,"run") as run:
            for phase in ("run","probe-ex","rm -rf /","bash","install;cmd"):
                with self.assertRaises(ValueError):client.PinnedSSH().call(phase)
        run.assert_not_called()

    def test_gate_recheck_and_operation_digest_binding_before_network(self):
        grant={"qualification_operation":operation(True)}
        guarded=mock.Mock(return_value=grant)
        answer=mock.Mock(returncode=0,stdout=b'{"state":"IN_PROGRESS_OR_UNCERTAIN"}')
        with mock.patch.object(client.subprocess,"run",return_value=answer) as run:
            client.PinnedSSH(guarded).call("observe")
        self.assertEqual(guarded.call_count,2)
        self.assertTrue(run.call_args.args[0][-1].endswith(q.digest(operation(True))))

    def test_scope_change_between_checks_blocks_network(self):
        guard=mock.Mock(side_effect=[{"qualification_operation":operation(True)},{"qualification_operation":operation()}])
        with mock.patch.object(client.subprocess,"run") as run:
            with self.assertRaises(PermissionError):client.PinnedSSH(guard).call("start")
        run.assert_not_called()

    def test_arbitrary_install_bytes_not_reviewed_package_refused(self):
        guard=mock.Mock(return_value={"qualification_operation":operation(True)})
        with mock.patch.object(client,"package",return_value=b"reviewed"),mock.patch.object(client.subprocess,"run") as run:
            with self.assertRaises(PermissionError):client.PinnedSSH(guard).call("install",b"forged")
        run.assert_not_called()

    def test_install_phase_fixed_shell_code_parses_without_execution(self):
        import ast
        ast.parse(client.INSTALLER)
        # Installer uses exact constants, no shell commands or generic archives.
        self.assertNotIn("shell=True",client.INSTALLER)
        self.assertIn("occupied_public_attempt_refused",client.INSTALLER)

    def test_client_mutation_intent_prevents_retry_after_lost_response(self):
        with tempfile.TemporaryDirectory(dir=HERE,prefix="fixture-") as tmp:
            root=Path(tmp);root.chmod(0o700)
            transport=mock.Mock();transport.call.side_effect=TimeoutError("synthetic")
            c=client.Client(root,transport)
            with self.assertRaises(TimeoutError):c.phase("start")
            with self.assertRaises(FileExistsError):c.phase("start")
            self.assertEqual(transport.call.call_count,1)
            transport.call.side_effect=None;transport.call.return_value={"state":"IN_PROGRESS_OR_UNCERTAIN"}
            c.phase("observe");c.phase("observe")

    def test_gate_author_rejects_preparation_by_apoio_as_execution(self):
        event={"seq":99,"kind":"notice","actor":"apoio","data":{}}
        with mock.patch.object(gate,"central",return_value=[event]):
            with self.assertRaises(PermissionError):gate.notice(99)

    def test_runtime_or_execution_missing_ack_fails(self):
        with mock.patch.object(gate,"central",return_value=[]):
            with self.assertRaises(PermissionError):gate.independent_ack(99)

    def test_wrong_operator_session_capability_cannot_be_borrowed(self):
        with tempfile.TemporaryDirectory(dir=HERE,prefix="fixture-") as tmp:
            path=Path(tmp)/"cap.json";path.write_text(json.dumps({"operator_session":"other","result":{}}));path.chmod(0o600)
            with mock.patch.object(gate,"central") as central:
                with self.assertRaises(PermissionError):gate.validate_lease(path,99)
            central.assert_not_called()

    def test_child_and_persistent_directory_are_required_for_acceptance(self):
        for field,value in (("cgroup_pids_before_stop",1),("state_directory_persisted",False)):
            report=outcomes();report["cancellation"][field]=value
            with self.assertRaises(PermissionError):q.accept_results(report)

    def test_cleanup_refuses_live_runner_before_stop(self):
        with mock.patch.object(helper,"execution_lock",return_value=mock.MagicMock()),mock.patch.object(Path,"exists",return_value=True),mock.patch.object(helper,"read_json",return_value={}),mock.patch.object(helper,"alive",return_value=True),mock.patch.object(helper,"build") as build:
            with self.assertRaises(RuntimeError):helper.cleanup(operation(True),{})
        build.assert_not_called()

    def test_cleanup_cannot_guess_unstarted_runner(self):
        with mock.patch.object(helper,"execution_lock",return_value=mock.MagicMock()),mock.patch.object(Path,"exists",return_value=False),mock.patch.object(helper,"build") as build:
            with self.assertRaises(RuntimeError):helper.cleanup(operation(True),{})
        build.assert_not_called()

    def admission_context(self, cause):
        context={"admission":mock.Mock(),"worker":mock.Mock()}
        context["admission"].mutation.return_value=mock.MagicMock()
        context["admission"].closed_for_fencing.return_value=mock.MagicMock()
        context["worker"].stored.return_value=({"receipt_json":"{}"},None)
        context["worker"].rpc.side_effect=PermissionError(cause)
        return context

    def proof_read(self, path):
        if Path(path).name=="RUN-REQUEST.json":return operation(True)
        if Path(path).name=="admission.json":return {"enabled":False}
        return {"token":"a"*64}

    def test_admission_rejection_for_wrong_reason_never_counts_as_fenced(self):
        context=self.admission_context("invalid_token")
        modules={"qualification_contract":q,"remote_contract":q}
        answer=mock.Mock(returncode=0,stdout=b'{"busy":true}')
        with mock.patch.object(helper,"read_json",side_effect=self.proof_read),mock.patch.object(helper.subprocess,"run",return_value=answer):
            with self.assertRaisesRegex(PermissionError,"wrong_cause"):
                helper.admission_proof(modules,context,{"job_id":"1"*32})

    def test_admission_probe_uses_valid_tokens_exact_cause_and_positive_mutation(self):
        context=self.admission_context("worker_admission_closed_or_epoch_changed")
        modules={"qualification_contract":q,"remote_contract":q}
        answer=mock.Mock(returncode=0,stdout=b'{"busy":true}')
        with mock.patch.object(helper,"read_json",side_effect=self.proof_read),mock.patch.object(helper.subprocess,"run",return_value=answer) as child:
            value=helper.admission_proof(modules,context,{"job_id":"1"*32})
        self.assertEqual(value["new_prepare_start_denied"],2)
        context["admission"].mutation.assert_called_once()
        self.assertTrue(child.call_args.kwargs["close_fds"])
        requests=[call.args[0] for call in context["worker"].rpc.call_args_list]
        self.assertEqual(requests[0]["token_sha256"],hashlib.sha256(("a"*64).encode()).hexdigest())
        self.assertEqual(requests[1]["token"],"a"*64)

    def test_cleanup_foreign_invocation_never_stops_unit(self):
        context={"admission":mock.Mock(),"worker":mock.Mock(),"adapter":mock.Mock(),"profiles":{"fixture-pass":{}}}
        context["admission"].closed_for_fencing.return_value=mock.MagicMock()
        context["worker"].stored.return_value=({"manifest_json":'{"profile":"fixture-pass"}',"receipt_json":"{}"},{"invocation_id":"a"*32})
        context["adapter"].observe.return_value={"invocation_id":"b"*32}
        with mock.patch.object(helper,"execution_lock",return_value=mock.MagicMock()),mock.patch.object(Path,"exists",return_value=True),mock.patch.object(helper,"read_json",return_value={}),mock.patch.object(helper,"alive",return_value=False),mock.patch.object(helper,"build",return_value=context),mock.patch.object(helper,"durable"):
            with self.assertRaises(PermissionError):helper.cleanup(operation(True),{})
        context["worker"].stop.assert_not_called()

    def test_delivered_operation_template_is_unexecutable(self):
        request=json.loads((HERE/"OPERATION.template.json").read_text())
        self.assertIs(q.operation(request)["execute"],False)
        with self.assertRaises(PermissionError):q.operation(request,execution=True)

    def test_execution_notice_cannot_be_preparation_or_change_runtime_closure(self):
        req=operation(True)
        source_hash={**req["harness_sha256"],**{"runtime/"+n:h for n,h in req["runtime_sha256"].items()}}
        data={"manifest":{"commit":"f"*40},"file_sha256":source_hash,"operation":"test","preparation_only":False,
              "queue_cutover":False,"production_access":False,"qualification_operation":req,"runtime_notice":50}
        execution={"resources":[gate.RESOURCE],"data":data}
        runtime={"data":{"manifest":{"commit":req["runtime_commit"]},"file_sha256":req["runtime_sha256"]}}
        with mock.patch.object(gate,"git",side_effect=["","f"*40]),mock.patch.object(gate,"source_hashes",return_value=source_hash),mock.patch.object(gate,"notice",side_effect=[execution,runtime]),mock.patch.object(gate,"independent_ack") as ack:
            self.assertEqual(gate.reviewed(99),data)
        self.assertEqual([c.args[0] for c in ack.call_args_list],[50,99])
        data["preparation_only"]=True
        with mock.patch.object(gate,"git",side_effect=["","f"*40]),mock.patch.object(gate,"source_hashes",return_value=source_hash),mock.patch.object(gate,"notice",return_value=execution):
            with self.assertRaises(PermissionError):gate.reviewed(99)

    def test_lease_bound_to_other_manifest_refused_even_with_active_token(self):
        import time
        with tempfile.TemporaryDirectory(dir=HERE,prefix="fixture-") as tmp:
            path=Path(tmp)/"cap.json";path.write_text(json.dumps({"operator_session":gate.SESSION,"result":{"lease":"synthetic","token":"fictitious","fence":1,"seq":75}}));path.chmod(0o600)
            status={"leases":[{"id":"synthetic","actor":"admin-recuperacao","operation":"test","resources":[gate.RESOURCE],"expires":time.time()+1000}]}
            acquisition=[{"kind":"lease_acquired","actor":"admin-recuperacao","data":{"manifest_event":98,"lease":"synthetic"}}]
            with mock.patch.object(gate,"central",side_effect=[{},status,acquisition]):
                with self.assertRaises(PermissionError):gate.validate_lease(path,99)

    def test_cgroup_counter_requires_complete_kernel_evidence_not_unknown_zero(self):
        relative="/system.slice/"+q.unit("1"*32)
        with tempfile.TemporaryDirectory(dir=HERE,prefix="fixture-") as tmp:
            fake=Path(tmp);root=fake/relative.lstrip("/");root.mkdir(parents=True)
            (fake/"cgroup.controllers").write_text("cpu memory pids")
            reader=types.SimpleNamespace(snapshot=lambda group:shared_cgroups.snapshot(group,base=fake))
            (root/"cgroup.events").write_text("populated 1\nfrozen 0\n")
            with self.assertRaises((ValueError,RuntimeError)):helper.cgroup_pids(relative,reader)
            (root/"cgroup.procs").write_text("101\n102\n")
            self.assertEqual(helper.cgroup_pids(relative,reader),2)
            (root/"cgroup.procs").write_text("")
            with self.assertRaises(RuntimeError):helper.cgroup_pids(relative,reader)
            (root/"cgroup.events").write_text("populated 0\nfrozen 0\n")
            self.assertEqual(helper.cgroup_pids(relative,reader),0)

    def test_cgroup_walk_error_propagates(self):
        relative="/system.slice/"+q.unit("1"*32)
        with tempfile.TemporaryDirectory(dir=HERE,prefix="fixture-") as tmp:
            fake=Path(tmp);root=fake/relative.lstrip("/");root.mkdir(parents=True)
            (fake/"cgroup.controllers").write_text("cpu memory pids")
            (root/"cgroup.events").write_text("populated 0\n")
            reader=types.SimpleNamespace(snapshot=lambda group:shared_cgroups.snapshot(group,base=fake))
            def bad_walk(*args,**kwargs):
                kwargs["onerror"](PermissionError("synthetic denied cgroup"))
                yield
            with mock.patch.object(shared_cgroups.os,"walk",side_effect=bad_walk):
                with self.assertRaises(PermissionError):helper.cgroup_pids(relative,reader)


if __name__=="__main__":unittest.main()
