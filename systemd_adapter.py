"""Fixed systemd adapter, pending actual namespace/host qualification."""
import os
from pathlib import Path
import re
import subprocess

import remote_contract as contract
import cgroups
import project_storage
import profile_contract


class SystemdAdapter:
    def __init__(self,boot_id=lambda:Path('/proc/sys/kernel/random/boot_id').read_text().strip(),cgroup_root=cgroups.MOUNT,storage=None,references=None):
        self.boot_id,self.cgroup_root=boot_id,Path(cgroup_root)
        self.storage=storage
        self.references=references

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
        return cgroups.snapshot(path,self.cgroup_root)['empty']

    def preflight(self,manifest,descriptor):
        profile_contract.validate(descriptor)
        cgroups.validate_mount(self.cgroup_root)
        unit='admin-dev-'+manifest['job_id']+'-g'+str(manifest['generation'])+'.service'
        state=self.properties(unit)
        if state['LoadState']!='not-found':raise PermissionError('preexisting_unit_refused')
        name=self.state_name(manifest)
        for base in ('/var/lib','/var/lib/private'):
            if os.path.lexists(Path(base)/name):raise PermissionError('preexisting_worker_directory_refused')
        if self.storage is None:raise PermissionError('qualified_project_storage_required')
        if self.references is None:raise PermissionError('persistent_unit_reference_provider_required')
        self.references.check()
        if descriptor["name"] in profile_contract.REAL:
            profile_contract.capacity(descriptor, self.storage.root)

    def unit_argv(self,manifest,receipt,descriptor):
        profile_contract.validate(descriptor)
        state=self.state_name(manifest);logical='/var/lib/'+state;work='/run/peticao-dev-work'
        props={'Type':'exec','RemainAfterExit':'yes','DynamicUser':'yes','StateDirectory':state,'StateDirectoryMode':'0700',
               'WorkingDirectory':work,'TemporaryFileSystem':'/run:rw','BindPaths':logical+':'+work,'Description':self.description(manifest,receipt),'MemoryMax':'512M','CPUQuota':'100%',
               'TasksMax':'32','RuntimeMaxSec':'120','TimeoutStartSec':'120','TimeoutStopSec':'10','KillMode':'control-group',
               'SendSIGKILL':'yes','NoNewPrivileges':'yes','ProtectSystem':'strict','ProtectHome':'tmpfs','PrivateNetwork':'yes',
               'PrivateDevices':'yes','PrivateTmp':'yes','CapabilityBoundingSet':'','AmbientCapabilities':'','RestrictSUIDSGID':'yes',
               'ProtectControlGroups':'yes','ProtectKernelTunables':'yes','ProtectKernelModules':'yes','ProtectProc':'invisible','UMask':'0077',
               'InaccessiblePaths':'/tmp /var/tmp /mnt/apps/peticao-final/.runtime -/run/docker.sock -/var/run/docker.sock -/run/containerd -/run/tailscale -/var/lib/tailscale -/etc/peticao-dev-authority -/srv/admin-v2-coordinator -/srv/peticao-dev-worker'}
        flags=['-s','-E','-B']
        if descriptor['name'] in profile_contract.REAL:
            props.update(profile_contract.systemd_properties(descriptor))
            flags=['-I','-S','-B']
        return ['/usr/bin/systemd-run','--no-block','--unit='+receipt['unit']]+['--property='+k+'='+v for k,v in props.items()]+[
            '/usr/bin/env','-i','PATH=/usr/bin:/bin','HOME='+work+'/h','TMPDIR='+work+'/t',descriptor['python_path']]+flags+[descriptor['program'],descriptor['name']]

    def start(self,manifest,receipt,descriptor):
        if self.boot_id()!=receipt['boot_id']:raise PermissionError('worker_rebooted')
        self.preflight(manifest,descriptor)
        self.storage.prepare(manifest,receipt)
        self.command(self.unit_argv(manifest,receipt,descriptor))
        observed=self.observe(manifest,receipt,descriptor)
        if observed is None:raise RuntimeError('start_observation_uncertain')
        # RemainAfterExit retains a successful active unit until stop, but not
        # afterwards. Keep a process-bound IPC reference through actual cleanup.
        self.references.acquire(receipt['unit'],observed['invocation_id'])
        current=self.observe(manifest,receipt,descriptor)
        if current is None or current['invocation_id']!=observed['invocation_id']:
            raise PermissionError('referenced_start_identity_uncertain')
        self.references.assert_held(receipt['unit'],current['invocation_id'])
        return current

    def observe(self,manifest,receipt,descriptor):
        if self.boot_id()!=receipt['boot_id']:raise PermissionError('worker_rebooted')
        state=self.properties(receipt['unit'])
        if state['LoadState']=='not-found':return None
        if (state['LoadState']!='loaded' or state['Description']!=self.description(manifest,receipt)
                or state['StateDirectory']!=self.state_name(manifest) or state['DynamicUser']!='yes'):
            raise PermissionError('foreign_or_replaced_worker_unit')
        if self.storage is None:raise PermissionError('qualified_project_storage_required')
        self.storage.verify(manifest,receipt)
        contract.hex_value(state['InvocationID'],32)
        pid=int(state['MainPID']);exited=(state['ExecMainCode'] in {'1','2','3'} and pid==0 and state['SubState'] in {'exited','dead','failed'})
        if pid<0 or (pid>0 and not state['ControlGroup']):raise ValueError('live_process_cgroup_required')
        return {'unit':receipt['unit'],'invocation_id':state['InvocationID'],'worker_boot_id':self.boot_id(),
                'manifest_sha256':contract.digest(manifest),'receipt_sha256':contract.digest(receipt),'main_pid':pid,
                'cgroup_empty':self.cgroup_empty(state['ControlGroup']),'cgroup_path':state['ControlGroup'],
                'exit_code':int(state['ExecMainStatus']) if exited else None,'exited':exited}

    def stop(self,manifest,receipt,descriptor,binding):
        if self.references is None:raise PermissionError('persistent_unit_reference_provider_required')
        self.references.assert_held(receipt['unit'],binding['invocation_id'])
        current=self.observe(manifest,receipt,descriptor)
        if current is None:raise PermissionError('referenced_unit_missing_uncertain')
        if current['invocation_id']!=binding['invocation_id']:raise PermissionError('cannot_stop_recreated_unit')
        code=current['exit_code'] if current is not None else None
        if current is not None:
            self.command(['/usr/bin/systemctl','stop',receipt['unit']])
        after=self.observe(manifest,receipt,descriptor)
        self.references.assert_held(receipt['unit'],binding['invocation_id'])
        if after is None:raise PermissionError('referenced_unit_collected_after_stop_uncertain')
        if after is not None:
            if after['invocation_id']!=binding['invocation_id'] or after['main_pid'] or not after['cgroup_empty'] or not after['exited']:
                raise PermissionError('worker_stop_not_proven')
            code=after['exit_code']
        # A held reference does not excuse an incomplete cgroup observation.
        # Missing/recreated units above remain uncertain, never inferred stopped.
        if not self.cgroup_empty(binding['cgroup_path']):raise PermissionError('worker_cgroup_not_empty')
        return {'unit':receipt['unit'],'invocation_id':binding['invocation_id'],'worker_boot_id':self.boot_id(),
                'main_pid':0,'cgroup_empty':True,'unit_stopped':True,'exit_code':code}

    def output_root(self,manifest,receipt,descriptor):
        if self.storage is None:raise PermissionError('qualified_project_storage_required')
        return self.storage.output_root(manifest,receipt)

    def cleanup_storage(self,manifest,receipt,descriptor,binding):
        if self.references is None:raise PermissionError('persistent_unit_reference_provider_required')
        self.references.assert_held(receipt['unit'],binding['invocation_id'])
        current=self.observe(manifest,receipt,descriptor)
        if (current is None or current['invocation_id']!=binding['invocation_id']
                or current['main_pid']!=0 or not current['cgroup_empty']
                or not self.cgroup_empty(binding['cgroup_path'])):
            raise PermissionError('fresh_bound_quiescent_unit_required_for_storage_cleanup')
        state=self.properties(receipt['unit'])
        if state['ActiveState'] not in {'inactive','failed'} or state['SubState'] not in {'dead','failed'}:
            raise PermissionError('inactive_unit_required_before_storage_cleanup')
        proof={'unit':receipt['unit'],'invocation_id':binding['invocation_id'],
               'worker_boot_id':self.boot_id(),'main_pid':0,'cgroup_empty':True,'unit_stopped':True}
        self.references.assert_held(receipt['unit'],binding['invocation_id'])
        answer=self.storage.cleanup(manifest,receipt,proof)
        # The manager may collect the inactive unit immediately on UnrefUnit.
        # Never drop the reference until the project backing has been retained.
        if answer.get('state')!='retained' or answer.get('mount_absent') is not True:
            raise PermissionError('storage_cleanup_before_unit_unref_required')
        self.references.release(receipt['unit'],binding['invocation_id'])
        return answer
