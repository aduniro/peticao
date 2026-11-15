"""Only fictitious in-memory inventories/archive files; no real proof run."""
import base64
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest import mock

import proof_io as safe
import sri_proof as proof

HERE=Path(__file__).absolute().parent
TMP=HERE/'test-state'/'tmp'
TMP.parent.mkdir(mode=0o700,exist_ok=True);TMP.mkdir(mode=0o700,exist_ok=True)


def sha(raw):return hashlib.sha256(raw).hexdigest()


def file_row(raw,executable=False):
    return {'kind':'file','bytes':len(raw),'sha256':sha(raw),'executable':executable,'elf':raw[:4]==b'\x7fELF','mode':0o755 if executable else 0o644}


def full_fixture():
    pg='node_modules/@embedded-postgres/linux-x64';platform='node_modules/@esbuild/linux-x64';wrapper='node_modules/esbuild'
    roots=sorted([*proof.PREFIX_OVERRIDES,pg,platform,wrapper,*['node_modules/fake'+str(i).zfill(3) for i in range(88)]])
    assert len(roots)==102
    entries={'node_modules':{'kind':'directory','bytes':0,'mode':0o755}}
    vendors={};prefixes=[{'package':r,'actual_archive_prefix':p} for r,p in proof.PREFIX_OVERRIDES.items()]
    for root in roots:
        prefix=proof.PREFIX_OVERRIDES.get(root,'package');row=file_row(json.dumps({'name':root,'version':'1'}).encode())
        entries[root]={'kind':'directory','bytes':0,'mode':0o755};entries[root+'/package.json']=row
        vendors[root]={prefix+'/package.json':copy.deepcopy(row)}
    elf=file_row(b'\x7fELFfictitious binary never executed',True);stub=file_row(b'fictitious wrapper stub',True)
    entries[proof.ESBUILD_TARGET]=copy.deepcopy(elf);vendors[platform]['package/bin/esbuild']=copy.deepcopy(elf)
    entries[proof.ESBUILD]=copy.deepcopy(elf);vendors[wrapper]['package/bin/esbuild']=stub
    aliases=[]
    for i in range(14):
        target=pg+'/native/lib/fake'+str(i)+'.so.1';alias=pg+'/native/lib/fake'+str(i)+'.so'
        row=file_row(('fictitiouslib'+str(i)).encode(),True);entries[target]=row
        vendors[pg]['package/'+target[len(pg)+1:]]=copy.deepcopy(row)
        entries[alias]={'kind':'symlink','bytes':0,'mode':0o755,'linkname':'fake'+str(i)+'.so.1','target':target,'final_target':target}
        aliases.append({'path':alias,'logical_target':target,'logical_target_text_sha256':sha(target.encode()),'target_sha256':row['sha256'],'target_bytes':row['bytes']})
    json_files={};json_raw={}
    manifest={'name':'@esbuild/linux-x64','version':'1','bin':{'fake'+str(i):'bin/esbuild' for i in range(8)}}
    raw=json.dumps(manifest).encode();entries[platform+'/package.json']=file_row(raw)
    vendors[platform]['package/package.json']=file_row(raw);json_files[platform+'/package.json']=manifest
    metadata_entries={}
    for i in range(8):
        command='fake'+str(i);path='node_modules/.bin/'+command;target=proof.ESBUILD_TARGET
        rawtarget='../@esbuild/linux-x64/bin/esbuild'
        entries[path]={'kind':'symlink','bytes':0,'mode':0o755,'linkname':rawtarget,'target':target,'final_target':target}
        metadata_entries[path]={'kind':'symlink','command':command,'declared_bin_value':'bin/esbuild',
            'link_target_text_bytes':len(rawtarget),'link_target_text_sha256':sha(rawtarget.encode()),'logical_node_modules_target':target,
            'package_json_sha256':sha(raw),'package_root':platform,'raw_link_target':rawtarget,'tar_bytes':0,'tar_mode':'0o755',
            'target_content_approval_is_separate':True,'target_regular_bytes':elf['bytes'],'target_regular_sha256':elf['sha256']}
    lock={'name':'fictitious','lockfileVersion':3,'packages':{'':{'name':'root'},**{r:{'version':'1'} for r in roots},'absent_optional':{'version':'1'}}}
    hidden={k:({n:r for n,r in v.items() if n in set(roots)} if k=='packages' else v) for k,v in lock.items()}
    raw=(json.dumps(hidden,ensure_ascii=False,indent=2)+'\n').encode();path='node_modules/.package-lock.json';entries[path]=file_row(raw)
    json_files[path]=hidden;json_raw[path]=raw
    metadata_entries[path]={'kind':'file','bytes':len(raw),'mode':'0o644','sha256':sha(raw),'source_lock_sha256':proof.LOCK_SHA,
        'installed_roots':roots,'package_records_must_equal_source_lock':True,'recipe_serialization_byte_match_observed':True,'historical_generation_not_attested':True}
    metadata={'entries':metadata_entries,'allowlist':sorted(metadata_entries),'exact_entry_count':9,'deterministic_reconstruction_only':True,
        'historical_generation_not_attested':True,'normalized_archive_sha256':proof.NORMALIZED_SHA,
        'separate_target_content_exception_review_required':True,'source_lock_sha256':proof.LOCK_SHA}
    top={}
    for path,basis in [('node','official_node_archive'),('package-lock.json','approved_source_lock'),('package.tgz','official_pdfjs_dist_tarball')]:
        entries[path]=file_row(('fake '+path).encode(),True)
        top[path]={'member':proof.comparable(entries[path]),'provenance':{'kind':basis}}
    es={'path':proof.ESBUILD,'original_cache_hardlink_target':proof.ESBUILD_TARGET,
        'wrapper_original':copy.deepcopy(stub),'replacement':elf,'official_package':platform,'official_member':'package/bin/esbuild','rule':'fixture only','normalization':{}}
    policy={'version':1,'status':'CLOSED_POLICY_AUTHORIZED_FOR_SOURCE_REVIEW_ONLY_NOT_EXECUTION','normalized_sha256':proof.NORMALIZED_SHA,
        'normalization_receipt_sha256':proof.NORMALIZATION_SHA,'package_roots':roots,'prefix_overrides':prefixes,
        'pg_links':aliases,'esbuild':es,'metadata':metadata,'top_level':top}
    snapshot={'entries':entries,'members':len(entries),'unpacked_bytes':sum(x['bytes'] for x in entries.values()),'lock':lock,'json_files':json_files,'json_raw':json_raw}
    return snapshot,vendors,policy


def tar_bytes(rows):
    fp=io.BytesIO()
    with tarfile.open(fileobj=fp,mode='w:gz') as archive:
        for path,kind,raw in rows:
            m=tarfile.TarInfo(path);m.mode=0o755 if kind!='file' or (path.endswith('/esbuild') or path.endswith('/bin/node')) else 0o644
            if kind=='file':m.size=len(raw);archive.addfile(m,io.BytesIO(raw))
            else:
                m.type={'directory':tarfile.DIRTYPE,'symlink':tarfile.SYMTYPE,'hardlink':tarfile.LNKTYPE,'fifo':tarfile.FIFOTYPE}[kind]
                if kind in {'symlink','hardlink'}:m.linkname=raw
                archive.addfile(m)
    fp.seek(0);return fp


class CoverageTests(unittest.TestCase):
    def setUp(self):self.snapshot,self.vendors,self.policy=full_fixture()
    def compare(self):return proof.compare_all(self.snapshot,self.vendors,self.policy)
    def test_all_102_complete_maps_all_members_and_only_approved_exceptions(self):
        proof.validate_coverage(self.policy);result=self.compare()
        self.assertEqual(len(result['packages']),102);self.assertEqual(len(result['accepted_transformations']),15)
        self.assertEqual(result['covered_members'],len(self.snapshot['entries']));self.assertTrue(result['filemap_complete']);self.assertFalse(result['fullVendorIntegrity'])
        self.assertFalse(result['cacheOriginalIntegral']);self.assertFalse(result['qualified'])
    def test_empty_directory_requires_explicit_vendor_or_covered_ancestry(self):
        row={'kind':'directory','bytes':0,'mode':0o755}
        for path in ('node_modules/unproven-empty','node_modules/fake000/arbitrary-empty'):
            snapshot=copy.deepcopy(self.snapshot);snapshot['entries'][path]=copy.deepcopy(row)
            with self.assertRaises(proof.Rejected):proof.compare_all(snapshot,self.vendors,self.policy)
        root='node_modules/fake000';path=root+'/vendor-empty/deep'
        self.snapshot['entries'][root+'/vendor-empty']=copy.deepcopy(row);self.snapshot['entries'][path]=copy.deepcopy(row)
        self.vendors[root]['package/vendor-empty/deep']=copy.deepcopy(row)
        result=self.compare();self.assertEqual(result['coverage'][path],'vendor_directory')
        self.assertEqual(result['coverage'][root+'/vendor-empty'],'covered_member_ancestor')

    def test_missing_vendor_package_cannot_pass_101(self):
        self.vendors.pop(self.policy['package_roots'][-1])
        with self.assertRaises(proof.Rejected):self.compare()
    def test_extra_vendor_member_or_missing_installed_member_fails(self):
        root=self.policy['package_roots'][-1];self.vendors[root]['package/extra']=file_row(b'x')
        with self.assertRaises(proof.Rejected):self.compare()
    def test_extra_installed_member_content_or_executable_difference_fails(self):
        for alteration in ('extra','hash','mode'):
            with self.subTest(alteration=alteration):
                snapshot=copy.deepcopy(self.snapshot);root=self.policy['package_roots'][-1]
                if alteration=='extra':snapshot['entries'][root+'/extra']=file_row(b'x')
                elif alteration=='hash':snapshot['entries'][root+'/package.json']['sha256']='0'*64
                else:snapshot['entries'][root+'/package.json']['executable']=True
                with self.assertRaises(proof.Rejected):proof.compare_all(snapshot,self.vendors,self.policy)
    def test_arbitrary_nonstandard_vendor_prefix_fails(self):
        root=self.policy['package_roots'][-1];self.vendors[root]={'arbitrary/package.json':next(iter(self.vendors[root].values()))}
        with self.assertRaises(proof.Rejected):self.compare()
    def test_pg_alias_missing_or_target_hash_wrong_fails(self):
        for alteration in ('missing','targethash','targettype'):
            snapshot=copy.deepcopy(self.snapshot);alias=self.policy['pg_links'][0]
            if alteration=='missing':snapshot['entries'].pop(alias['path'])
            elif alteration=='targethash':snapshot['entries'][alias['logical_target']]['sha256']='0'*64
            else:snapshot['entries'][alias['logical_target']]['kind']='directory'
            with self.assertRaises(proof.Rejected):proof.compare_all(snapshot,self.vendors,self.policy)
    def test_esbuild_must_match_fresh_official_sri_inventory(self):
        self.vendors[self.policy['esbuild']['official_package']]['package/bin/esbuild']['sha256']='0'*64
        with self.assertRaises(proof.Rejected):self.compare()
    def test_wrapper_stub_must_match_literal_original(self):
        self.vendors['node_modules/esbuild']['package/bin/esbuild']['sha256']='0'*64
        with self.assertRaises(proof.Rejected):self.compare()
    def test_all_top_level_members_and_provenance_required(self):
        for path in ('node','package-lock.json','package.tgz'):
            policy=copy.deepcopy(self.policy);policy['top_level'].pop(path)
            with self.assertRaises(proof.Rejected):proof.validate_coverage(policy)
            with self.assertRaises(proof.Rejected):proof.compare_all(self.snapshot,self.vendors,policy)
        self.policy['top_level']['package.tgz']['provenance']['kind']='pending'
        with self.assertRaises(proof.Rejected):proof.validate_coverage(self.policy)
    def test_unowned_metadata_extra_or_changed_link_is_not_generic(self):
        self.snapshot['entries']['node_modules/.bin/unlisted']=copy.deepcopy(self.snapshot['entries']['node_modules/.bin/fake0'])
        with self.assertRaises(proof.Rejected):self.compare()
        self.snapshot['entries'].pop('node_modules/.bin/unlisted');self.snapshot['entries']['node_modules/.bin/fake0']['target']='node_modules/missing/file'
        with self.assertRaises(proof.Rejected):self.compare()
    def test_incomplete_coverage_policy_and_duplicate_roots_fail_closed(self):
        for kind in ('roots','prefix','pg','metadata','unknown'):
            policy=copy.deepcopy(self.policy)
            if kind=='roots':policy['package_roots'][-1]=policy['package_roots'][0]
            if kind=='prefix':policy['prefix_overrides'].pop()
            if kind=='pg':policy['pg_links'].pop()
            if kind=='metadata':policy['metadata']['entries'].pop(next(iter(policy['metadata']['entries'])))
            if kind=='unknown':policy['allow_any']=True
            with self.assertRaises(proof.Rejected):proof.validate_coverage(policy)
    def test_hidden_lock_json_record_and_byte_recipe_are_both_checked(self):
        self.snapshot['json_files']['node_modules/.package-lock.json']['packages'][self.policy['package_roots'][0]]={'version':'wrong'}
        with self.assertRaises(proof.Rejected):self.compare()
    def test_package_bin_declaration_and_manifest_hash_are_both_checked(self):
        path=self.policy['metadata']['entries']['node_modules/.bin/fake0']['package_root']+'/package.json'
        self.snapshot['json_files'][path]['bin']['fake0']='wrong/file'
        with self.assertRaises(proof.Rejected):self.compare()


class ParserTests(unittest.TestCase):
    def test_full_payload_hashes_links_and_literal_prefix(self):
        rows=[('package','directory',None),('package/bin','directory',None),('package/bin/a','file',b'fake'),('package/bin/b','symlink','a')]
        snapshot=proof.scan(tar_bytes(rows),'vendor');self.assertEqual(snapshot['entries']['package/bin/a']['sha256'],sha(b'fake'))
        self.assertEqual(snapshot['entries']['package/bin/b']['final_target'],'package/bin/a')
        with self.assertRaises(proof.Rejected):proof.scan(tar_bytes([('other/file','file',b'x')]),'vendor')
    def test_duplicate_special_hardlink_escape_and_missing_target_rejected(self):
        cases=[[('package/a','file',b'x'),('package/a','file',b'x')],[('package/a','fifo',None)],
               [('package/a','hardlink','package/b')],[('package/a','symlink','../../outside')],[('package/a','symlink','missing')]]
        for rows in cases:
            with self.assertRaises(proof.Rejected):proof.scan(tar_bytes(rows),'vendor')
    def test_declared_size_and_hidden_header_limits(self):
        with mock.patch.object(proof,'MAX_FILE',2):
            with self.assertRaises(proof.Rejected):proof.scan(tar_bytes([('package/a','file',b'long')]),'vendor')
        with mock.patch.object(proof,'MAX_MEMBERS',1):
            with self.assertRaises(proof.Rejected):proof.scan(tar_bytes([('package/a','file',b'x'),('package/b','file',b'y')]),'vendor')
    def test_original_to_normalized_exact_join_and_all_parent_hashes(self):
        parentrows=[('node_modules','directory',None),(proof.ESBUILD_TARGET,'file',b'fakeelf'),(proof.ESBUILD,'hardlink',proof.ESBUILD_TARGET),('node_modules/.bin/esbuild','symlink','../esbuild/bin/esbuild')]
        original=proof.scan(tar_bytes(parentrows),'original')
        childrows=[('node_modules','directory',None),(proof.ESBUILD_TARGET,'file',b'fakeelf'),(proof.ESBUILD,'file',b'fakeelf'),('node_modules/.bin/esbuild','symlink','../esbuild/bin/esbuild')]
        normalized=proof.scan(tar_bytes(childrows),'normalized');rows=[]
        for path,row in normalized['entries'].items():
            p=original['entries'][path];r={'name':path,'parent_type':p['kind'],'parent_size':p['bytes'],
                'output_type':row['kind'],'output_size':row['bytes'],'normalized_mode':row['mode']}
            if p['kind']=='file':r['parent_content_sha256']=p['sha256']
            if p['kind']=='hardlink':r['parent_linkname']=p['linkname'];r['parent_logical_content_sha256']=row['sha256']
            if row['kind']=='file':r['output_content_sha256']=row['sha256']
            if p['kind']=='symlink':r.update(parent_linkname=p['linkname'],link_target_utf8_sha256=sha(p['linkname'].encode()),resolved_target=row['target'],final_target=row['final_target'])
            rows.append(r)
        receipt={'output_sha256':proof.NORMALIZED_SHA,'output_bytes':proof.NORMALIZED_BYTES,'entrymap':rows,
            'strict_manifest':{'members':normalized['members'],'unpacked_bytes':normalized['unpacked_bytes']}}
        self.assertEqual(proof.check_normalization(original,normalized,receipt)['all_members_compared'],4)
        for change in ('parenthash','childhash','missing'):
            r=copy.deepcopy(receipt)
            if change=='parenthash':next(x for x in r['entrymap'] if x['parent_type']=='file')['parent_content_sha256']='0'*64
            if change=='childhash':next(x for x in r['entrymap'] if x['output_type']=='file')['output_content_sha256']='0'*64
            if change=='missing':r['entrymap'].pop()
            with self.assertRaises(proof.Rejected):proof.check_normalization(original,normalized,r)
    def test_noncanonical_normalized_headers_rejected(self):
        fp=io.BytesIO()
        with tarfile.open(fileobj=fp,mode='w:gz') as tar:
            info=tarfile.TarInfo('node');info.size=1;info.mode=0o644;info.uid=123;tar.addfile(info,io.BytesIO(b'x'))
        fp.seek(0)
        with self.assertRaises(proof.Rejected):proof.scan(fp,'normalized')


class CustodyTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=TMP,prefix='sri-fictitious-');self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        self.path=self.root/'fake.tgz';self.raw=b'fictitious local DATA, never executed';self.path.write_bytes(self.raw);self.path.chmod(0o600)
    def test_same_fd_sha512_and_sha256_before_after(self):
        sri='sha512-'+base64.b64encode(hashlib.sha512(self.raw).digest()).decode()
        with safe.Pinned(self.path,sha(self.raw),len(self.raw),sri) as item:self.assertEqual(item.read(1024),self.raw)
        for h,s in [('0'*64,sri),(sha(self.raw),'sha512-'+base64.b64encode(b'x'*64).decode())]:
            with self.assertRaises(ValueError):safe.Pinned(self.path,h,len(self.raw),s)
    def test_path_swap_and_payload_change_detected(self):
        with self.assertRaises(PermissionError):
            with safe.Pinned(self.path,sha(self.raw),len(self.raw)):
                self.path.rename(self.root/'old');self.path.write_bytes(self.raw);self.path.chmod(0o600)
    def test_symlink_hardlink_and_ancestor_symlink_rejected(self):
        alias=self.root/'alias';alias.symlink_to(self.path)
        with self.assertRaises(OSError):safe.Pinned(alias,sha(self.raw),len(self.raw))
        alias.unlink();os.link(self.path,alias)
        with self.assertRaises(PermissionError):safe.Pinned(alias,sha(self.raw),len(self.raw))
        alias.unlink();directory=self.root/'d';directory.mkdir(mode=0o700);(directory/'link').symlink_to(self.root,target_is_directory=True)
        with self.assertRaises(OSError):safe.Pinned(directory/'link/fake.tgz',sha(self.raw),len(self.raw))
    def test_exclusive_reserved_outputs_partials_and_alias_swap(self):
        output=self.root/'proof-data-1';stage=safe.new_output(output)
        try:
            safe.write_json(stage,'PROOF-INTENT.json',{'fullVendorIntegrity':False})
            with self.assertRaises(ValueError):safe.write_json(stage,'arbitrary.json',{})
            with self.assertRaises(FileExistsError):safe.write_json(stage,'PROOF-INTENT.json',{})
            output.rename(self.root/'detached');output.mkdir(mode=0o700)
            with self.assertRaises(PermissionError):safe.write_json(stage,'SRI-PROOF.json',{})
            self.assertEqual(list(output.iterdir()),[])
            self.assertTrue((self.root/'detached/PROOF-INTENT.json').is_file())
        finally:stage.close()
        with self.assertRaises(FileExistsError):safe.new_output(output)
    def test_duplicate_json_nonfinite_and_sri_multiple_algorithms_rejected(self):
        for raw in (b'{"a":1,"a":2}',b'{"a":NaN}'):
            with self.assertRaises(ValueError):safe.parse(raw)
        for sri in ('sha256-x','sha512-a','sha512-'+base64.b64encode(b'x'*64).decode()+' sha512-x'):
            with self.assertRaises(ValueError):safe.sri512(sri)
    def test_closed_execution_template_and_invalid_live_never_fallback(self):
        source=self.root/'source';source.mkdir(mode=0o700)
        for n in ('sri_proof.py','proof_io.py'):
            p=source/n;p.write_bytes(b'fixture closure bytes');p.chmod(0o600)
        template=source/'EXECUTION.template.json';live=self.root/'PROOF-EXECUTION-POLICY.json';output=self.root/'proof-data-1'
        closure={n:sha((source/n).read_bytes()) for n in ('proof_io.py','sri_proof.py')}
        value={'version':1,'role':'offline-complete-sri-proof','uid':1000,'execute':False,'producer_sha256':sha(safe.canonical(closure)),
            'coverage_sha256':None,'normalized_sha256':proof.NORMALIZED_SHA,'output':str(output)}
        template.write_bytes(safe.canonical(value));template.chmod(0o600)
        with mock.patch.multiple(proof,SOURCE=source,TEMPLATE=template,EXECUTION=live,OUTPUT=output,COVERAGE_SHA256=None):
            self.assertFalse(proof.load_policy()[0]['execute'])
            with self.assertRaises(proof.Rejected):proof.prove()
            self.assertFalse(output.exists())
            live.write_bytes(b'bad json');live.chmod(0o600)
            with self.assertRaises(ValueError):proof.load_policy()
            live.write_bytes(safe.canonical({**value,'execute':True}))
            with self.assertRaises(proof.Rejected):proof.load_policy()
            live.unlink();template.write_bytes(safe.canonical({**value,'execute':True}))
            with self.assertRaises(proof.Rejected):proof.load_policy()
    def top_fixture(self):
        import contextlib
        snapshot,_,policy=full_fixture();public=self.root/'public';public.mkdir(mode=0o700)
        nodefolder=public/'node-vendor-input';nodefolder.mkdir(mode=0o700)
        pdfdir=self.root/'pdfjs-vendor';pdfdir.mkdir(mode=0o700)
        def write(path,raw):path.write_bytes(raw);path.chmod(0o600);return sha(raw),len(raw)
        nodepath=nodefolder/'node-v20.19.2-linux-x64.tar.xz'
        nodeblob=tar_bytes([('node-v20.19.2-linux-x64/bin/node','file',b'fake node')]).getvalue()
        nh,nb=write(nodepath,nodeblob)
        checkpath=nodefolder/'SHASUMS256.txt';ch,cb=write(checkpath,(nh+'  '+nodepath.name+'\n').encode())
        provenance={'archive':{'sha256':nh,'bytes':nb},'checksums':{'sha256':ch},
            'node_member':{'name':'node-v20.19.2-linux-x64/bin/node','sha256':sha(b'fake node')},'vendor_signature_verified':False,'ELF_executed':False}
        provpath=nodefolder/'NODE-PROVENANCE.json';ph,pb=write(provpath,safe.canonical(provenance))
        policy['top_level']['node']['provenance']={'kind':'official_node_archive','archive_path':str(nodepath),'archive_sha256':nh,'archive_bytes':nb,
            'archive_prefix':'node-v20.19.2-linux-x64','archive_member':'node-v20.19.2-linux-x64/bin/node','checksums_path':str(checkpath),
            'checksums_sha256':ch,'checksums_bytes':cb,'official_https_provenance_path':str(provpath),'official_https_provenance_sha256':ph,'vendor_signature_verified':False}
        pdfpath=pdfdir/'pdfjs-dist-6.5.438.tgz';pdfblob=tar_bytes([('package/package.json','file',b'{"name":"pdfjs-dist","version":"6.5.438"}')]).getvalue()
        dh,db=write(pdfpath,pdfblob);sri='sha512-'+base64.b64encode(hashlib.sha512(pdfblob).digest()).decode()
        snapshot['entries']['package.tgz']=file_row(pdfblob);policy['top_level']['package.tgz']['member']=proof.comparable(snapshot['entries']['package.tgz'])
        metadata={'name':'pdfjs-dist','version':'6.5.438','dist':{'integrity':sri,'tarball':'https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.5.438.tgz'}}
        metapath=pdfdir/'registry-version.json';mh,mb=write(metapath,safe.canonical(metadata))
        record={'registry_metadata':{'sha256':mh},'tarball':{'sha256':dh},'package':{'integrity':sri},
            'existing_lock_package_roots_unchanged':102,'package_roots_added':0,'vendorSignatureVerified':False}
        recordpath=pdfdir/'RESULT.json';rh,rb=write(recordpath,safe.canonical(record))
        policy['top_level']['package.tgz']['provenance']={'kind':'official_pdfjs_dist_tarball','archive_path':str(pdfpath),'archive_sha256':dh,'archive_bytes':db,
            'registry_sri_sha512':sri,'resolved':metadata['dist']['tarball'],'version':'6.5.438','package_name':'pdfjs-dist','archive_prefix':'package',
            'metadata_path':str(metapath),'metadata_sha256':mh,'metadata_bytes':mb,'metadata_url':'https://registry.npmjs.org/pdfjs-dist/6.5.438',
            'evidence_path':str(recordpath),'evidence_sha256':rh,'artifact_separate_from_package_roots':True,'vendor_signature_verified':False}
        lh=snapshot['entries']['package-lock.json']['sha256'];policy['top_level']['package-lock.json']['provenance']={'kind':'approved_source_lock','sha256':lh}
        patch=mock.patch.multiple(proof,BASE=self.root,PUBLIC=public,NODE_ARCHIVE=nodepath,NODE_SHA=nh,NODE_BYTES=nb,LOCK_SHA=lh)
        return snapshot,policy,patch

    def test_top_node_archive_and_separate_103_registry_sri_reverified(self):
        import contextlib
        snapshot,policy,patch=self.top_fixture()
        with patch,contextlib.ExitStack() as stack:
            evidence,inputs=proof.check_top_level(stack,snapshot,policy['top_level'])
            self.assertEqual(set(evidence),{'node','package-lock.json','package.tgz'})
            self.assertTrue(evidence['package.tgz']['separate_from_102_installed_roots']);self.assertGreaterEqual(len(inputs),6)
    def test_top_pdf_sri_blob_mismatch_is_not_approved_string(self):
        import contextlib
        snapshot,policy,patch=self.top_fixture();policy['top_level']['package.tgz']['provenance']['registry_sri_sha512']='sha512-'+base64.b64encode(b'x'*64).decode()
        with patch,contextlib.ExitStack() as stack:
            with self.assertRaises(proof.Rejected):proof.check_top_level(stack,snapshot,policy['top_level'])
    def test_top_node_checksum_line_reverified_not_only_receipt(self):
        import contextlib
        snapshot,policy,patch=self.top_fixture();p=policy['top_level']['node']['provenance']
        check=Path(p['checksums_path']);raw=('0'*64+'  '+Path(p['archive_path']).name+'\n').encode();check.write_bytes(raw);p['checksums_sha256']=sha(raw)
        with patch,contextlib.ExitStack() as stack:
            with self.assertRaises(proof.Rejected):proof.check_top_level(stack,snapshot,policy['top_level'])

    def test_changed_input_in_exit_prevents_any_proof_publication(self):
        output=self.root/'proof-data-1';execution=({'execute':True,'producer_sha256':'a'*64},'b'*64,self.root/'live',{})
        instances=[]
        class ChangedOnExit(safe.Pinned):
            def __exit__(inner,*args):
                with inner.path.open('ab') as stream:stream.write(b'changed just before final exit rehash')
                return super().__exit__(*args)
        def collect(inputs,outputs,current):
            stage=outputs.enter_context(safe.new_output(output))
            safe.write_json(stage,'PROOF-INTENT.json',{'fullVendorIntegrity':False})
            item=inputs.enter_context(ChangedOnExit(self.path,sha(self.raw),len(self.raw)));instances.append(item)
            return stage,{'fullVendorIntegrity':False},{'entries':{'fake':{}}},{'fake':{}}
        with mock.patch.object(proof,'load_policy',return_value=execution),mock.patch.object(proof,'_collect_inputs',side_effect=collect):
            with self.assertRaises(PermissionError):proof.prove()
        self.assertEqual(len(instances),1);self.assertIsNone(instances[0].fp)
        self.assertEqual({p.name for p in output.iterdir()},{'PROOF-INTENT.json'})
        self.assertFalse((output/'SRI-PROOF.json').exists());self.assertFalse((output/'PROOF-RECEIPT.json').exists())

    def test_no_public_args_or_fixture_owner_seam(self):
        with self.assertRaises(TypeError):proof.prove('/arbitrary')
        with self.assertRaises(TypeError):proof.prove(_expected_uid=1000)


if __name__=='__main__':unittest.main()
