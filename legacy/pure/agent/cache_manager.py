"""Audit pinned content, reuse caches, and place individual files across storage tiers.

No model is trusted by name alone. User files are never removed to free space.
A verification receipt is reusable only during the same installation and while
its device/inode/size/mtime/ctime signature is unchanged.
"""
import argparse,errno,hashlib,json,os,re,shutil,stat,time,uuid
from pathlib import Path
from download_sources import rank_sources,fetch,StorageFullError
from storage_platform import persistence_root,drive_mounts,drive_mount_for,scan_redirect,logical_bytes,local_model_path

GIB=2**30
ROOT=Path(__file__).resolve().parent
SKIP={'.git','node_modules','__pycache__','site-packages','dist-packages','venv','.venv','envs','pkgs','proc','sys','dev','.Trash','Trash','logs','outputs','downloads-temp','.ssh','.aws','.gnupg','.kube','secrets','DriveFS'}
RUN=os.getenv('FUMIAO_INSTALL_RUN') or uuid.uuid4().hex


def atomic_json(path,value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp');tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2));tmp.replace(path)


def signature(path):
    s=Path(path).stat()
    if not stat.S_ISREG(s.st_mode):raise OSError('not a regular file')
    return [s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns]


def verify(path,entry,receipts=None,progress=lambda _:None):
    path=Path(path)
    try:
        before=signature(path)
        if before[2]!=entry['bytes']:return False
        key=str(path.resolve());saved=(receipts or {}).get(key)
        if saved and saved.get('run')==RUN and saved.get('signature')==before:
            return saved.get('sha256')==entry['sha256']
        progress('校验 '+path.name)
        h=hashlib.sha256();done=0;last=time.monotonic()
        with path.open('rb') as source:
            while data:=source.read(16*1024**2):
                h.update(data);done+=len(data)
                if time.monotonic()-last>=3:progress(f'校验 {path.name} {done*100//max(1,entry["bytes"])}%');last=time.monotonic()
        if signature(path)!=before:return False
        actual=h.hexdigest()
        if receipts is not None:receipts[key]={'run':RUN,'signature':before,'sha256':actual}
        return actual==entry['sha256']
    except OSError:return False


def entries_for(selected,root=ROOT):
    from node_models import GPU_MODELS
    paths={m:next((p for p in (root/GPU_MODELS[m]['manifest'],root/'vendor'/GPU_MODELS[m]['manifest']) if p.exists()),root/GPU_MODELS[m]['manifest']) for m in selected}
    result=[]
    for model in selected:
        for entry in json.loads(paths[model].read_text())['files']:
            relative=Path(entry['path'])
            if relative.is_absolute() or '..' in relative.parts or any(ord(c)<32 for c in entry['path']) or type(entry.get('bytes')) is not int or entry['bytes']<0 or not re.fullmatch('[a-f0-9]{64}',entry.get('sha256','')):raise RuntimeError('模型文件清单无效')
            if entry.get('requires_env') and os.getenv(entry['requires_env'])!='1':continue
            result.append({'model':model,'entry':entry})
    return result


def root_paths(worker_root=ROOT):
    explicit=[Path(p).expanduser() for p in os.getenv('FUMIAO_SEARCH_ROOTS','').split(os.pathsep) if p]
    priority=[p.resolve() for p in explicit if p.is_dir()]
    roots=explicit+[worker_root,Path('/mnt'),Path('/data'),Path('/opt'),Path('/content'),Path('/workspace'),Path('/models'),Path('/scratch'),Path.home()]
    try:
        for line in Path('/proc/self/mountinfo').read_text().splitlines():
            left,right=line.split(' - ',1);mount=Path(left.split()[4].replace('\\040',' '))
            if mount!=Path('/') and not any(mount==p or p in mount.parents for p in map(Path,('/proc','/sys','/dev','/etc','/run','/usr','/boot'))) and right.split()[0] not in ('proc','sysfs','tmpfs','devtmpfs','cgroup','cgroup2'):roots.append(mount)
    except (OSError,ValueError,IndexError):pass
    for name in ('H3_CACHE','BREEZE_HOME','HF_HOME','HF_HUB_CACHE','HUGGINGFACE_HUB_CACHE','MODELSCOPE_CACHE','XDG_CACHE_HOME','FUMIAO_CACHE_ROOT'):
        if os.getenv(name):
            path=Path(os.environ[name]).expanduser();roots.append(path)
            if path.is_dir():priority.append(path.resolve())
    unique=[]
    for p in roots:
        if p.exists() and p.is_dir():
            p=p.resolve()
            if p not in unique:unique.append(p)
    return [p for p in unique if p in priority or not any(other!=p and other in p.parents for other in unique)]


def persistence():
    return persistence_root()


def persistent_path(path,persistent):
    """Use the persistent spelling for bind-mounted aliases of the same file."""
    path=Path(path).resolve()
    if not persistent:return path
    persistent=Path(persistent)
    if path.is_relative_to(persistent):return path
    for parent in path.parents:
        try:
            if parent.samefile(persistent):
                canonical=persistent/path.relative_to(parent)
                if canonical.samefile(path):return canonical
        except OSError:continue
    return path


def scan(items,roots,progress=lambda _:None,persistent=None):
    by_size={};by_name={};by_sha={}
    for item in items:
        entry=item['entry'];by_size.setdefault(entry['bytes'],[]).append(entry);by_name.setdefault(Path(entry['path']).name,[]).append(entry);by_sha[entry['sha256']]=entry
    candidates={sha:[] for sha in by_sha};partials={sha:[] for sha in by_sha};warnings=[];seen_dirs=set();seen_files=set();persistent_bytes=0;receipts={};source_dirs=[];archives=[];count=0
    stack=list(roots);mounts=drive_mounts()
    extra=[Path(p).expanduser() for p in os.getenv('FUMIAO_SEARCH_ROOTS','').split(os.pathsep) if p]
    while stack:
        folder=stack.pop()
        redirected=scan_redirect(folder,persistent,mounts,extra)
        if redirected is not None:
            stack.extend(redirected);continue
        try:
            token=(folder.stat().st_dev,folder.stat().st_ino)
            if token in seen_dirs:continue
            seen_dirs.add(token)
            with os.scandir(folder) as iterator:
                for e in iterator:
                    p=Path(e.path)
                    try:
                        if e.is_dir(follow_symlinks=True):
                            if e.is_symlink():
                                real=p.resolve()
                                if real==Path('/') or any(real==x or x in real.parents for x in map(Path,('/proc','/sys','/dev','/etc','/run','/usr','/boot'))):continue
                            if e.name=='.git' and (p/'lfs/objects').is_dir():stack.append(p/'lfs/objects')
                            if e.name in ('ComfyUI','breeze-tts') or (e.name=='source' and (p/'breeze_infer').is_dir()):source_dirs.append(str(p.resolve()))
                            if e.name not in SKIP:stack.append(p)
                            # Count skipped trees for quota separately with du; never import their code here.
                            continue
                        if not e.is_file(follow_symlinks=True):continue
                        s=e.stat(follow_symlinks=True);count+=1
                        if p.suffix in ('.tgz','.gz','.zip') and s.st_size<256*1024**2:archives.append(str(p))
                        matches=by_size.get(s.st_size,[])
                        for entry in matches:candidates[entry['sha256']].append(str(persistent_path(p,persistent)))
                        name=e.name
                        if name.endswith(('.partial','.incomplete','.part')) or '._____temp' in p.parts:
                            raw=name.rsplit('.',1)[0] if name.endswith(('.partial','.incomplete','.part')) else name
                            digest_name=raw if raw in by_sha else raw[:64] if raw[:64] in by_sha and raw[64:65]=='-' else None
                            possible=([by_sha[digest_name]] if digest_name else by_name.get(raw,[]))
                            for entry in possible:
                                if 0<s.st_size<=entry['bytes']:
                                    # Generic shard names are only resumable inside this model's known cache.
                                    if digest_name or raw.startswith('minimax_') or 'qwen3vl_32b_minimax' in raw or any(x in str(p).lower() for x in ('breeze','fumiao')):partials[entry['sha256']].append(str(persistent_path(p,persistent)))
                    except OSError as exc:warnings.append(str(p)+': '+str(exc))
        except OSError as exc:warnings.append(str(folder)+': '+str(exc))
        if len(seen_dirs)%300==0:progress(f'扫描缓存：{len(seen_dirs)} 个目录、{count} 个文件')
    verified={}
    for sha,paths in candidates.items():
        paths=sorted(set(paths),key=lambda s:(not (persistent and Path(s).resolve().is_relative_to(persistent)),len(s)))
        checked=set()
        for name in paths:
            try:token=tuple(signature(name)[:2])
            except OSError:continue
            if token in checked:continue
            checked.add(token)
            if verify(name,by_sha[sha],receipts,progress):verified.setdefault(sha,[]).append(str(Path(name).resolve()))
    return {'roots':[str(p) for p in roots],'directories':len(seen_dirs),'files_scanned':count,'verified':verified,'partials':partials,'receipts':receipts,'warnings':warnings,'source_dirs':source_dirs,'archives':archives}


def nearest(path):
    path=Path(path)
    while not path.exists() and path!=path.parent:path=path.parent
    return path


def disk_id(path):return str(nearest(path).stat().st_dev)


def allocated_bytes(path):
    # Include hidden/user/runtime directories when estimating a platform quota.
    import subprocess
    result=subprocess.run(['du','-s','-x','-B1',str(path)],capture_output=True,text=True,timeout=120)
    if result.returncode:raise RuntimeError('无法完整核对持久化目录占用：'+result.stderr[:200])
    return int(result.stdout.split()[0])


def ram_disk(path):
    try:
        target=str(nearest(path).resolve());matches=[]
        for line in Path('/proc/self/mountinfo').read_text().splitlines():
            left,right=line.split(' - ',1);mount=left.split()[4].replace('\\040',' ')
            if target==mount or target.startswith(mount.rstrip('/')+'/'):matches.append((len(mount),right.split()[0]))
        return bool(matches and max(matches)[1] in ('tmpfs','ramfs','proc','sysfs','devtmpfs'))
    except (OSError,ValueError,IndexError):return False


def writable(path):
    base=nearest(path)
    return base.is_dir() and os.access(base,os.W_OK)


def best_fit(items,budget):
    """Whole-file subset selection; avoid leaving half a persistent disk unused."""
    states={0:[]}
    for key,size in items:
        for used,chosen in list(states.items()):
            if used+size<=budget:states.setdefault(used+size,chosen+[key])
        if len(states)>8192:
            # Bounded optimization for future manifests with hundreds of shards.
            keys=sorted(states);keep={0,*keys[-4096:],*keys[::max(1,len(keys)//4096)]};states={k:states[k] for k in keep}
    return set(states[max(states)])


def layout(items,audit,persistent,temporary,logical_roots,runtime_reserve=0,quota_bytes=None,reserve_bytes=2*GIB,free_override=None,usage_override=None,runtime_root=None):
    runtime_root=runtime_root or temporary[0]
    roots=[r for r in [persistent,runtime_root,*temporary] if r is not None and writable(r)]
    if not roots:raise RuntimeError('没有可写的模型存储目录')
    free={disk_id(r):(free_override or {}).get(str(r),shutil.disk_usage(nearest(r)).free) for r in roots}
    temp=[r for r in temporary if writable(r)]
    if not temp:raise RuntimeError('没有可写的运行环境目录')
    runtime_device=disk_id(runtime_root);free[runtime_device]-=runtime_reserve
    if free[runtime_device]<reserve_bytes:raise RuntimeError('运行环境所在磁盘空间不足；已有模型不会被删除')
    persist_available=0;quota_warning=''
    if persistent:
        if quota_bytes is None:
            configured=os.getenv('FUMIAO_PERSIST_QUOTA_BYTES')
            if configured is not None:
                try:quota_bytes=int(configured)
                except ValueError:raise RuntimeError('持久缓存额度必须是非负整数（字节）') from None
                if quota_bytes<0:raise RuntimeError('持久缓存额度不能为负数')
            elif str(persistent)=='/mnt/workspace':quota_bytes=100000000000
        try:used=usage_override if usage_override is not None else (logical_bytes(persistent) if drive_mount_for(persistent) else allocated_bytes(persistent)) if quota_bytes is not None else 0
        except (OSError,RuntimeError,ValueError) as exc:used=quota_bytes or 0;quota_warning=str(exc)
        quota_runtime=runtime_reserve if Path(runtime_root).is_relative_to(persistent) else 0
        if drive_mount_for(persistent) and quota_bytes is not None:
            # DriveFS statvfs is bounded by its local staging disk, not the
            # user's cloud quota. Writes still handle real ENOSPC explicitly.
            persist_available=max(0,quota_bytes-used-reserve_bytes-quota_runtime)
        else:
            persist_available=max(0,min(free[disk_id(persistent)]-reserve_bytes,quota_bytes-used-reserve_bytes-quota_runtime if quota_bytes is not None else float('inf')))
    files=[];unique={}
    for item in items:
        entry=item['entry'];sha=entry['sha256'];known=audit['verified'].get(sha,[])
        persistent_copy=next((p for p in known if persistent and Path(p).is_relative_to(persistent)),None)
        unique.setdefault(sha,{'entry':entry,'source':persistent_copy or (known[0] if known else None),'persistent':persistent_copy,'models':[]})['models'].append(item['model'])
    candidates={k:v for k,v in unique.items() if not v['persistent']}
    # Keep the small speech model complete when possible, then maximize retained H3 bytes.
    def persist_cost(k,v):
        if not persistent:return v['entry']['bytes']
        target=persistent/'.fumiao/models'/k[:2]/(k+'-'+Path(v['entry']['path']).name)
        partial=target.with_name(target.name+'.partial')
        try:offset=min(v['entry']['bytes'],partial.stat().st_size) if partial.is_file() else 0
        except OSError:offset=0
        return v['entry']['bytes']-offset
    from node_models import GPU_MODELS
    speech=[(k,persist_cost(k,v)) for k,v in candidates.items() if any(GPU_MODELS[m].get('persistence_priority',0)>0 for m in v['models'])]
    chosen=best_fit(speech,persist_available) if persistent else set();remaining=persist_available-sum(persist_cost(k,unique[k]) for k in chosen)
    chosen|=best_fit([(k,persist_cost(k,v)) for k,v in candidates.items() if k not in chosen],remaining) if persistent else set()
    target_map={}
    for sha,value in unique.items():
        entry=value['entry'];size=entry['bytes'];source=value['source']
        partials=sorted(audit['partials'].get(sha,[]),key=lambda p:Path(p).stat().st_size,reverse=True)
        if value['persistent']:target=Path(value['persistent']);tier='persistent';additional=0
        elif sha in chosen:
            target=persistent/'.fumiao/models'/sha[:2]/(sha+'-'+Path(entry['path']).name);tier='persistent';additional=persist_cost(sha,value)
        elif source:target=Path(source);tier='existing';additional=0
        else:
            def temp_cost(r):
                part=r/'fumiao-models'/sha[:2]/(sha+'-'+Path(entry['path']).name+'.partial')
                return size-min(size,part.stat().st_size) if part.is_file() else size
            root=next((r for r in temp if free[disk_id(r)]-reserve_bytes>=temp_cost(r)),None)
            if root is None:raise RuntimeError(f'缺少 {size/GIB:.1f} GiB 可用空间用于 {Path(entry["path"]).name}；请增加磁盘或清理不需要的文件，现有文件已保留')
            target=root/'fumiao-models'/sha[:2]/(sha+'-'+Path(entry['path']).name);tier='temporary';additional=temp_cost(root)
        if additional:free[disk_id(target)]-=additional
        target_map[sha]={'target':str(target),'source':source,'tier':tier,'partial':partials[0] if partials else None,'download_bytes':0 if source else max(0,size-(Path(partials[0]).stat().st_size if partials else 0))}
    for item in items:
        entry=item['entry'];files.append({**item,**target_map[entry['sha256']], 'logical':str(Path(logical_roots[item['model']])/entry['path'])})
    return {'version':1,'run':RUN,'persistent':str(persistent) if persistent else None,'temporary':[str(r) for r in temp], 'quota_bytes':quota_bytes,'quota_warning':quota_warning,'reserve_bytes':reserve_bytes,'runtime_reserve':runtime_reserve,'files':files,'audit':audit}


def make_plan(selected,worker_root=ROOT,progress=print,runtime_reserve=0,requested_paths=None):
    persistent=persistence();roots=root_paths(worker_root)
    if persistent and drive_mount_for(persistent) and not os.getenv('FUMIAO_PERSIST_QUOTA_BYTES'):
        raise RuntimeError('请在 Colab 接入笔记本设置 Drive 缓存上限，或用 FUMIAO_PERSIST_QUOTA_BYTES 指定不超过实际剩余容量的字节数')
    if persistent and persistent not in roots and not any(p in persistent.parents for p in roots):roots.append(persistent)
    cache=Path(os.getenv('FUMIAO_CACHE_ROOT','/opt'))
    temporary=[Path(v).expanduser() for v in os.getenv('FUMIAO_TEMP_ROOTS','').split(os.pathsep) if v]+[cache,Path('/mnt/data'),Path('/data'),Path('/tmp'),Path.home()/'.cache/fumiao']
    # A fallback must be outside the persistent quota, and may not be a RAM disk.
    temporary=[p for p in temporary if not (persistent and (p==persistent or persistent in p.parents)) and writable(p) and not ram_disk(p)]
    temporary=list(dict.fromkeys(p.resolve() for p in temporary))
    items=entries_for(selected,worker_root)
    if requested_paths is not None:items=[i for i in items if i['entry']['path'] in requested_paths.get(i['model'],set())]
    if not items:raise RuntimeError('没有匹配的模型文件')
    audit=scan(items,roots,progress,persistent)
    from node_models import GPU_MODELS
    logical={m:Path(os.getenv(GPU_MODELS[m]['cache_env'],str(cache/GPU_MODELS[m]['cache_dir'])))/GPU_MODELS[m]['model_subdir'] for m in selected}
    if not temporary:raise RuntimeError('未找到持久目录之外的可写磁盘，请设置 FUMIAO_TEMP_ROOTS')
    plan=layout(items,audit,persistent,temporary,logical,runtime_reserve,runtime_root=cache)
    plan['model_network_fetches']=[]
    if persistent and drive_mount_for(persistent):
        plan['drive_cache']=True
        plan['local_cache']=str(cache)
        # Execution copies remain on local storage; only immutable weights go to Drive.
        unique={i['entry']['sha256']:i['entry'] for i in plan['files'] if i['tier']=='persistent'}
        needed=sum(e['bytes'] for sha,e in unique.items() if not any(not drive_mount_for(p) for p in audit['verified'].get(sha,[])))
        if shutil.disk_usage(nearest(cache)).free<needed+runtime_reserve+plan['reserve_bytes']:
            raise RuntimeError('本地磁盘不足以恢复所选模型，请增加本地空间或减少模型；Drive 缓存保持不变')
        progress('Google Drive 保存模型；本地磁盘用于加载和推理')
    path=worker_root/'state/storage-plan.json';atomic_json(path,plan)
    reused=sum(e['entry']['bytes'] for e in plan['files'] if e['source']);needed=sum(e['download_bytes'] for e in plan['files']);persist=sum(e['entry']['bytes'] for e in plan['files'] if e['tier']=='persistent')
    progress(f'检查完成：可复用 {reused/1e9:.2f} GB，需下载 {needed/1e9:.2f} GB；本次计划持久保存 {persist/1e9:.2f} GB')
    if plan.get('quota_warning'):progress('无法确认持久目录配额，缺失文件将使用临时磁盘：'+plan['quota_warning'])
    if audit['warnings']:progress(f'有 {len(audit["warnings"])} 处目录或文件无法读取，详见 {path}')
    if persistent:progress('持久目录：'+str(persistent)+'；超出容量的文件放入临时磁盘，重启仅补缺失部分')
    return plan


def relocate_in_plan(plan,old,new):
    old,new=Path(old),Path(new)
    def move(value):
        if not value:return value
        path=Path(value)
        return str(new/path.relative_to(old)) if path==old or old in path.parents else value
    for item in plan.get('files',[]):
        for key in ('target','source','partial'):item[key]=move(item.get(key))
    audit=plan.get('audit',{})
    for key in ('verified','partials'):
        audit[key]={digest:[move(p) for p in paths] for digest,paths in audit.get(key,{}).items()}
    records=audit.setdefault('receipts',{});moved={move(path):value for path,value in records.items()};records.clear();records.update(moved)
    for key in ('source_dirs','archives'):audit[key]=[move(p) for p in audit.get(key,[])]


def relocate_prefix(old,new,root=ROOT):
    plan=load_plan(root)
    if plan:relocate_in_plan(plan,old,new);atomic_json(root/'state/storage-plan.json',plan)


def quarantine(path,progress,plan=None):
    path=Path(path)
    if path.exists() or path.is_symlink():
        dest=path.with_name(path.name+'.invalid-'+str(int(time.time()))+'-'+uuid.uuid4().hex[:6]);path.rename(dest)
        if plan is not None:relocate_in_plan(plan,path,dest)
        progress('保留异常缓存：'+str(dest))


def certify(path,entry,receipts):
    receipts[str(Path(path).resolve())]={'run':RUN,'signature':signature(path),'sha256':entry['sha256']}


def copy_verified(source,target,entry,receipts,progress,cancel=lambda:False,message='保存到持久空间'):
    source=Path(source);target=Path(target)
    if source.resolve()==target.resolve():return
    target.parent.mkdir(parents=True,exist_ok=True)
    partial=target.with_name(target.name+'.partial')
    offset=0
    if partial.exists():
        # A network filesystem copy can stop midway. Reuse only an exact prefix.
        offset=partial.stat().st_size
        matches=offset<=entry['bytes']
        if matches:
            with source.open('rb') as src,partial.open('rb') as old:
                while block:=old.read(8*1024**2):
                    if cancel():raise InterruptedError('安装已停止')
                    if src.read(len(block))!=block:matches=False;break
        if not matches:quarantine(partial,progress);offset=0
    try:
        with source.open('rb') as src,partial.open('ab' if offset else 'wb') as dst:
            src.seek(offset);copied=offset;last=time.monotonic()
            while data:=src.read(8*1024**2):
                if cancel():raise InterruptedError('安装已停止')
                dst.write(data);copied+=len(data)
                if time.monotonic()-last>2:progress(f'{message} {source.name} {copied*100//entry["bytes"]}%');last=time.monotonic()
            dst.flush();os.fsync(dst.fileno())
        if not verify(partial,entry,receipts,progress):raise RuntimeError('缓存复制后校验失败：'+source.name)
        partial.replace(target);certify(target,entry,receipts)
    except OSError as exc:
        if exc.errno in (errno.ENOSPC,errno.EDQUOT):raise StorageFullError(str(target)) from exc
        raise


def link_file(target,logical,entry,receipts,progress,plan=None):
    target=Path(target);logical=Path(logical)
    if target.resolve()==logical.resolve() or verify(logical,entry,receipts,progress):return
    logical.parent.mkdir(parents=True,exist_ok=True)
    if logical.exists() or logical.is_symlink():quarantine(logical,progress,plan)
    tmp=logical.with_name(logical.name+'.link-'+uuid.uuid4().hex);tmp.symlink_to(target);tmp.replace(logical)


def load_plan(root=ROOT):
    try:return json.loads((root/'state/storage-plan.json').read_text())
    except (OSError,ValueError):return None


def fetch_tracked(entry,target,ranking,progress,cancel,plan,root):
    plan.setdefault('model_network_fetches',[]).append(entry['sha256'])
    atomic_json(root/'state/storage-plan.json',plan)
    return fetch(entry,target,ranking,progress,cancel)


def ensure_model(model,progress=print,cancel=lambda:False,root=ROOT,paths=None):
    plan=load_plan(root)
    if not plan or plan.get('run')!=RUN or not any(i['model']==model for i in plan['files']):plan=make_plan([model],root,progress,requested_paths={model:set(paths)} if paths is not None else None)
    records=plan['audit']['receipts'];selected=[i for i in plan['files'] if i['model']==model and (paths is None or i['entry']['path'] in paths)];ranking=None
    for item in selected:
        if cancel():raise RuntimeError('安装已停止')
        entry=item['entry'];target=Path(item['target']);source=item['source']
        if plan.get('drive_cache') and item['tier']=='persistent':
            sources=plan['audit']['verified'].get(entry['sha256'],[])
            native=next((Path(p) for p in sources if not drive_mount_for(p) and verify(p,entry,records,progress)),None)
            local=native or local_model_path(entry,plan['local_cache'])
            if not verify(local,entry,records,progress):
                if local.exists() or local.is_symlink():quarantine(local,progress,plan)
                available=next((Path(p) for p in sources if verify(p,entry,records,progress)),None)
                if available is not None:
                    copy_verified(available,local,entry,records,progress,cancel,'恢复到本地磁盘')
                elif verify(target,entry,records,progress):
                    copy_verified(target,local,entry,records,progress,cancel,'恢复到本地磁盘')
                else:
                    if ranking is None:ranking=rank_sources([i['entry'] for i in selected],root/'state/download-sources.json',progress)
                    fetch_tracked(entry,local,ranking,progress,cancel,plan,root);certify(local,entry,records)
            if not verify(target,entry,records,progress):
                if target.exists() or target.is_symlink():quarantine(target,progress,plan)
                try:copy_verified(local,target,entry,records,progress,cancel)
                except StorageFullError:
                    item.update(persistence_error='Drive 空间不足',persistent_target=str(target),tier='temporary',target=str(local))
                    target=local
                    progress('Drive 空间不足，此模型仅保留在本地：'+entry['path'])
            link_file(local,item['logical'],entry,records,progress,plan)
            item.update(target=str(target),source=str(target),execution_path=str(local),download_bytes=0)
            atomic_json(root/'state/storage-plan.json',plan)
            progress(('已校验 Drive 与本地缓存：' if item['tier']=='persistent' else '已校验本地缓存：')+entry['path'])
            continue
        if not verify(target,entry,records,progress):
            if target.exists() or target.is_symlink():
                quarantine(target,progress,plan)
                for related in plan['files']:
                    if related['entry']['sha256']==entry['sha256']:related['target']=str(target)
            try:
                if source and verify(source,entry,records,progress):copy_verified(source,target,entry,records,progress,cancel)
                else:
                    target.parent.mkdir(parents=True,exist_ok=True)
                    partial=target.with_name(target.name+'.partial');previous=Path(item['partial']) if item['partial'] else None
                    if previous and previous.exists() and previous!=partial and not partial.exists():
                        if previous.stat().st_size<=entry['bytes']:shutil.copyfile(previous,partial)
                    if ranking is None:ranking=rank_sources([i['entry'] for i in selected if not i['source']] or [entry],root/'state/download-sources.json',progress)
                    fetch_tracked(entry,target,ranking,progress,cancel,plan,root);certify(target,entry,records)
            except (StorageFullError,OSError) as exc:
                if not isinstance(exc,StorageFullError) and getattr(exc,'errno',None) not in (errno.ENOSPC,errno.EDQUOT):raise
                fallback=next((Path(p) for p in plan['temporary'] if disk_id(p)!=disk_id(target) and shutil.disk_usage(nearest(p)).free>=entry['bytes']+plan['reserve_bytes']),None)
                # Quota can be exhausted even when two mounts report one filesystem id.
                if fallback is None:fallback=next((Path(p) for p in plan['temporary'] if not Path(p).is_relative_to(Path(plan['persistent'] or '/nonexistent')) and shutil.disk_usage(nearest(p)).free>=entry['bytes']+plan['reserve_bytes']),None)
                if fallback is None:raise RuntimeError('存储空间或配额不足，已保留断点；请增加可用空间后重试') from exc
                old=target;target=fallback/'fumiao-models'/entry['sha256'][:2]/(entry['sha256']+'-'+Path(entry['path']).name);target.parent.mkdir(parents=True,exist_ok=True)
                progress('持久空间不足，改用临时磁盘：'+str(target.parent))
                old_partial=old.with_name(old.name+'.partial');new_partial=target.with_name(target.name+'.partial')
                if source and verify(source,entry,records,progress):
                    # Reuse the original verified temporary file instead of making another copy.
                    target=Path(source)
                else:
                    if old_partial.exists() and not new_partial.exists():shutil.copyfile(old_partial,new_partial)
                    if ranking is None:ranking=rank_sources([entry],root/'state/download-sources.json',progress)
                    fetch_tracked(entry,target,ranking,progress,cancel,plan,root);certify(target,entry,records)
                for related in plan['files']:
                    if related['entry']['sha256']==entry['sha256']:related.update(target=str(target),tier='temporary')
        if not verify(target,entry,records,progress):raise RuntimeError('模型校验未通过：'+target.name)
        link_file(target,item['logical'],entry,records,progress,plan)
        item.update(target=str(target),source=str(target),download_bytes=0)
        atomic_json(root/'state/storage-plan.json',plan)
        progress('已复用并验证：'+entry['path'])
    return plan


def artifact_candidates(root=ROOT):
    plan=load_plan(root)
    return (plan or {}).get('audit',{}).get('archives',[]),(plan or {}).get('audit',{}).get('source_dirs',[])


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--models',required=True);parser.add_argument('--root',type=Path,default=ROOT)
    mode=parser.add_mutually_exclusive_group();mode.add_argument('--audit-only',action='store_true');mode.add_argument('--sync-only',action='store_true');args=parser.parse_args()
    from node_models import GPU_MODELS
    mapping={v['slug']:k for k,v in GPU_MODELS.items()};selected=[mapping[s] for s in args.models.split(',')]
    if args.audit_only:
        root=args.root;items=entries_for(selected,ROOT);audit=scan(items,root_paths(root),print,persistence());atomic_json(root/'state/cache-audit.json',audit);print('只检查，不更改服务、环境或模型文件。')
    elif args.sync_only:
        import fcntl
        state=args.root/'state';state.mkdir(parents=True,exist_ok=True)
        with (state/'install.lock').open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            make_plan(selected,args.root)
            for model in selected:ensure_model(model,root=args.root)
            plan=load_plan(args.root)
            print('FUMIAO_CACHE_SYNC '+json.dumps({'persistent_files':sum(f['tier']=='persistent' for f in plan['files']),'files':len(plan['files']),'model_network_fetches':len(plan.get('model_network_fetches',[]))}))
    else:make_plan(selected,args.root)
