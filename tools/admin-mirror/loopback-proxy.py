"""Loopback-only transport to the private container's authenticated gate, never to Next."""
import json, select, socket, socketserver, subprocess, time
cache=(0,None)

def address():
    global cache
    if time.monotonic()-cache[0]>5 or not cache[1]:
        raw=subprocess.check_output(['docker','inspect','--format','{{json .NetworkSettings.Networks}}','peticao-admin-mirror-app'],timeout=5)
        value=json.loads(raw).get('peticao-admin-mirror',{}).get('IPAddress')
        if not value or not (value.startswith('172.') or value.startswith('10.') or value.startswith('192.168.')):
            raise RuntimeError('Missing private local container')
        cache=(time.monotonic(),value)
    return cache[1]

class Proxy(socketserver.BaseRequestHandler):
    def handle(self):
        try:
            upstream=socket.create_connection((address(),3031),timeout=10)
            with upstream:
                self.request.settimeout(60);upstream.settimeout(60)
                peers={self.request:upstream,upstream:self.request}
                while True:
                    ready,_,_=select.select(list(peers),[],[],60)
                    if not ready:return
                    for source in ready:
                        data=source.recv(65536)
                        if not data:return
                        peers[source].sendall(data)
        except (OSError,subprocess.SubprocessError,ValueError,RuntimeError):
            return

class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address=True
    daemon_threads=True
    def handle_error(self,*args):pass

if __name__=='__main__':
    with Server(('127.0.0.1',3031),Proxy) as server:server.serve_forever()
