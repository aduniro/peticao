"""Owner-authorized single OCI development VM. No app, DB, GPU or production changes."""
import base64,datetime,hashlib,ipaddress,json,os,pathlib,subprocess,uuid
import oci
P=pathlib.Path(__file__).resolve().parent.parent
SOURCE=pathlib.Path(__file__).resolve().parent
COORD='/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py'
def save(name,data):
 p=P/name;t=p.with_suffix(p.suffix+'.tmp')
 fd=os.open(t,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
 with os.fdopen(fd,'w')as f:json.dump(data,f,indent=2,default=str)
 os.replace(t,p)
EXPECTED_OPERATION='edit' # New infrastructure only, not app publication/migration.
EXPECTED_RESOURCES={'deploy:oracle-dev-sp','path:'+str(SOURCE)}
def coord(args):
 r=subprocess.run(['python3',COORD]+args,capture_output=True,text=True)
 if r.returncode:raise RuntimeError('Coordinator rejected ownership check')
 d=json.loads(r.stdout)
 if not d.get('ok'):raise RuntimeError('Coordinator ownership response invalid')
 return d['result']
def fence():
 x=json.load(open(P/'.provision-lease.private.json'))['result']
 authorization=json.load(open(P/'MANIFEST-EVENT-FINAL.json'))
 event_id=authorization['result']['seq']
 review_ack_event=authorization['review_ack_event']
 coord(['check','--actor','admin-recuperacao','--lease',x['lease'],'--token',x['token'],'--fence',str(x['fence'])])
 status=coord(['status'])
 lease=next((l for l in status['leases'] if l['id']==x['lease']),None)
 if not lease or lease['actor']!='admin-recuperacao' or lease['operation']!=EXPECTED_OPERATION or lease['state']!='active' or lease['fence']!=x['fence'] or set(lease['resources'])!=EXPECTED_RESOURCES:
  raise RuntimeError('Lease operation, scope or identity mismatch')
 acquired=coord(['history','--after-seq',str(x['seq']-1),'--limit','1'])
 if len(acquired)!=1:raise RuntimeError('Acquisition event unavailable')
 e=acquired[0];d=e['data']
 if e['seq']!=x['seq'] or e['kind']!='lease_acquired' or e['actor']!='admin-recuperacao' or d['lease']!=x['lease'] or d['fence']!=x['fence'] or d['operation']!=EXPECTED_OPERATION or d['manifest_event']!=event_id or set(e['resources'])!=EXPECTED_RESOURCES:
  raise RuntimeError('Acquisition event scope or manifest mismatch')
 events=coord(['history','--after-seq',str(event_id-1),'--limit','1'])
 if len(events)!=1 or events[0]['seq']!=event_id or events[0]['kind']!='notice' or events[0]['actor']!='admin-recuperacao' or set(events[0]['resources'])!=EXPECTED_RESOURCES:
  raise RuntimeError('Manifest event identity mismatch')
 if events[0]['requires_ack']!=1:raise RuntimeError('Manifest must require independent review')
 if any(d['target_event']==event_id for d in status['notice_dispositions']):raise RuntimeError('Manifest was disposed')
 if any(d['event']==event_id for d in status['pending_ack']):raise RuntimeError('Manifest review still pending')
 ack=coord(['history','--after-seq',str(review_ack_event-1),'--limit','1'])
 if len(ack)!=1 or ack[0]['seq']!=review_ack_event or ack[0]['kind']!='ack' or ack[0]['actor']!='apoio' or ack[0]['data']['event_seq']!=event_id:raise RuntimeError('Independent reviewer ACK missing or mismatched')
 manifest=events[0]['data']['manifest']
 decision_path=P/'ROOT-SCOPE-DECISION.json'
 if hashlib.sha256(decision_path.read_bytes()).hexdigest()!=manifest['root_scope_decision_sha256']:raise RuntimeError('Root scope decision pin mismatch')
 decision=json.load(open(decision_path))
 if hashlib.sha256(pathlib.Path(decision['canonical_document']).read_bytes()).hexdigest()!=decision['canonical_document_sha256']:raise RuntimeError('Canonical Root scope decision changed')
 if decision['from']!='01a1cad7-4a65-7d43-b8c2-f0b50a90a580' or decision['operation']!=EXPECTED_OPERATION or set(decision['resources'])!=EXPECTED_RESOURCES or decision['technical_ack']is not False:raise RuntimeError('Root scope decision mismatch')
 head=subprocess.check_output(['git','-C',str(SOURCE),'rev-parse','HEAD'],text=True).strip()
 dirty=subprocess.check_output(['git','-C',str(SOURCE),'status','--porcelain'],text=True)
 if dirty or head!=manifest['commit']:raise RuntimeError('Source HEAD or cleanliness mismatch')
 pins=manifest['file_hashes_sha256']
 expected={str(SOURCE/n)for n in ['provision.py','PLAN.json','cloud-init.yaml','.gitignore']}
 if set(pins)!=expected or set(manifest['files'])!=expected:raise RuntimeError('Manifest file list mismatch')
 for name,digest in pins.items():
  if hashlib.sha256(pathlib.Path(name).read_bytes()).hexdigest()!=digest:raise RuntimeError('Frozen source hash mismatch')
 if hashlib.sha256((P/'PREFLIGHT.json').read_bytes()).hexdigest()!=manifest['preflight_sha256']:raise RuntimeError('Preflight pin mismatch')

fence()
pre=json.load(open(P/'PREFLIGHT.json'));plan=json.load(open(SOURCE/'PLAN.json'))
assert pre['quota']['standard-e5-core-count']['available']>=12
assert pre['quota']['standard-e5-memory-count']['available']>=64
assert pre['capacity']['shape_availabilities'][0]['availability_status']=='AVAILABLE'
assert not pre['instances'] and not pre['vcns'],'Preflight unexpected existing resources; review required'
owner_ip=ipaddress.ip_address(pre['local_public_ipv4']);assert owner_ip.version==4
c=oci.config.from_file(str(pathlib.Path.home()/'.oci/peticao-oracle/config'),'peticao-oracle-dell3576');c['region']=plan['region'];tenant=c['tenancy']
kw=dict(timeout=(10,60),retry_strategy=oci.retry.NoneRetryStrategy())
compute=oci.core.ComputeClient(c,**kw);net=oci.core.VirtualNetworkClient(c,**kw)
name=plan['name'];tags={'project':'peticao','managed-by':'peticao-infra','purpose':'development','operation':'oracle-vm-create-20261115'}
state=json.load(open(P/'PROVISION-STATE.json'))if(P/'PROVISION-STATE.json').exists()else{'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'resources':{}}
def step(label,operation):
 item=state['resources'].get(label)
 if item:
  if item.get('state')=='created':return item['data']
  raise RuntimeError('Prior '+label+' operation is uncertain; reconcile before another write')
 fence();token=str(uuid.uuid4());state['resources'][label]={'state':'pending','request_token':token};save('PROVISION-STATE.json',state)
 try:r=operation(token).data
 except Exception as e:
  state['resources'][label].update({'state':'uncertain','error_type':type(e).__name__,'http_status':getattr(e,'status',None),'code':getattr(e,'code',None)})
  save('PROVISION-STATE.json',state);print(json.dumps({'step':label,'status':'uncertain','error_type':type(e).__name__,'http_status':getattr(e,'status',None),'code':getattr(e,'code',None)}),flush=True);raise
 data=oci.util.to_dict(r);state['resources'][label]={'state':'created','data':data};save('PROVISION-STATE.json',state)
 getters={'vcn':'get_vcn','security_list':'get_security_list','internet_gateway':'get_internet_gateway','route_table':'get_route_table','subnet':'get_subnet'}
 if label in getters and data.get('lifecycle_state')!='AVAILABLE':
  response=getattr(net,getters[label])(data['id'])
  response=oci.wait_until(net,response,'lifecycle_state','AVAILABLE',max_wait_seconds=180,max_interval_seconds=5)
  data=oci.util.to_dict(response.data);state['resources'][label]['data']=data;save('PROVISION-STATE.json',state)
 print(json.dumps({'step':label,'status':'created','lifecycle_state':data.get('lifecycle_state')}),flush=True);return data
vcn=step('vcn',lambda t:net.create_vcn(oci.core.models.CreateVcnDetails(compartment_id=tenant,display_name=name+'-vcn',cidr_blocks=['10.44.0.0/16'],dns_label='peticaooracle',freeform_tags=tags),opc_retry_token=t))
# Dedicated subnet will use ONLY this custom security list, never the default VCN list.
sec=step('security_list',lambda t:net.create_security_list(oci.core.models.CreateSecurityListDetails(compartment_id=tenant,vcn_id=vcn['id'],display_name=name+'-security',freeform_tags=tags,ingress_security_rules=[oci.core.models.IngressSecurityRule(protocol='6',source=str(owner_ip)+'/32',tcp_options=oci.core.models.TcpOptions(destination_port_range=oci.core.models.PortRange(min=22,max=22)),description='SSH bootstrap only owner workstation'),oci.core.models.IngressSecurityRule(protocol='17',source='0.0.0.0/0',udp_options=oci.core.models.UdpOptions(destination_port_range=oci.core.models.PortRange(min=41641,max=41641)),description='Tailscale encrypted mesh transport'),oci.core.models.IngressSecurityRule(protocol='1',source='0.0.0.0/0',icmp_options=oci.core.models.IcmpOptions(type=3,code=4),description='Path MTU discovery')],egress_security_rules=[oci.core.models.EgressSecurityRule(protocol='all',destination='0.0.0.0/0')]),opc_retry_token=t))
igw=step('internet_gateway',lambda t:net.create_internet_gateway(oci.core.models.CreateInternetGatewayDetails(compartment_id=tenant,vcn_id=vcn['id'],display_name=name+'-igw',is_enabled=True,freeform_tags=tags),opc_retry_token=t))
route=step('route_table',lambda t:net.create_route_table(oci.core.models.CreateRouteTableDetails(compartment_id=tenant,vcn_id=vcn['id'],display_name=name+'-route',freeform_tags=tags,route_rules=[oci.core.models.RouteRule(destination='0.0.0.0/0',destination_type='CIDR_BLOCK',network_entity_id=igw['id'])]),opc_retry_token=t))
subnet=step('subnet',lambda t:net.create_subnet(oci.core.models.CreateSubnetDetails(compartment_id=tenant,vcn_id=vcn['id'],display_name=name+'-subnet',cidr_block='10.44.1.0/24',dns_label='dev',route_table_id=route['id'],security_list_ids=[sec['id']],prohibit_public_ip_on_vnic=False,freeform_tags=tags),opc_retry_token=t))
# Public SSH key only. Reusable tailnet/cloud tokens are never included in instance metadata.
public_key=pathlib.Path(pre['ssh_public_key_file']).read_text().strip()
user_data=base64.b64encode((SOURCE/'cloud-init.yaml').read_bytes()).decode()
image=next(x for x in pre['images'] if 'aarch64'not in x['display_name'].lower() and 'minimal'not in x['display_name'].lower())
instance=step('instance',lambda t:compute.launch_instance(oci.core.models.LaunchInstanceDetails(compartment_id=tenant,availability_domain=pre['ads'][0],display_name=name,shape='VM.Standard.E5.Flex',shape_config=oci.core.models.LaunchInstanceShapeConfigDetails(ocpus=12,memory_in_gbs=64),source_details=oci.core.models.InstanceSourceViaImageDetails(image_id=image['id'],boot_volume_size_in_gbs=100),create_vnic_details=oci.core.models.CreateVnicDetails(subnet_id=subnet['id'],assign_public_ip=True,hostname_label=name,display_name=name+'-vnic'),metadata={'ssh_authorized_keys':public_key,'user_data':user_data},instance_options=oci.core.models.InstanceOptions(are_legacy_imds_endpoints_disabled=True),freeform_tags=tags),opc_retry_token=t))
save('INSTANCE-CREATED.json',{'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'instance_id':instance['id'],'name':name,'region':plan['region'],'shape':instance['shape'],'shape_config':instance.get('shape_config'),'state':instance['lifecycle_state'],'image_name':image['display_name'],'gpu':False,'next':'waitRUNNING,attesthostkey,bootstrapSSH,tailnet'})
print('VM launch accepted; next validate RUNNING, host key and tailnet.',flush=True)
