import json
import os
import socket
import threading
import unittest
from unittest import mock

import broker_wire as w


class Wire(unittest.TestCase):
    def broker(self, handler):
        return w.Broker(lambda:handler,uid=os.geteuid(),io_timeout=0.3)

    def exchange(self, broker, request):
        server,client=socket.socketpair();errors=[]
        def serve():
            with server:
                try:broker.serve_connection(server)
                except BaseException as e:errors.append(type(e).__name__)
        thread=threading.Thread(target=serve,daemon=True);thread.start()
        with client:reply=w.proxy_once(client,request,expected_uid=os.geteuid(),io_timeout=0.5)
        thread.join(2);self.assertFalse(thread.is_alive());self.assertFalse(errors)
        return reply

    def test_same_handler_lifetime_across_separate_unix_connections(self):
        created=[];calls=[]
        def factory():
            created.append(1)
            def handler(request):calls.append(request['action']);return {'sequence':len(calls)}
            return handler
        broker=w.Broker(factory,uid=os.geteuid())
        self.assertEqual(self.exchange(broker,{'action':'observe','id':'a'*32})['result'],{'sequence':1})
        self.assertEqual(self.exchange(broker,{'action':'logs','id':'a'*32})['result'],{'sequence':2})
        self.assertEqual(created,[1]);self.assertEqual(calls,['observe','logs'])

    def test_actual_kernel_peer_credential_not_request_uid(self):
        server, client = socket.socketpair()
        with server, client:
            # This test uses the real kernel UID, not a mocked credential value.
            self.assertEqual(w.peer(server,os.geteuid())['uid'],os.geteuid())
            with self.assertRaises(w.Rejected):w.peer(server,os.geteuid()+1)

    def test_default_root_process_requirement_rejects_nonroot(self):
        with mock.patch.object(w.os,'geteuid',return_value=1000):
            with self.assertRaises(w.Rejected):w.Broker(lambda:lambda r:{})

    def test_foreign_action_never_invokes_handler(self):
        handler=mock.Mock(return_value={});server,client=socket.socketpair()
        with server,client:
            w.send(client,b'{"action":"exec","command":"unapproved"}',w.MAX_REQUEST)
            self.broker(handler).serve_connection(server)
            response=w.decode(w.receive(client,w.MAX_REPLY))
        self.assertEqual(response,{'ok':False,'error_type':'Rejected'});handler.assert_not_called()

    def test_duplicate_nan_array_or_corrupt_json_refused_without_handler(self):
        for raw in (b'{"action":"observe","action":"start"}',b'{"action":"observe","x":NaN}',b'[]',b'{'):
            handler=mock.Mock(return_value={});server,client=socket.socketpair()
            with server,client:
                w.send(client,raw,w.MAX_REQUEST);self.broker(handler).serve_connection(server)
                self.assertEqual(w.decode(w.receive(client,w.MAX_REPLY))['ok'],False)
            handler.assert_not_called()

    def test_oversized_header_rejected_before_payload_or_handler(self):
        handler=mock.Mock(return_value={});server,client=socket.socketpair()
        with server,client:
            client.sendall(w.HEADER.pack(w.MAX_REQUEST+1))
            self.broker(handler).serve_connection(server)
            self.assertEqual(w.decode(w.receive(client,w.MAX_REPLY))['error_type'],'Rejected')
        handler.assert_not_called()

    def test_exception_text_is_not_sent(self):
        sentinel='synthetic-secret-must-stay-private'
        def handler(_):raise RuntimeError(sentinel)
        response=self.exchange(self.broker(handler),{'action':'observe','id':'a'*32})
        self.assertEqual(response,{'ok':False,'error_type':'RuntimeError'})
        self.assertNotIn(sentinel,json.dumps(response))

    def test_reply_loss_after_mutation_does_not_reinvoke_handler(self):
        calls=[];server,client=socket.socketpair()
        w.send(client,b'{"action":"start"}',w.MAX_REQUEST);client.close()
        with server:
            with self.assertRaises(w.OutcomeUncertain):self.broker(lambda r:calls.append(1)or{}).serve_connection(server)
        self.assertEqual(calls,[1])

    def test_partial_or_foreign_reply_is_uncertain_without_retry(self):
        examples=[w.HEADER.pack(20)+b'{',w.HEADER.pack(w.MAX_REPLY+1),w.HEADER.pack(2)+b'[]']
        for raw in examples:
            server,client=socket.socketpair()
            def answer():
                with server:
                    w.receive(server,w.MAX_REQUEST);server.sendall(raw)
            t=threading.Thread(target=answer,daemon=True);t.start()
            with client,self.assertRaises(w.OutcomeUncertain):w.proxy_once(client,{'action':'observe'},expected_uid=os.geteuid(),io_timeout=0.3)
            t.join(2);self.assertFalse(t.is_alive())

    def test_extra_reply_fields_are_not_accepted(self):
        server,client=socket.socketpair()
        def answer():
            with server:
                w.receive(server,w.MAX_REQUEST);w.send(server,w.encode({'ok':True,'result':{},'extra':True}),w.MAX_REPLY)
        t=threading.Thread(target=answer,daemon=True);t.start()
        with client,self.assertRaises(w.OutcomeUncertain):w.proxy_once(client,{'action':'observe'},expected_uid=os.geteuid())
        t.join(2);self.assertFalse(t.is_alive())

    def test_changed_broker_pid_is_refused_before_request(self):
        broker=self.broker(lambda r:{});server,client=socket.socketpair()
        with server,client,mock.patch.object(w.os,'getpid',return_value=broker.pid+1):
            with self.assertRaises(w.Rejected):broker.serve_connection(server)

    def test_remote_tcp_socket_never_accepted(self):
        with socket.socket(socket.AF_INET,socket.SOCK_STREAM) as tcp:
            with self.assertRaises(w.Rejected):w.peer(tcp,os.geteuid())


if __name__=='__main__':unittest.main()
