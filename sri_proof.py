"""Complete offline SRI DATA prover; operational entry is closed prove().

No imports of archive/package code, network, subprocess, installs or runtime
providers. Coverage policy is pending and execution is disabled until sealed.
"""
import contextlib
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import tarfile

from proof_io import Pinned, Directory, canonical, control, new_output, parse, role, sri512, write_json

BASE=Path('/mnt/apps/peticao-final/infra-sri-proof-20261115')
SOURCE=BASE/'source'
OUTPUT=BASE/'proof-data-1'
TEMPLATE=SOURCE/'EXECUTION.template.json'
EXECUTION=BASE/'PROOF-EXECUTION-POLICY.json'
COVERAGE=BASE/'policy/COVERAGE-POLICY.json'
# Filled only by Parent after reviewing the literal final policy. None blocks.
COVERAGE_SHA256='4145fbb2b1e57c21b79ab90a6bba7f8fcf683eba48c63b7701370f150c3bdb66'
PUBLIC=Path('/mnt/apps/peticao-final/infra-public-inputs-20261115')
NORMALIZED=PUBLIC/'staging-1/dependencies.normalized.tar.gz'
NORMALIZED_SHA='4b2c828ffdd182a8eef3e7fab1dcc8e3a6784318cc2f0c727efd8f978933605f'
NORMALIZED_BYTES=211388662
NORMALIZATION=PUBLIC/'staging-1/NORMALIZATION-RECEIPT.json'
NORMALIZATION_SHA='37b9cc44ecf3a5d822a1d498ceb953b9abc2e51ea0a64714690d8b3c2ebff14b'
NORMALIZATION_BYTES=4697851
VENDOR_ROOT=PUBLIC/'vendor-tarballs'
AUDIT=PUBLIC/'metadata/vendor/VENDOR-AUDIT.json'
AUDIT_SHA='567baf598235f4ff95e2b0b9a88e177a5e568bd3032d18dfeba5482753c49d56'
DETAILS=PUBLIC/'metadata/vendor/COMPARISON-DETAILS.json'
DETAILS_SHA='24b0db24a2bfb928e7d84a94cfe5f67d076a045cf54afd3a858cce6f1b4a8e6e'
CACHE=PUBLIC/'metadata/vendor/CACHE-MEMBER-INVENTORY.json'
CACHE_SHA='d29ddedaa167840ee6efa9374d6c407f0cb3d6b367ce324636d25106d2d87877'
LOCK_SHA='52963634411e4f0dcdb829d53a5c51d98eba853f87227930fae4a1c87f0abe74'
PREFIX_OVERRIDES={
 'node_modules/@types/geojson':'geojson','node_modules/@types/leaflet':'leaflet',
 'node_modules/@types/node':'node v20.19','node_modules/@types/nodemailer':'nodemailer v6.4',
 'node_modules/@types/pg':'pg','node_modules/@types/prop-types':'prop-types',
 'node_modules/@types/qrcode':'qrcode','node_modules/@types/react':'react v18.3',
 'node_modules/@types/react-dom':'react-dom v18.3','node_modules/busboy':'mscdex-busboy-9aadb7a',
 'node_modules/streamsearch':'mscdex-streamsearch-b9e9b39'}
GENERATED=BASE/'generated-metadata/POLICY.json'
GENERATED_SHA='b17767433386d6fb2d09cf8d0dcd5d849e30944dc70379335a77b40e91c36f53'
NODE_ARCHIVE=PUBLIC/'node-vendor-input/node-v20.19.2-linux-x64.tar.xz'
NODE_SHA='cbe59620b21732313774df4428586f7222a84af29e556f848abf624ba41caf90'
NODE_BYTES=25979376
SPEC=BASE/'policy-review/POLICY-SPEC.json'
SPEC_SHA='503caa9bb41d2576bac4c5b4457379a047550697953a0e64c76a3e7c1ae74469'
ORIGINAL=Path('/mnt/apps/peticao-final/_ops/infra-coordenacao-20261112/distributed/civo-qualification-20261114/dependencies-node20-pdfjs.public.tar.gz')
ORIGINAL_SHA='3009712141b019777b6395e36a628f4e1c0b8720fb617e4ffe5c814d91670698'
ORIGINAL_BYTES=207013889
ESBUILD='node_modules/esbuild/bin/esbuild'
ESBUILD_TARGET='node_modules/@esbuild/linux-x64/bin/esbuild'
MAX_FILE=256*1024**2
MAX_MEMBERS=30000
MAX_UNPACKED=2*1024**3
MAX_COMPRESSED=512*1024**2
MAX_JSON=32*1024**2
CHUNK=65536


class Rejected(ValueError):pass


def require(value,code):
    if not value:raise Rejected(code)


def name(value):
    require(type(value) is str and 0<len(value.encode())<=1024 and '\\' not in value
            and not any(ord(c)<32 or ord(c)==127 for c in value),'bounded_member_name_required')
    parts=PurePosixPath(value).parts
    require(not value.startswith('/') and str(PurePosixPath(value))==value and len(parts)<=128
            and not any(x in ('','.','..') for x in value.split('/')),'canonical_member_required')
    return parts


def link_target(member,target,prefix):
    require(type(target) is str and 0<len(target.encode())<=1024 and not target.startswith('/')
            and '\\' not in target and not any(ord(c)<32 or ord(c)==127 for c in target),'bounded_link_required')
    parts=list(PurePosixPath(member).parent.parts)
    for part in target.split('/'):
        if part in ('','.'):continue
        if part=='..':require(bool(parts),'link_escape');parts.pop()
        else:parts.append(part)
    resolved='/'.join(parts);name(resolved)
    require(resolved==prefix or resolved.startswith(prefix+'/'),'link_prefix_escape')
    return resolved


class BoundedTarInfo(tarfile.TarInfo):
    def _proc_member(self,archive):
        archive._proof_headers=getattr(archive,'_proof_headers',0)+1
        require(archive._proof_headers<=3*MAX_MEMBERS,'hidden_header_budget')
        require(self.type!=tarfile.GNUTYPE_SPARSE and 0<=self.size<=MAX_FILE,'sparse_or_oversized_header')
        if self.type in {tarfile.XHDTYPE,tarfile.XGLTYPE,tarfile.SOLARIS_XHDTYPE,tarfile.GNUTYPE_LONGNAME,tarfile.GNUTYPE_LONGLINK}:
            archive._proof_metadata=getattr(archive,'_proof_metadata',0)+self.size
            require(archive._proof_metadata<=8*1024**2,'hidden_metadata_budget')
        if self.type in {tarfile.XHDTYPE,tarfile.XGLTYPE,tarfile.SOLARIS_XHDTYPE}:require(self.size<=65536,'pax_header_budget')
        if self.type in {tarfile.GNUTYPE_LONGNAME,tarfile.GNUTYPE_LONGLINK}:require(self.size<=1025,'long_header_budget')
        return super()._proc_member(archive)
    def _proc_pax(self,archive):
        pos=archive.fileobj.tell();raw=archive.fileobj.read(self._block(self.size));archive.fileobj.seek(pos)
        require(not any(x in raw for x in (b'GNU.sparse',b'SCHILY.realsize',b'SCHILY.filetype=sparse')),'sparse_pax_forbidden')
        return super()._proc_pax(archive)


def scan(fp,kind,prefix='package'):
    """Hash every member; vendor root is an exact policy literal, never guessed."""
    require(kind in {'normalized','original','vendor','node_vendor'},'fixed_scan_kind_required')
    name(prefix);fp.seek(0,2);require(fp.tell()<=MAX_COMPRESSED,'compressed_budget');fp.seek(0)
    entries={};total=0;lock=None;json_files={};json_raw={};metadata_bytes=0
    with tarfile.open(fileobj=fp,mode='r:*',tarinfo=BoundedTarInfo) as archive:
        for member in archive:
            name(member.name)
            require(len(entries)<MAX_MEMBERS and member.name not in entries,'duplicate_or_member_budget')
            require(not member.issparse() and not member.mode&0o7000 and 0<=member.size<=MAX_FILE,'special_or_oversized_member')
            if kind in {'vendor','node_vendor'}:require(member.name==prefix or member.name.startswith(prefix+'/'),'literal_vendor_prefix_required')
            else:require(member.name=='node_modules' or member.name.startswith('node_modules/') or member.name in {'node','package-lock.json','package.tgz'},'normalized_roots_required')
            total+=member.size;require(total<=MAX_UNPACKED,'unpacked_budget')
            row={'kind':'directory','bytes':member.size,'mode':0o755 if member.isdir() or member.mode&0o111 else 0o644}
            if kind=='normalized':
                require(member.mode==row['mode'] and member.uid==member.gid==member.mtime==0
                        and member.uname==member.gname=='','canonical_normalized_headers_required')
            if member.isdir():require(member.size==0,'directory_payload')
            elif member.isfile():
                h=hashlib.sha256();count=0;first=b'';kept=bytearray()
                with archive.extractfile(member) as stream:
                    while chunk:=stream.read(CHUNK):
                        count+=len(chunk);require(count<=member.size,'file_overflow');h.update(chunk)
                        if not first:first=chunk[:4]
                        if kind=='normalized' and (member.name in {'package-lock.json','node_modules/.package-lock.json'}
                            or member.name.endswith('/package.json') and package_root(member.name[:-13])):
                            kept.extend(chunk);require(len(kept)<=4*1024**2,'lock_budget')
                require(count==member.size,'truncated_file')
                row.update(kind='file',sha256=h.hexdigest(),elf=first==b'\x7fELF',executable=bool(member.mode&0o111))
                if kept:
                    metadata_bytes+=len(kept);require(metadata_bytes<=MAX_JSON,'total_json_metadata_budget')
                    value=parse(kept);require(type(value) is dict,'json_object_required')
                    json_files[member.name]=value;json_raw[member.name]=bytes(kept)
                    if member.name=='package-lock.json':lock=value
            elif member.issym():
                require(member.size==0,'link_payload')
                row.update(kind='symlink',linkname=member.linkname,target=link_target(member.name,member.linkname,prefix if kind in {'vendor','node_vendor'} else 'node_modules'))
            elif member.islnk() and kind=='original':
                require(member.name==ESBUILD and member.linkname==ESBUILD_TARGET and member.size==0,'sole_original_hardlink_required')
                row.update(kind='hardlink',linkname=member.linkname,target=member.linkname)
            else:raise Rejected('hardlinks_or_special_members_forbidden')
            entries[member.name]=row
    for member,row in entries.items():
        for parent in PurePosixPath(member).parents:
            if str(parent)=='.':break
            require(str(parent) not in entries or entries[str(parent)]['kind']=='directory','member_below_non_directory')
        if row['kind']=='symlink':
            target=row['target'];seen={member}
            for _ in range(40):
                require(target not in seen and target in entries,'link_loop_or_missing_target');seen.add(target)
                resolved=entries[target]
                if resolved['kind']!='symlink':break
                target=resolved['target']
            else:raise Rejected('link_depth_budget')
            if resolved['kind']=='hardlink' and kind=='original':
                resolved=entries.get(resolved['target'],{})
            require(resolved.get('kind')=='file','regular_link_final_target_required');row['final_target']=target
    if kind=='original' and ESBUILD in entries and entries[ESBUILD]['kind']=='hardlink':
        require(entries.get(ESBUILD_TARGET,{}).get('kind')=='file','original_hardlink_regular_target')
    fp.seek(0)
    return {'entries':entries,'members':len(entries),'unpacked_bytes':total,'lock':lock,'json_files':json_files,'json_raw':json_raw}


def package_root(value):
    parts=name(value);i=0
    while i<len(parts):
        if parts[i]!='node_modules':return False
        i+=1
        if i>=len(parts):return False
        i+=2 if parts[i].startswith('@') else 1
    return i==len(parts)


def owner(member,roots):
    found=[root for root in roots if member.startswith(root+'/')]
    return max(found,key=len) if found else None


def comparable(row):
    if row['kind']=='file':return {k:row[k] for k in ('kind','bytes','sha256','executable')}
    if row['kind']=='symlink':return {'kind':'symlink','target':row['target']}
    return {'kind':'directory'}


def check_entrymap(snapshot,receipt):
    require(receipt.get('output_sha256')==NORMALIZED_SHA and receipt.get('output_bytes')==NORMALIZED_BYTES,'normalization_binding')
    rows=receipt.get('entrymap');require(type(rows) is list,'entrymap_required')
    mapped={x['name']:x for x in rows};entries=snapshot['entries']
    require(len(mapped)==len(rows) and set(mapped)==set(entries),'complete_entrymap_members_required')
    for member,row in entries.items():
        expected=mapped[member]
        require(expected.get('output_type')==row['kind'] and expected.get('output_size')==row['bytes']
                and expected.get('normalized_mode')==row['mode'],'entrymap_metadata_mismatch')
        if row['kind']=='file':require(expected.get('output_content_sha256')==row['sha256'],'entrymap_content_mismatch')
        if row['kind']=='symlink':
            require(expected.get('parent_linkname')==row['linkname'] and expected.get('resolved_target')==row['target']
                    and expected.get('final_target')==row['final_target'],'entrymap_link_mismatch')
    strict=receipt.get('strict_manifest',{})
    require(strict.get('members')==snapshot['members'] and strict.get('unpacked_bytes')==snapshot['unpacked_bytes'],'entrymap_totals_mismatch')


def _hash(value):return type(value) is str and re.fullmatch('[a-f0-9]{64}',value) is not None


def validate_coverage(policy):
    keys={'version','status','normalized_sha256','normalization_receipt_sha256','package_roots','prefix_overrides','pg_links','esbuild','metadata','top_level'}
    require(type(policy) is dict and set(policy)==keys,'closed_coverage_policy_required')
    require(type(policy['version']) is int and policy['version']==1 and policy['status']=='CLOSED_POLICY_AUTHORIZED_FOR_SOURCE_REVIEW_ONLY_NOT_EXECUTION','approved_coverage_policy_required')
    require(policy['normalized_sha256']==NORMALIZED_SHA and policy['normalization_receipt_sha256']==NORMALIZATION_SHA,'coverage_input_bindings')
    roots=policy['package_roots'];require(type(roots) is list and len(roots)==102 and roots==sorted(set(roots)) and all(package_root(r) for r in roots),'exact_102_roots_required')
    require(type(policy['prefix_overrides']) is list and len(policy['prefix_overrides'])==11
            and {x['package']:x['actual_archive_prefix'] for x in policy['prefix_overrides']}==PREFIX_OVERRIDES,'exact_eleven_prefix_overrides_required')
    require(type(policy['pg_links']) is list and len(policy['pg_links'])==14,'exact_fourteen_pg_links_required')
    metadata=policy['metadata']
    require(type(metadata) is dict and set(metadata)=={'allowlist','deterministic_reconstruction_only','entries','exact_entry_count',
        'historical_generation_not_attested','normalized_archive_sha256','separate_target_content_exception_review_required','source_lock_sha256'},'closed_generated_metadata_required')
    require(type(metadata['exact_entry_count']) is int and metadata['exact_entry_count']==9
        and len(metadata['entries'])==9 and metadata['allowlist']==sorted(metadata['entries'])
        and metadata['normalized_archive_sha256']==NORMALIZED_SHA and metadata['source_lock_sha256']==LOCK_SHA
        and all(metadata[k] is True for k in ('deterministic_reconstruction_only','historical_generation_not_attested','separate_target_content_exception_review_required')),'exact_nine_metadata_members_required')
    require(type(policy['top_level']) is dict and set(policy['top_level'])=={'node','package-lock.json','package.tgz'},'complete_top_level_policy_required')
    for path,row in policy['top_level'].items():
        require(type(row) is dict and set(row)=={'member','provenance'} and type(row['member']) is dict,'literal_top_member_required')
        proof=row['provenance'];require(type(proof) is dict and proof.get('kind') in {
            'official_node_archive','approved_source_lock','official_pdfjs_dist_tarball'},'complete_top_provenance_required')
    return policy


def compare_all(snapshot,vendors,policy):
    """Pure exhaustive proof; caller's operational policy must be separately pinned."""
    entries=snapshot['entries'];roots=policy['package_roots'];require(set(vendors)==set(roots),'all_vendor_packages_required')
    discovered=sorted(n[:-13] for n,r in entries.items() if n.endswith('/package.json') and r['kind']=='file' and package_root(n[:-13]))
    require(discovered==roots,'all_installed_package_roots_required')
    coverage={};reports=[];accepted=[];vendor_directories=set()
    pg={x['path']:x for x in policy['pg_links']};es=policy['esbuild'];pg_seen=set();es_seen=False
    prefixes={x['package']:x['actual_archive_prefix'] for x in policy['prefix_overrides']}
    for root in roots:
        vendor=vendors[root];prefix=prefixes.get(root,'package')
        require(all(n==prefix or n.startswith(prefix+'/') for n in vendor),'unexpected_vendor_prefix')
        for member,row in vendor.items():
            path=root+('/'+member[len(prefix)+1:] if member!=prefix else '')
            if row['kind']=='directory' and (path==root or owner(path,roots)==root):
                vendor_directories.add(path)
        actual={n[len(root)+1:]:r for n,r in entries.items() if r['kind']!='directory' and owner(n,roots)==root}
        expected={n[len(prefix)+1:]:r for n,r in vendor.items() if n!=prefix and r['kind']!='directory'
                  and owner(root+'/'+n[len(prefix)+1:],roots)==root}
        require(not set(expected)-set(actual),'missing_vendor_files')
        for rel,a in actual.items():
            path=root+'/'+rel;v=expected.get(rel)
            if path in pg:
                spec=pg[path]
                require(v is None and a['kind']=='symlink' and set(spec)=={'path','logical_target','logical_target_text_sha256','target_sha256','target_bytes'},'closed_pg_extra_link_required')
                target=entries.get(spec['logical_target'])
                require(a['target']==spec['logical_target'] and a['final_target']==spec['logical_target']
                        and hashlib.sha256(a['target'].encode()).hexdigest()==spec['logical_target_text_sha256'] and owner(spec['logical_target'],roots)==root
                        and target is not None and target['kind']=='file' and target['sha256']==spec['target_sha256'] and target['bytes']==spec['target_bytes'],'pg_regular_target_binding')
                pg_seen.add(path);accepted.append({'path':path,'exception':'pg_exact_internal_link','target':spec['logical_target']})
            elif path==es.get('path'):
                require(set(es)=={'path','original_cache_hardlink_target','wrapper_original','replacement','official_package','official_member','rule','normalization'} and v is not None,'closed_esbuild_override_required')
                require(comparable(v)=={k:es['wrapper_original'][k] for k in ('kind','bytes','sha256','executable')},'exact_esbuild_original_wrapper_required')
                official=vendors.get(es['official_package'],{}).get(es['official_member'])
                require(official is not None and official['kind']=='file' and official.get('elf') is True
                        and comparable(a)==comparable(official) and a['sha256']==es['replacement']['sha256'] and a['bytes']==es['replacement']['bytes']
                        and es['original_cache_hardlink_target']==ESBUILD_TARGET,'official_sri_esbuild_binary_required')
                es_seen=True;accepted.append({'path':path,'exception':'esbuild_official_platform_binary','vendor_package':es['official_package'],'vendor_path':es['official_member']})
            else:
                require(v is not None and comparable(a)==comparable(v),'package_filemap_difference')
                require(a['kind']=='file','only_enumerated_package_links_allowed')
            require(path not in coverage,'overlapping_member_coverage');coverage[path]='package:'+root
        reports.append({'package':root,'installed_files':len(actual),'vendor_files':len(expected),
                        'vendor_prefix':prefix,'actual_filemap':{n:comparable(r) for n,r in sorted(actual.items())},
                        'vendor_filemap':{n:comparable(r) for n,r in sorted(expected.items())}})
    require(pg_seen==set(pg) and es_seen,'all_exact_transformations_must_be_proven')
    _metadata_coverage(snapshot,policy['metadata'],coverage,roots)
    for path,spec in policy['top_level'].items():
        row=entries.get(path)
        require(row is not None and path not in coverage and comparable(row)==spec['member'],'literal_top_level_member_mismatch')
        require('/' not in path,'top_level_only');coverage[path]='top_level'
    # Directories need provenance too: covered-member ancestry or an exact
    # explicit vendor directory owned by this package, never arbitrary empties.
    allowed_directories=set(vendor_directories)
    for member in [*coverage,*vendor_directories]:
        allowed_directories.update(str(parent) for parent in PurePosixPath(member).parents if str(parent)!='.')
    for member,row in entries.items():
        if row['kind']=='directory':
            require(member in allowed_directories,'unproven_structural_directory')
            coverage[member]='vendor_directory' if member in vendor_directories else 'covered_member_ancestor'
    require(set(coverage)==set(entries),'complete_all_member_coverage_required')
    return {'filemap_complete':True,'fullVendorIntegrity':False,'cacheOriginalIntegral':False,'coverage':dict(sorted(coverage.items())),
            'covered_members':len(coverage),'packages':reports,'accepted_transformations':accepted,
            'qualified':False,'root_install_performed':False,'native_execution_performed':False,
            'vendorSignatureVerified':False,'historical_NPM_generation_observed':False,'RootFullClosure':False}


def check_normalization(original,normalized,receipt):
    a=original['entries'];b=normalized['entries']
    require(set(a)==set(b),'normalization_exact_member_set')
    rows={r['name']:r for r in receipt['entrymap']}
    require(set(rows)==set(a),'normalization_complete_parent_map')
    changed=[]
    for path,parent in a.items():
        child=b[path];row=rows[path]
        require(row.get('parent_type')==parent['kind'] and row.get('parent_size')==parent['bytes'],'normalization_parent_type_size')
        if parent['kind']=='file':
            require(row.get('parent_content_sha256')==parent['sha256'] and comparable(parent)==comparable(child),'normalization_regular_preservation')
        elif parent['kind']=='hardlink':
            require(path==ESBUILD and parent['target']==ESBUILD_TARGET and child['kind']=='file'
                    and comparable(a[ESBUILD_TARGET])==comparable(child),'sole_materialization_exact_bytes')
            require(row.get('parent_linkname')==ESBUILD_TARGET and row.get('parent_logical_content_sha256')==child['sha256'],
                'materialization_parent_link_binding');changed.append(path)
        elif parent['kind']=='symlink':
            require(child['kind']=='symlink' and parent['linkname']==child['linkname'] and parent['target']==child['target']
                    and parent['final_target']==child['final_target'],'normalization_symlink_preservation')
            require(row.get('parent_linkname')==parent['linkname']
                    and row.get('link_target_utf8_sha256')==hashlib.sha256(parent['linkname'].encode()).hexdigest(),'normalization_link_text_hash')
        else:require(child['kind']=='directory','normalization_directory_preservation')
        require(parent['mode']==child['mode'],'normalization_executable_mode_preservation')
    require(changed==[ESBUILD],'exactly_one_materialization_required')
    check_entrymap(normalized,receipt)
    return {'all_members_compared':len(a),'sole_materialized_hardlink':ESBUILD,'regular_target':ESBUILD_TARGET,
            'original_members':original['members'],'normalized_members':normalized['members'],'cacheOriginalIntegral':False}


def source_closure():
    return {n:hashlib.sha256(control(SOURCE/n,1024**2)).hexdigest() for n in ('proof_io.py','sri_proof.py')}


def load_policy():
    role();live=EXECUTION.exists() or EXECUTION.is_symlink();path=EXECUTION if live else TEMPLATE
    raw=control(path);value=parse(raw)
    require(type(value) is dict and set(value)=={'version','role','uid','execute','producer_sha256','coverage_sha256','normalized_sha256','output'},'closed_execution_policy_required')
    closure=source_closure();digest=hashlib.sha256(canonical(closure)).hexdigest()
    require(type(value['version']) is int and value['version']==1 and value['role']=='offline-complete-sri-proof'
            and type(value['uid']) is int and value['uid']==1000 and type(value['execute']) is bool
            and value['producer_sha256']==digest and value['normalized_sha256']==NORMALIZED_SHA
            and value['output']==str(OUTPUT),'execution_binding_mismatch')
    require(not live and value['execute'] is False or live,'template_cannot_authorize_execution')
    if value['execute']:
        require(_hash(COVERAGE_SHA256) and value['coverage_sha256']==COVERAGE_SHA256,'literal_coverage_pin_pending')
    else:require(value['coverage_sha256']==COVERAGE_SHA256,'template_coverage_pin_mismatch')
    return value,hashlib.sha256(raw).hexdigest(),path,closure


def _open_json(stack,path,digest,size):
    require(type(size) is int and 0<size<=MAX_JSON,'bounded_json_file_required')
    item=stack.enter_context(Pinned(path,digest,size));return item,parse(item.read(MAX_JSON))


def _literal_spec(policy,spec):
    pins=spec['all102_package_pins'];roots=sorted(x['package'] for x in pins)
    require(len(roots)==102 and len(set(roots))==102 and policy['package_roots']==roots,'literal_spec_roots_required')
    require(policy['prefix_overrides']==spec['nonstandard_prefix_allowlist'] and policy['pg_links']==spec['pg_aliases']
            and policy['esbuild']==spec['esbuild_override'],'exact_reviewed_exception_literals_required')
    return {r['package']:r for r in pins}


def _verify_tarball_pin(root,pin,lock):
    require(package_root(root) and pin['package']==root,'literal_package_pin_root')
    require(set(pin)=={'package','version','resolved','lock_sri_sha512','tarball_path','tarball_sha256','tarball_bytes','actual_archive_prefix','archive_members','fresh_sri_sha256_size_verified'},'closed_tarball_pin_required')
    row=lock.get('packages',{}).get(root)
    require(type(row) is dict and row.get('version')==pin['version'] and row.get('resolved')==pin['resolved']
            and row.get('integrity')==pin['lock_sri_sha512'],'exact_lock_package_pin_required')
    require(type(pin['resolved']) is str and re.fullmatch(r'https://registry\.npmjs\.org/[A-Za-z0-9@_./%+~-]+',pin['resolved']) is not None
            and '..' not in pin['resolved'].split('/'),'official_fixed_registry_url_required')
    sri512(pin['lock_sri_sha512'])
    filename=hashlib.sha256((root+'\n'+pin['resolved']+'\n'+pin['lock_sri_sha512']).encode()).hexdigest()+'.tgz'
    require(pin['tarball_path']==str(VENDOR_ROOT/filename) and _hash(pin['tarball_sha256'])
            and type(pin['tarball_bytes']) is int and 0<pin['tarball_bytes']<=64*1024**2,'literal_local_tarball_binding')
    require(pin['actual_archive_prefix']==PREFIX_OVERRIDES.get(root,'package'),'exact_tarball_prefix_pin')


def _collect_inputs(stack,output_stack,execution):
    value,execution_sha,path,closure=execution
    coverage_input=stack.enter_context(Pinned(COVERAGE,COVERAGE_SHA256,34646))
    coverage=validate_coverage(parse(coverage_input.read(MAX_JSON)))
    spec_input,spec=_open_json(stack,SPEC,SPEC_SHA,SPEC.lstat().st_size)
    pins=_literal_spec(coverage,spec)
    generated_input,generated=_open_json(stack,GENERATED,GENERATED_SHA,GENERATED.lstat().st_size)
    require(coverage['metadata']==generated['metadata'],'exact_reviewed_metadata_literal_required')
    stage=output_stack.enter_context(new_output(OUTPUT))
    write_json(stage,'PROOF-INTENT.json',{'version':1,'state':'intent_no_replay','producer_sha256':value['producer_sha256'],
               'coverage_sha256':COVERAGE_SHA256,'execution_sha256':execution_sha,'normalized_sha256':NORMALIZED_SHA,
               'fullVendorIntegrity':False,'qualified':False})
    original=stack.enter_context(Pinned(ORIGINAL,ORIGINAL_SHA,ORIGINAL_BYTES,public_data=True))
    normalized=stack.enter_context(Pinned(NORMALIZED,NORMALIZED_SHA,NORMALIZED_BYTES))
    receipt_input,receipt=_open_json(stack,NORMALIZATION,NORMALIZATION_SHA,NORMALIZATION_BYTES)
    snapshot=scan(normalized.fp,'normalized');parent=scan(original.fp,'original')
    normalization=check_normalization(parent,snapshot,receipt)
    require(snapshot['entries'].get('package-lock.json',{}).get('sha256')==LOCK_SHA and type(snapshot['lock']) is dict,'approved_lock_required')
    cache_input,cache=_open_json(stack,CACHE,CACHE_SHA,3231166)
    require(cache['package_roots']==coverage['package_roots'] and set(cache['members'])==set(parent['entries']),'cache_inventory_complete_roots_members')
    vendors={};tarball_receipts=[];tarball_inputs=[]
    for root,pin in sorted(pins.items()):
        _verify_tarball_pin(root,pin,snapshot['lock'])
        item=stack.enter_context(Pinned(Path(pin['tarball_path']),pin['tarball_sha256'],pin['tarball_bytes'],pin['lock_sri_sha512']))
        tarball_inputs.append(item)
        vendor=scan(item.fp,'vendor',pin['actual_archive_prefix'])
        require(vendor['members']==pin['archive_members'],'complete_tarball_member_count')
        vendors[root]=vendor['entries'];item.check(rehash=True)
        tarball_receipts.append({'package':root,'sha256':pin['tarball_sha256'],'bytes':pin['tarball_bytes'],
             'lock_sha512_sri':pin['lock_sri_sha512'],'members':vendor['members'],
             'unpacked_bytes':vendor['unpacked_bytes'],'member_inventory':vendor['entries'],'same_fd_before_after':True})
    top_proof,top_inputs=check_top_level(stack,snapshot,coverage['top_level'])
    tarball_inputs.extend(top_inputs)
    result=compare_all(snapshot,vendors,coverage)
    result['top_level_evidence']=top_proof
    for item in (coverage_input,spec_input,generated_input,original,normalized,receipt_input,cache_input,*tarball_inputs):item.check(rehash=True)
    require(load_policy()==execution,'execution_or_source_changed_before_proof')
    result.update(version=1,role='offline-complete-sri-proof',normalized_sha256=NORMALIZED_SHA,
        normalization_receipt_sha256=NORMALIZATION_SHA,normalization_join=normalization,coverage_policy_sha256=COVERAGE_SHA256,
        producer_sha256=value['producer_sha256'],source_closure=closure,execution_sha256=execution_sha,
        normalized_inventory=snapshot['entries'],vendor_tarballs=tarball_receipts,
        inventory_sha256=hashlib.sha256(canonical(snapshot['entries'])).hexdigest())
    return stage,result,snapshot,vendors


def prove():
    """Fixed offline entry; every input exit check precedes proof publication."""
    execution=load_policy();value,execution_sha,path,closure=execution
    require(value['execute'] is True,'parent_execution_policy_required')
    with contextlib.ExitStack() as output_stack:
        with contextlib.ExitStack() as inputs:
            stage,result,snapshot,vendors=_collect_inputs(inputs,output_stack,execution)
        # No input context remains open. An exit-time rehash/stat failure above
        # leaves only the intent/partials, without a proof or completion receipt.
        require(load_policy()==execution,'execution_or_source_changed_after_input_exit')
        result['fullVendorIntegrity']=True  # All input context exit checks have completed and FDs are closed.
        proof_sha=write_json(stage,'SRI-PROOF.json',result)
        require(load_policy()==execution,'execution_or_source_changed_before_receipt')
        stage.check()
        require(set(os.listdir(stage.fd))=={'PROOF-INTENT.json','SRI-PROOF.json'},'exact_reserved_output_set')
        receipt_sha=write_json(stage,'PROOF-RECEIPT.json',{'version':1,'state':'COMPLETE_OFFLINE_SRI_PROOF',
            'proof_sha256':proof_sha,'producer_sha256':value['producer_sha256'],'coverage_policy_sha256':COVERAGE_SHA256,
            'normalized_sha256':NORMALIZED_SHA,'fullVendorIntegrity':True,'cacheOriginalIntegral':False,
            'covered_members':len(snapshot['entries']),'packages':len(vendors),'qualified':False,
            'root_install_performed':False,'native_execution_performed':False,'vendorSignatureVerified':False,
            'historical_NPM_generation_observed':False,'RootFullClosure':False})
        return {'state':'COMPLETE_OFFLINE_SRI_PROOF','output':str(OUTPUT),'proof_sha256':proof_sha,
                'receipt_sha256':receipt_sha,'fullVendorIntegrity':True,'qualified':False}


def _metadata_coverage(snapshot,metadata,coverage,roots):
    entries=snapshot['entries'];policy=metadata['entries']
    require(metadata['allowlist']==sorted(policy) and len(policy)==metadata['exact_entry_count']==9,'exact_metadata_member_set')
    for path,spec in policy.items():
        row=entries.get(path)
        require(row is not None and path not in coverage and owner(path,roots) is None,'unowned_metadata_binding')
        if spec['kind']=='symlink':
            keys={'command','declared_bin_value','kind','link_target_text_bytes','link_target_text_sha256','logical_node_modules_target',
                'package_json_sha256','package_root','raw_link_target','tar_bytes','tar_mode','target_content_approval_is_separate',
                'target_regular_bytes','target_regular_sha256'}
            require(set(spec)==keys and row['kind']=='symlink' and path=='node_modules/.bin/'+spec['command']
                and row['linkname']==spec['raw_link_target'] and len(row['linkname'].encode())==spec['link_target_text_bytes']
                and hashlib.sha256(row['linkname'].encode()).hexdigest()==spec['link_target_text_sha256']
                and row['target']==row['final_target']==spec['logical_node_modules_target']
                and row['bytes']==spec['tar_bytes']==0 and oct(row['mode'])==spec['tar_mode'],'exact_bin_link_metadata')
            root=spec['package_root'];manifest_path=root+'/package.json'
            manifest=snapshot['json_files'].get(manifest_path)
            require(root in roots and coverage.get(manifest_path)=='package:'+root
                and entries[manifest_path]['sha256']==spec['package_json_sha256'] and type(manifest) is dict,'proven_package_manifest_required')
            bins=manifest.get('bin')
            if type(bins) is str:
                require(type(manifest.get('name')) is str and manifest['name'].split('/')[-1]==spec['command'],'package_bin_string_command')
                declared=bins
            else:
                require(type(bins) is dict,'package_bin_map_required');declared=bins.get(spec['command'])
            require(declared==spec['declared_bin_value'] and link_target(manifest_path,declared,root)==row['target'],'package_bin_declaration_binding')
            target=entries.get(row['target'])
            require(target is not None and target['kind']=='file' and target['sha256']==spec['target_regular_sha256']
                and target['bytes']==spec['target_regular_bytes'] and coverage.get(row['target'],'').startswith('package:'),'already_proven_bin_target_required')
        elif path=='node_modules/.package-lock.json':
            require(spec['kind']==row['kind']=='file' and row['bytes']==spec['bytes'] and row['sha256']==spec['sha256']
                and oct(row['mode'])==spec['mode'] and spec['installed_roots']==roots
                and spec['source_lock_sha256']==LOCK_SHA and spec['package_records_must_equal_source_lock'] is True
                and spec['recipe_serialization_byte_match_observed'] is True and spec['historical_generation_not_attested'] is True,'hidden_lock_literal_binding')
            source=snapshot['lock'];require(type(source) is dict and type(source.get('packages')) is dict,'source_lock_object_required')
            reconstructed={k:({n:r for n,r in v.items() if n in set(roots)} if k=='packages' else v) for k,v in source.items()}
            raw=(json.dumps(reconstructed,ensure_ascii=False,indent=2)+'\n').encode()
            require(set(reconstructed['packages'])==set(roots) and parse(raw)==snapshot['json_files'].get(path)
                and raw==snapshot['json_raw'].get(path) and len(raw)==row['bytes'] and hashlib.sha256(raw).hexdigest()==row['sha256'],'hidden_lock_deterministic_reconstruction')
        else:raise Rejected('unknown_metadata_kind_or_path')
        coverage[path]='metadata_deterministically_reconstructed'


def check_top_level(stack,snapshot,policy):
    """Verify real evidence bytes; no approved-string or generic path bypass."""
    entries=snapshot['entries'];evidence={};inputs=[]
    lock=policy['package-lock.json'];p=lock['provenance']
    require(set(p)=={'kind','sha256'} and p['kind']=='approved_source_lock' and p['sha256']==LOCK_SHA
            and entries['package-lock.json']['sha256']==LOCK_SHA,'approved_top_source_lock')
    evidence['package-lock.json']={'kind':'approved_source_lock','sha256':LOCK_SHA}
    node=policy['node'];p=node['provenance']
    require(set(p)=={'kind','archive_path','archive_sha256','archive_bytes','archive_prefix','archive_member','checksums_path','checksums_sha256','checksums_bytes','official_https_provenance_path','official_https_provenance_sha256','vendor_signature_verified'}
        and p['kind']=='official_node_archive' and p['archive_path']==str(NODE_ARCHIVE)
        and p['archive_sha256']==NODE_SHA and p['archive_bytes']==NODE_BYTES
        and p['archive_prefix']=='node-v20.19.2-linux-x64' and p['archive_member']=='node-v20.19.2-linux-x64/bin/node','closed_node_archive_provenance')
    require(p['checksums_path']==str(PUBLIC/'node-vendor-input/SHASUMS256.txt')
        and p['official_https_provenance_path']==str(PUBLIC/'node-vendor-input/NODE-PROVENANCE.json')
        and p['vendor_signature_verified'] is False,'closed_node_evidence_paths')
    checksums=stack.enter_context(Pinned(Path(p['checksums_path']),p['checksums_sha256'],p['checksums_bytes']));inputs.append(checksums)
    lines=checksums.read(65536).decode('ascii').splitlines()
    matches=[line.split() for line in lines if len(line.split())==2 and line.split()[1]==NODE_ARCHIVE.name]
    require(matches==[[NODE_SHA,NODE_ARCHIVE.name]],'official_node_checksum_line')
    provenance_path=Path(p['official_https_provenance_path'])
    provenance_input,provenance=_open_json(stack,provenance_path,p['official_https_provenance_sha256'],provenance_path.lstat().st_size);inputs.append(provenance_input)
    require(provenance['archive']['sha256']==NODE_SHA and provenance['archive']['bytes']==NODE_BYTES
        and provenance['checksums']['sha256']==p['checksums_sha256']
        and provenance['node_member']['name']==p['archive_member']
        and provenance['node_member']['sha256']==entries['node']['sha256']
        and provenance['vendor_signature_verified'] is False and provenance['ELF_executed'] is False,'official_node_prior_provenance_binding')
    item=stack.enter_context(Pinned(NODE_ARCHIVE,NODE_SHA,NODE_BYTES));inputs.append(item)
    value=scan(item.fp,'node_vendor',p['archive_prefix']);member=value['entries'].get(p['archive_member'])
    require(member is not None and member['kind']=='file' and comparable(member)==comparable(entries['node']),'official_node_member_bytes')
    evidence['node']={'kind':p['kind'],'archive_sha256':NODE_SHA,'member':p['archive_member'],'member_sha256':member['sha256'],
        'member_bytes':member['bytes'],'archive_members':value['members'],'member_inventory_sha256':hashlib.sha256(canonical(value['entries'])).hexdigest()}
    pdf=policy['package.tgz'];p=pdf['provenance']
    require(set(p)=={'kind','archive_path','archive_sha256','archive_bytes','registry_sri_sha512','resolved','version','package_name','archive_prefix','metadata_path','metadata_sha256','metadata_bytes','metadata_url','evidence_path','evidence_sha256','artifact_separate_from_package_roots','vendor_signature_verified'}
        and p['kind']=='official_pdfjs_dist_tarball' and p['version']=='6.5.438' and p['archive_prefix']=='package'
        and p['resolved']=='https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.5.438.tgz'
        and Path(p['archive_path']).parent==BASE/'pdfjs-vendor' and Path(p['archive_path']).name=='pdfjs-dist-6.5.438.tgz'
        and _hash(p['archive_sha256']) and p['archive_sha256']==entries['package.tgz']['sha256']
        and type(p['archive_bytes']) is int and p['archive_bytes']==entries['package.tgz']['bytes'],'closed_pdfjs_103rd_artifact_provenance')
    require(p['package_name']=='pdfjs-dist' and p['artifact_separate_from_package_roots'] is True
        and p['vendor_signature_verified'] is False and p['metadata_path']==str(BASE/'pdfjs-vendor/registry-version.json')
        and p['metadata_url']=='https://registry.npmjs.org/pdfjs-dist/6.5.438'
        and p['evidence_path']==str(BASE/'pdfjs-vendor/RESULT.json'),'closed_pdfjs_evidence_paths')
    metadata_input,metadata=_open_json(stack,Path(p['metadata_path']),p['metadata_sha256'],p['metadata_bytes']);inputs.append(metadata_input)
    require(metadata.get('name')=='pdfjs-dist' and metadata.get('version')=='6.5.438'
        and metadata.get('dist',{}).get('integrity')==p['registry_sri_sha512']
        and metadata.get('dist',{}).get('tarball')==p['resolved'],'pdfjs_registry_version_sri_binding')
    evidence_path=Path(p['evidence_path'])
    evidence_input,record=_open_json(stack,evidence_path,p['evidence_sha256'],evidence_path.lstat().st_size);inputs.append(evidence_input)
    require(record['registry_metadata']['sha256']==p['metadata_sha256'] and record['tarball']['sha256']==p['archive_sha256']
        and record['package']['integrity']==p['registry_sri_sha512'] and record['existing_lock_package_roots_unchanged']==102
        and record['package_roots_added']==0 and record['vendorSignatureVerified'] is False,'pdfjs_103rd_evidence_binding')
    item=stack.enter_context(Pinned(Path(p['archive_path']),p['archive_sha256'],p['archive_bytes'],p['registry_sri_sha512']));inputs.append(item)
    value=scan(item.fp,'vendor','package')
    evidence['package.tgz']={'kind':p['kind'],'separate_from_102_installed_roots':True,'archive_sha256':p['archive_sha256'],
        'registry_sri_sha512':p['registry_sri_sha512'],'archive_members':value['members'],'unpacked_bytes':value['unpacked_bytes'],
        'member_inventory':value['entries'],'inventory_sha256':hashlib.sha256(canonical(value['entries'])).hexdigest()}
    for item in inputs:item.check(rehash=True)
    return evidence,inputs
