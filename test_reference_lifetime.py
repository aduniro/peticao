"""Local mocked lifetime contracts only, never real SystemBus or host units."""
import ast
import copy
import json
import os
from pathlib import Path
import types
import unittest
from unittest import mock

import qualification_helper as h
import qualification_contract as q
from test_qualification import outcomes

BOOT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
UNIT = q.unit("1"*32)
INV = "a"*32


def snapshot(state):
    return {"unit": UNIT, "invocation_id": INV, "state": state, "process_id": os.getpid(),
            "worker_boot_id": BOOT, "connection_uncertain": False, "backend": "libsystemd-sd-bus"}


class Lifetime(unittest.TestCase):
    def test_runtime_closure_is_ten_and_new_helper_has_reference_module(self):
        self.assertEqual(len(q.RUNTIME),10);self.assertIn("unit_refs.py",q.RUNTIME);self.assertIn("unit_refs",h.MODULES)
        source=Path(h.__file__).read_text()
        self.assertIn('"unit_refs.py"',source)

    def test_real_default_factory_called_once_without_injected_arguments(self):
        keeper=mock.Mock(pid=os.getpid(),boot=BOOT);keeper.bus.backend_kind="libsystemd-sd-bus"
        factory=mock.Mock(return_value=keeper)
        with mock.patch.object(h,"boot_id",return_value=BOOT):
            self.assertIs(h.new_reference_keeper({"unit_refs":types.SimpleNamespace(UnitReferences=factory)}),keeper)
        factory.assert_called_once_with();keeper.check.assert_called_once_with()

    def test_fake_or_foreign_process_backend_refused(self):
        for attr,value in (("backend","fake"),("pid",1),("boot","other")):
            keeper=mock.Mock(pid=os.getpid(),boot=BOOT);keeper.bus.backend_kind="libsystemd-sd-bus"
            if attr=="backend":keeper.bus.backend_kind=value
            else:setattr(keeper,attr,value)
            with mock.patch.object(h,"boot_id",return_value=BOOT):
                with self.assertRaises(PermissionError):h.new_reference_keeper({"unit_refs":types.SimpleNamespace(UnitReferences=lambda:keeper)})

    def test_held_then_released_same_runner_proof(self):
        proof=h.reference_proof(snapshot("held"),snapshot("released"),UNIT,INV,os.getpid(),BOOT)
        self.assertTrue(proof["held_before_cleanup"]);self.assertTrue(proof["released_after_retained"])

    def test_wrong_state_identity_or_uncertainty_never_qualifies(self):
        for key,value in (("state","held"),("connection_uncertain",True),("backend","fake"),("process_id",False),("worker_boot_id","other"),("invocation_id","b"*32)):
            after=snapshot("released");after[key]=value
            with self.assertRaises(PermissionError):h.reference_proof(snapshot("held"),after,UNIT,INV,os.getpid(),BOOT)

    def context(self):
        receipt={"unit":UNIT};manifest={"job_id":"1"*32,"profile":"fixture-pass"};binding={"invocation_id":INV,"stop_proof":"durable"}
        keeper=mock.Mock(spec=["assert_held", "snapshot"]);keeper.assert_held.return_value=snapshot("held");keeper.snapshot.return_value=snapshot("released")
        context={"worker":mock.Mock(),"storage":mock.Mock(),"adapter":mock.Mock(),"references":keeper,"profiles":{"fixture-pass":{}}}
        context["worker"].stored.return_value=({"receipt_json":json.dumps(receipt)},binding)
        context["storage"].status.return_value={"state":"mounted"}
        context["adapter"].cleanup_storage.return_value={"state":"retained","mount_absent":True}
        return context,manifest

    def test_finish_storage_requires_held_before_cleanup_and_released_after(self):
        context,m=self.context();events=[]
        context["references"].assert_held.side_effect=lambda *_:(events.append("held") or snapshot("held"))
        context["adapter"].cleanup_storage.side_effect=lambda *_:(events.append("cleanup") or {"state":"retained","mount_absent":True})
        context["references"].snapshot.side_effect=lambda *_:(events.append("released") or snapshot("released"))
        with mock.patch.object(h,"boot_id",return_value=BOOT),mock.patch.object(h,"durable"),mock.patch.object(h,"retained",return_value={"state":"retained"}):
            value=h.finish_storage({}, {"remote_contract":q},context,"success",m)
        self.assertEqual(events,["held","cleanup","released"]);self.assertTrue(value["released_after_retained"])

    def test_missing_keeper_or_bad_held_proof_refused_before_unmount(self):
        for missing in (True,False):
            context,m=self.context()
            if missing:context["references"]=None
            else:context["references"].assert_held.return_value=snapshot("released")
            with mock.patch.object(h,"boot_id",return_value=BOOT),mock.patch.object(h,"durable"):
                with self.assertRaises(PermissionError):h.finish_storage({}, {"remote_contract":q},context,"success",m)
            context["adapter"].cleanup_storage.assert_not_called()

    def test_cleanup_or_release_failure_does_not_publish_reference_receipt(self):
        for failure in ("cleanup","release"):
            context,m=self.context()
            if failure=="cleanup":context["adapter"].cleanup_storage.side_effect=RuntimeError("uncertain")
            else:context["references"].snapshot.return_value=snapshot("uncertain")
            with mock.patch.object(h,"boot_id",return_value=BOOT),mock.patch.object(h,"durable") as durable,mock.patch.object(h,"retained",return_value={"state":"retained"}):
                with self.assertRaises((RuntimeError,PermissionError)):h.finish_storage({}, {"remote_contract":q},context,"success",m)
            self.assertNotIn("success-reference-receipt.json",[c.args[1] for c in durable.call_args_list])

    def test_result_contract_rejects_missing_or_fake_reference_evidence(self):
        for key,value in (("backend","fake"),("held_before_cleanup",False),("released_after_retained",False),("process_id",True),("worker_boot_id","other"),("invocation_id","0"*32)):
            values=outcomes();values["success"]["unit_reference"][key]=value
            with self.assertRaises(PermissionError):q.accept_results(values)

    def test_session_closes_only_exact_three_released_units(self):
        units=[q.unit(str(i)*32) for i in (1,2,3)]
        keeper=mock.Mock(pid=os.getpid(),boot=BOOT,closed=False);keeper.bus.backend_kind="libsystemd-sd-bus";keeper.records={u:{"state":"released"} for u in units}
        keeper.close.side_effect=lambda:setattr(keeper,"closed",True)
        with mock.patch.object(h,"boot_id",return_value=BOOT):value=h.close_reference_session(keeper,units)
        self.assertEqual(value["released_count"],3);keeper.close.assert_called_once_with()
        keeper.closed=False;keeper.close.reset_mock();keeper.records[units[0]]["state"]="held"
        with mock.patch.object(h,"boot_id",return_value=BOOT):
            with self.assertRaises(PermissionError):h.close_reference_session(keeper,units)
        keeper.close.assert_not_called()

    def test_terminal_receipt_requires_same_original_runner(self):
        values=outcomes();session={"backend":"libsystemd-sd-bus","process_id":100,"worker_boot_id":BOOT,"released_count":3,"closed":True}
        with mock.patch.object(h,"boot_id",return_value=BOOT):
            h.validate_reference_session(session,values,{"pid":100,"boot_id":BOOT})
            with self.assertRaises(PermissionError):h.validate_reference_session(session,values,{"pid":101,"boot_id":BOOT})
            session["closed"]=False
            with self.assertRaises(PermissionError):h.validate_reference_session(session,values,{"pid":100,"boot_id":BOOT})

    def test_runner_constructs_one_keeper_observers_never_construct_one(self):
        tree=ast.parse(Path(h.__file__).read_text())
        run=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=="run_locked")
        calls=[n for n in ast.walk(run) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=="new_reference_keeper"]
        self.assertEqual(len(calls),1)
        for name in ("observe","cleanup","bootstrap"):
            fun=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name==name)
            self.assertFalse(any(isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=="new_reference_keeper" for n in ast.walk(fun)))


if __name__=="__main__":unittest.main()
