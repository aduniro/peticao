"""Fail-closed cgroup-v2 observation for own worker units only.

Explicit absence under a validated v2 mount is empty. An existing but unreadable,
incomplete, changing or unwalkable tree is never evidence of emptiness.
"""
import os
from pathlib import Path
import re
import stat

MOUNT=Path('/sys/fs/cgroup')
GROUP=re.compile(r'/system.slice/(?:admin-v2-coordinator|admin-v2-job-[a-fA-F0-9-]{32,36})\.service\Z')


def read(path,limit=1024*1024):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,'rb') as f:
        if not stat.S_ISREG(os.fstat(f.fileno()).st_mode):raise ValueError('regular_cgroup_file_required')
        data=f.read(limit+1)
    if len(data)>limit:raise ValueError('cgroup_observation_budget')
    return data.decode('ascii')


def validate_mount(base):
    base=Path(base)
    if not stat.S_ISDIR(base.lstat().st_mode):raise ValueError('cgroup_v2_mount_directory_required')
    controllers=set(read(base/'cgroup.controllers',65536).split())
    if not {'cpu','memory','pids'}<=controllers:raise ValueError('required_cgroup_v2_controllers_absent')
    return base


def events(path):
    data={}
    for line in read(Path(path)/'cgroup.events',65536).splitlines():
        fields=line.split()
        if len(fields)!=2 or fields[0] in data or not fields[1].isdigit():raise ValueError('invalid_cgroup_events')
        data[fields[0]]=int(fields[1])
    if data.get('populated') not in {0,1}:raise ValueError('cgroup_populated_event_required')
    return data


def snapshot(group,base=MOUNT):
    base=validate_mount(base)
    if group=='':raise ValueError('explicit_legacy_cgroup_binding_required')
    if not isinstance(group,str) or not GROUP.fullmatch(group):raise ValueError('own_worker_cgroup_required')
    parent=base/'system.slice'
    try:parent_info=parent.lstat()
    except FileNotFoundError:return {'empty':True,'absent':True,'pids_count':0,'populated':0}
    if not stat.S_ISDIR(parent_info.st_mode):raise ValueError('system_slice_directory_not_link_required')
    root=base/group.lstrip('/')
    try:info=root.lstat()
    except FileNotFoundError:return {'empty':True,'absent':True,'pids_count':0,'populated':0}
    if not stat.S_ISDIR(info.st_mode):raise ValueError('cgroup_directory_not_link_required')
    before=events(root);seen=[];populated=False;count=0
    def failure(error):raise error
    for directory,dirs,files in os.walk(root,followlinks=False,onerror=failure):
        count+=1
        if count>10000:raise ValueError('cgroup_tree_budget')
        if 'cgroup.procs' not in files or 'cgroup.events' not in files:raise ValueError('complete_existing_cgroup_files_required')
        for name in dirs:
            if not stat.S_ISDIR((Path(directory)/name).lstat().st_mode):raise ValueError('cgroup_directory_link_refused')
        values=read(Path(directory)/'cgroup.procs').split()
        if any(not x.isdigit() or int(x)<1 for x in values):raise ValueError('invalid_cgroup_pid')
        seen.extend(map(int,values));populated=populated or events(directory)['populated']!=0
    if not count:raise ValueError('existing_cgroup_tree_not_observed')
    after=events(root)
    empty=not seen and not populated and before['populated']==0 and after['populated']==0
    return {'empty':empty,'absent':False,'pids_count':len(set(seen)),'populated':after['populated']}
