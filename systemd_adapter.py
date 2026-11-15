"""Fixed systemd adapter, pending actual namespace/host qualification."""
import os
from pathlib import Path
import re
import subprocess

import remote_contract as contract


class SystemdAdapter:
    def __init__(self,boot_id=lambda:Path('/proc/sys/kernel/random/boot_id').read_text().strip()):
        self.boot_id=boot_id

    def command(self,argv):
        return subprocess.run(argv,check=True,capture_output=True,text=True,timeout=30,
                              env={"PATH":"/usr/sbin:/usr/bin:/sbin:/bin","LANG":"C.UTF-8"}).stdout

    def state_name(self,manifest):
        contract.hex_value(manifest['job_id'],32);contract.generation(manifest['generation'])
        return 'peticao-dev-job-'+manifest['job_id']+'-g'+str(manifest['generation'])

    def description(self,manifest,receipt):
        return 'peticao-dev manifest='+contract.digest(manifest)+' receipt='+contract.digest(receipt)

    def properties(self,unit):
        if not re.fullmatch(r'admin-dev-[a-f0-9]{32}-g[1-9][0-9]*\.service',unit):raise ValueError('fixed_worker_unit_required')
        fields=('LoadState','ActiveState','SubState','MainPID','ControlGroup','InvocationID','ExecMainCode','ExecMainStatus','Description','StateDirectory','DynamicUser')
        raw=self.command(['/usr/bin/systemctl','show',unit,'--no-pager','--property='+','.join(fields)])
        data={}
        for line in raw.splitlines():
            k,sep,v=line.partition('=')
            if not sep or k not in fields or k in data:raise ValueError('unexpected_systemd_observation')
            data[k]=v
        if set(data)!=set(fields):raise ValueError('complete_systemd_observation_required')
        return data

    def cgroup_empty(self,path):
        if not path:return True
        if not re.fullmatch(r'/system.slice/admin-dev-[a-f0-9]{32}-g[1-9][0-9]*\.service',path):raise ValueError('own_cgroup_required')
        root=Path('/sys/fs/cgroup')/path.lstrip('/')
        if not root.exists():return True
        for directory,dirs,files in os.walk(root,followlinks=False):
            for name in dirs:
                if (Path(directory)/name).is_symlink():raise ValueError('cgroup_directory_link')
            if 'cgroup.procs' in files and (Path(directory)/'cgroup.procs').read_text().strip():return False
        return True

    def preflight(self,manifest,descriptor):
        unit='admin-dev-'+manifest['job_id']+'-g'+str(manifest['generation'])+'.service'
        state=self.properties(unit)
        if state['LoadState']!='not-found':raise PermissionError('preexisting_unit_refused')
        name=self.state_name(manifest)
        for base in ('/var/lib','/var/lib/private'):
            if os.path.lexists(Path(base)/name):raise PermissionError('preexisting_worker_directory_refused')

    def unit_argv(self,manifest,receipt,descriptor):
        if descriptor['name'] not in {'fixture-pass','fixture-fail'}:raise PermissionError('development_profile_not_yet_qualified')
        state=self.state_name(manifest);work='/var/lib/'+state
        props={'Type':'exec','RemainAfterExit':'yes','DynamicUser':'yes','StateDirectory':state,'StateDirectoryMode':'0700',
               'WorkingDirectory':work,'Description':self.description(manifest,receipt),'MemoryMax':'512M','CPUQuota':'100%',
               'TasksMax':'32','RuntimeMaxSec':'120','TimeoutStartSec':'120','TimeoutStopSec':'10','KillMode':'control-group',
               'SendSIGKILL':'yes','NoNewPrivileges':'yes','ProtectSystem':'strict','ProtectHome':'tmpfs','PrivateNetwork':'yes',
               'PrivateDevices':'yes','PrivateTmp':'yes','CapabilityBoundingSet':'','AmbientCapabilities':'','RestrictSUIDSGID':'yes',
               'ProtectControlGroups':'yes','ProtectKernelTunables':'yes','ProtectKernelModules':'yes','ProtectProc':'invisible','UMask':'0077',
               'InaccessiblePaths':'-/run/docker.sock -/var/run/docker.sock -/run/containerd -/run/tailscale -/var/lib/tailscale -/etc/peticao-dev-authority -/srv/admin-v2-coordinator -/srv/peticao-dev-worker'}
        return ['/usr/bin/systemd-run','--no-block','--unit='+receipt['unit']]+['--property='+k+'='+v for k,v in props.items()]+[
            '/usr/bin/env','-i','PATH=/usr/bin:/bin','HOME='+work,'TMPDIR='+work+'/tmp',descriptor['python_path'],'-s','-E','-B',descriptor['program'],descriptor['name']]

    def start(self,manifest,receipt,descriptor):
        if self.boot_id()!=receipt['boot_id']:raise PermissionError('worker_rebooted')
        self.preflight(manifest,descriptor)
        self.command(self.unit_argv(manifest,receipt,descriptor))
        observed=self.observe(manifest,receipt,descriptor)
        if observed is None:raise RuntimeError('start_observation_uncertain')
        return observed

    def observe(self,manifest,receipt,descriptor):
        if self.boot_id()!=receipt['boot_id']:raise PermissionError('worker_rebooted')
        state=self.properties(receipt['unit'])
        if state['LoadState']=='not-found':return None
        if (state['LoadState']!='loaded' or state['Description']!=self.description(manifest,receipt)
                or state['StateDirectory']!=self.state_name(manifest) or state['DynamicUser']!='yes'):
            raise PermissionError('foreign_or_replaced_worker_unit')
        contract.hex_value(state['InvocationID'],32)
        pid=int(state['MainPID']);exited=(state['ExecMainCode'] in {'1','2','3'} and pid==0 and state['SubState'] in {'exited','dead','failed'})
        if pid<0 or (pid>0 and not state['ControlGroup']):raise ValueError('live_process_cgroup_required')
        return {'unit':receipt['unit'],'invocation_id':state['InvocationID'],'worker_boot_id':self.boot_id(),
                'manifest_sha256':contract.digest(manifest),'receipt_sha256':contract.digest(receipt),'main_pid':pid,
                'cgroup_empty':self.cgroup_empty(state['ControlGroup']),'cgroup_path':state['ControlGroup'],
                'exit_code':int(state['ExecMainStatus']) if exited else None,'exited':exited}

    def stop(self,manifest,receipt,descriptor,binding):
        current=self.observe(manifest,receipt,descriptor)
        if current is not None and current['invocation_id']!=binding['invocation_id']:raise PermissionError('cannot_stop_recreated_unit')
        code=current['exit_code'] if current is not None else None
        if current is not None:
            self.command(['/usr/bin/systemctl','stop',receipt['unit']])
        after=self.observe(manifest,receipt,descriptor)
        if after is not None:
            if after['invocation_id']!=binding['invocation_id'] or after['main_pid'] or not after['cgroup_empty'] or not after['exited']:
                raise PermissionError('worker_stop_not_proven')
            code=after['exit_code']
        # A vanished unit has no authoritative exit status; keep None. Only a
        # cancellation may accept that after proving the own cgroup empty.
        if not self.cgroup_empty(binding['cgroup_path']):raise PermissionError('worker_cgroup_not_empty')
        return {'unit':receipt['unit'],'invocation_id':binding['invocation_id'],'worker_boot_id':self.boot_id(),
                'main_pid':0,'cgroup_empty':True,'unit_stopped':True,'exit_code':code}

    def output_root(self,manifest,receipt,descriptor):
        p=Path('/var/lib/private')/self.state_name(manifest)
        for parent in reversed(p.parents):
            if parent.is_symlink() or parent.stat().st_uid!=0 or parent.stat().st_mode&0o022:raise ValueError('root_owned_output_ancestors_required')
        if p.is_symlink():raise ValueError('worker_output_root_link')
        if not p.is_dir():raise ValueError('persistent_worker_output_absent')
        return p
