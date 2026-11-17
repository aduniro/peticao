"""Join the WAHA VM to the existing administrative SSH mesh, using public keys only."""
import json
import pathlib
import shlex
import subprocess

ROOT = pathlib.Path.home()
VM_IP = "100.115.154.25"
BOOTSTRAP = ["/usr/bin/ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
             "-o", "ProxyCommand=/usr/bin/ssh -o BatchMode=yes -o StrictHostKeyChecking=yes root@pve-barretos -W [%h]:%p",
             "wa@fe80::be24:11ff:fe0a:b70a%vmbr0"]


def remote(command, code, data=None):
    return subprocess.check_output(command + ["/usr/bin/python3 -c " + shlex.quote(code)],
                                   input=json.dumps(data).encode() if data is not None else None).decode().strip()


APPEND = """
import pathlib,sys,json,os,shutil,time
os.umask(0o077)
d=json.load(sys.stdin)
for name,content in d.items():
 p=pathlib.Path.home()/name;p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 old=p.read_text() if p.exists() else ''
 if content.strip() in old:continue
 if p.exists():shutil.copy2(p,str(p)+'.before-waha-'+str(time.time_ns()))
 p.write_text(old+('\\n' if old and not old.endswith('\\n') else '')+content+'\\n');p.chmod(0o600)
print('public configuration installed')
"""


def main():
    vm = json.loads(remote(BOOTSTRAP, """
import pathlib,subprocess,json
p=pathlib.Path.home()/'.ssh/id_admin_v2_mesh'
if not p.exists():subprocess.run(['/usr/bin/ssh-keygen','-t','ed25519','-N','','-f',str(p),'-C','wa@sanciona-integral-mesh'],check=True,stdout=subprocess.DEVNULL)
print(json.dumps({'public':p.with_suffix('.pub').read_text().strip(),'host':pathlib.Path('/etc/ssh/ssh_host_ed25519_key.pub').read_text().strip()}))
"""))
    known = ROOT / ".ssh/known_hosts"
    row = VM_IP + " " + " ".join(vm["host"].split()[:2])
    existing = known.read_text()
    if row not in existing:
        with known.open("a") as f:
            f.write("\n" + row + "\n")
    peers = {"local": None, "sp": "cluster-sp", "santiago": "cluster-santiago"}
    public = []
    for label, alias in peers.items():
        if alias:
            public.append(remote(["/usr/bin/ssh", alias], "import pathlib;print((pathlib.Path.home()/'.ssh/id_admin_v2_mesh.pub').read_text().strip())"))
        else:
            public.append((ROOT / ".ssh/id_admin_v2_mesh.pub").read_text().strip())
    config = (ROOT / ".ssh/config_admin_mesh").read_text().replace("/home/barre/", "/home/wa/")
    data = {".ssh/authorized_keys": "\n".join(public), ".ssh/config_admin_mesh": config,
            ".ssh/config": "Include /home/wa/.ssh/config_admin_mesh",
            ".ssh/known_hosts_admin_mesh": (ROOT / ".ssh/known_hosts_admin_mesh").read_text().strip()}
    print("VM", remote(BOOTSTRAP, APPEND, data))
    host = """Host cluster-waha
  HostName 100.115.154.25
  User wa
  Port 22
  IdentityFile ~/.ssh/id_admin_v2_mesh
  IdentitiesOnly yes
  BatchMode yes
  StrictHostKeyChecking yes
  ForwardAgent no
  ConnectTimeout 10
  ServerAliveInterval 15
  ServerAliveCountMax 3"""
    additions = {".ssh/authorized_keys_admin_mesh": vm["public"], ".ssh/config_admin_mesh": host,
                 ".ssh/known_hosts": row}
    for label, alias in peers.items():
        if alias:
            print(label, remote(["/usr/bin/ssh", alias], APPEND, additions))
        else:
            result = subprocess.run(["/usr/bin/python3", "-c", APPEND], input=json.dumps(additions), text=True, capture_output=True, check=True)
            print(label, result.stdout.strip())
    for alias in ["cluster-waha", "cluster-sp", "cluster-santiago"]:
        print("local ->", alias, subprocess.check_output(["/usr/bin/ssh", alias, "/usr/bin/hostname"]).decode().strip())
    for alias in ["cluster-local", "cluster-sp", "cluster-santiago"]:
        print("waha ->", alias, subprocess.check_output(["/usr/bin/ssh", "cluster-waha", "/usr/bin/ssh " + alias + " /usr/bin/hostname"]).decode().strip())
    for alias in ["cluster-sp", "cluster-santiago"]:
        print(alias, "-> waha", subprocess.check_output(["/usr/bin/ssh", alias, "/usr/bin/ssh cluster-waha /usr/bin/hostname"]).decode().strip())


if __name__ == "__main__":
    main()
