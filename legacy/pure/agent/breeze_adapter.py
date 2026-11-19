"""Breeze TTS adapter: pinned assets, isolated runtime, loopback service and WAV output."""
import hashlib,json,os,shutil,signal,subprocess,sys,tarfile,time,urllib.parse,urllib.request,wave
from pathlib import Path
from hardware_probe import kernel_probe,runtime_compatible
from download_sources import valid,rank_sources,fetch as fetch_model
from cache_manager import ensure_model,artifact_candidates
from runtime_cache import isolate,dependencies_ready,BREEZE_REQUIREMENTS

ROOT=Path(__file__).resolve().parent
HOME=Path(os.getenv('BREEZE_HOME','/opt/fumiao-breeze'))
PORT=int(os.getenv('BREEZE_PORT','18389'))
LOCK=json.loads((ROOT/'breeze.lock.json').read_text())
PYTHON=HOME/'venv/bin/python'
SOURCE=ROOT/'state/sources'/('breeze-'+LOCK['source_revision'])
URL=f'http://127.0.0.1:{PORT}'


def run(command,cancel=lambda:False,**kwargs):
    p=subprocess.Popen(command,**kwargs)
    while p.poll() is None:
        if cancel():p.terminate();p.wait(timeout=15);raise RuntimeError('实例已停止')
        time.sleep(.5)
    if p.returncode:raise RuntimeError('运行环境准备失败，请查看 worker.log')


def fetch(url,path,progress,cancel,size=None):
    path.parent.mkdir(parents=True,exist_ok=True);partial=path.with_name(path.name+'.partial')
    args=['curl','-q','-fL','--retry','2','--connect-timeout','12','--max-time','1800','-C','-',url,'-o',str(partial)]
    with (HOME/'download.log').open('ab') as log:
        p=subprocess.Popen(args,stdout=log,stderr=log)
        while p.poll() is None:
            if cancel():p.terminate();p.wait(timeout=15);raise RuntimeError('实例已停止')
            done=partial.stat().st_size if partial.exists() else 0
            progress(f"下载 Breeze {path.name}：{done/1e9:.2f}"+(f"/{size/1e9:.2f} GB" if size else ' GB'))
            time.sleep(2)
        if p.returncode:raise RuntimeError('下载失败：'+path.name)
    partial.replace(path)


def prepare(progress,cancel=lambda:False,device=0,base_python=None,backend='cuda'):
    HOME.mkdir(parents=True,exist_ok=True);base_python=base_python or sys.executable
    progress('检查 Breeze GPU 运算能力')
    platform_ok=True
    try:platform_ok=runtime_compatible(kernel_probe(base_python,device),backend)
    except (OSError,RuntimeError,subprocess.SubprocessError):platform_ok=False
    isolate(HOME,base_python,backend,device,platform_ok,progress=progress,wanted=BREEZE_REQUIREMENTS,imports=('torch','transformers','qwen_tts','soundfile'))
    try:runtime_ok=runtime_compatible(kernel_probe(str(PYTHON),device),backend)
    except (OSError,RuntimeError,subprocess.SubprocessError):runtime_ok=False
    if not runtime_ok:
        progress('安装 '+('ROCm' if backend=='rocm' else 'CUDA')+' PyTorch 运行环境')
        index='rocm6.4' if backend=='rocm' else 'cu126'
        run([str(PYTHON),'-m','pip','install','torch==2.9.1','torchaudio==2.9.1','torchvision==0.24.1','--index-url','https://download.pytorch.org/whl/'+index],cancel)
    profile=kernel_probe(str(PYTHON),device)
    constraints=HOME/'platform-constraints.txt'
    probe="from importlib.metadata import version,PackageNotFoundError\nfor p in ('torch','torchaudio','torchvision'):\n try: print(p+'=='+version(p))\n except PackageNotFoundError: pass"
    constraints.write_text(subprocess.check_output([str(PYTHON),'-c',probe],text=True))
    if dependencies_ready(PYTHON,BREEZE_REQUIREMENTS,('torch','transformers','qwen_tts','soundfile')):progress('沿用已验证的 Breeze Python 依赖')
    else:
        progress('补齐隔离的 Breeze Python 依赖')
        from package_sources import install
        install(PYTHON,['-c',str(constraints),*BREEZE_REQUIREMENTS],cancel,progress)
    source=SOURCE;receipt=source.parent/(source.name+'.sha256.json');source.parent.mkdir(parents=True,exist_ok=True)
    if not source.exists():
        _,candidates=artifact_candidates()
        for old in [HOME/'source',*[Path(p) for p in candidates]]:
            if not (old/'.git').is_dir():continue
            head=subprocess.run(['git','-C',str(old),'rev-parse','HEAD'],capture_output=True,text=True)
            if head.returncode==0 and head.stdout.strip()==LOCK['source_revision'] and subprocess.run(['git','-C',str(old),'diff','--quiet','HEAD']).returncode==0:
                run(['git','clone','--no-hardlinks',str(old),str(source)],cancel);break
    matches=False
    if (source/'.git').is_dir():
        head=subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip()
        matches=head==LOCK['source_revision'] and subprocess.run(['git','-C',str(source),'diff','--quiet','HEAD']).returncode==0
    elif receipt.is_file():
        saved=json.loads(receipt.read_text());saved=saved.get('files',{}) if saved.get('revision')==LOCK['source_revision'] else {}
        matches=bool(saved) and (source/'breeze_infer/api.py').is_file() and all((source/name).is_file() and hashlib.sha256((source/name).read_bytes()).hexdigest()==sha for name,sha in saved.items())
    if not matches:
        progress('下载固定版本的 Breeze 推理代码')
        archive=ROOT/'state/packages'/('breeze-'+LOCK['source_revision']+'.tgz');archive.parent.mkdir(parents=True,exist_ok=True)
        if not archive.is_file():
            archives,_=artifact_candidates()
            for old in [HOME/'source.tgz',*[Path(p) for p in archives]]:
                if old.is_file() and hashlib.sha256(old.read_bytes()).hexdigest()==LOCK['source_sha256']:
                    shutil.copy2(old,archive);break
        if not archive.is_file() or hashlib.sha256(archive.read_bytes()).hexdigest()!=LOCK['source_sha256']:fetch(LOCK['source_url'],archive,progress,cancel)
        if hashlib.sha256(archive.read_bytes()).hexdigest()!=LOCK['source_sha256']:raise RuntimeError('Breeze 推理代码校验失败')
        staged=source.with_name(source.name+'.staging');shutil.rmtree(staged,ignore_errors=True);staged.mkdir()
        with tarfile.open(archive) as package:
            for member in package.getmembers():
                parts=Path(member.name).parts
                if len(parts)<2:continue
                if '..' in parts or member.name.startswith('/') or not (member.isdir() or member.isfile()):raise RuntimeError('源码包路径无效')
                target=staged.joinpath(*parts[1:]);target.parent.mkdir(parents=True,exist_ok=True)
                if member.isdir():target.mkdir(exist_ok=True)
                else:
                    with package.extractfile(member) as incoming,target.open('wb') as out:shutil.copyfileobj(incoming,out)
        if source.exists():
            previous=source.with_name(source.name+'.previous-'+str(time.time_ns()));source.rename(previous)
            from cache_manager import relocate_prefix
            relocate_prefix(source,previous)
        staged.rename(source)
    hashes={str(p.relative_to(source)):hashlib.sha256(p.read_bytes()).hexdigest() for p in source.rglob('*') if p.is_file() and '.git' not in p.parts and '__pycache__' not in p.parts}
    receipt.write_text(json.dumps({'revision':LOCK['source_revision'],'files':hashes}))
    ensure_model('breeze-tts-2',progress,cancel)
    return profile


def service_record():
    try:
        r=json.loads((HOME/'service.json').read_text())
        fields=Path(f"/proc/{r['pid']}/stat").read_text().rsplit(')',1)[1].split()
        if fields[0] in ('Z','X'):return None
        started=fields[19]
        if started==r['started'] and r['boot']==Path('/proc/sys/kernel/random/boot_id').read_text().strip():return r
    except (OSError,ValueError,KeyError,IndexError):pass
    return None


def stop_service():
    record=service_record()
    if not record:return
    try:os.killpg(record['pid'],signal.SIGTERM)
    except ProcessLookupError:return
    for _ in range(30):
        if not service_record():break
        time.sleep(.3)
    else:
        try:os.killpg(record['pid'],signal.SIGKILL)
        except ProcessLookupError:pass
    try:os.waitpid(record['pid'],os.WNOHANG)
    except ChildProcessError:pass
    (HOME/'service.json').unlink(missing_ok=True)


def ensure_service(progress=lambda _:None,cancel=lambda:False,device=0):
    budget=float(os.getenv('BREEZE_VRAM_BUDGET_GIB','0'))
    record=service_record()
    from resource_gate import valid_receipt
    if record and budget and not valid_receipt(HOME/'memory-limit.json',budget):stop_service();record=None
    if record and (record.get('revision')!=LOCK['revision'] or record.get('source_revision')!=LOCK['source_revision'] or record.get('source')!=str(SOURCE) or record.get('gpu_budget_gib',0)!=budget or record.get('device',device)!=device):
        stop_service();record=None
    if not record:
        import socket
        with socket.socket() as sock:
            if sock.connect_ex(('127.0.0.1',PORT))==0:raise RuntimeError('Breeze 端口已由其他服务占用')
        progress('正在加载 Breeze 语音模型')
        env=dict(os.environ,LOCAL_RANK=str(device),OMP_NUM_THREADS='4',PYTHONUNBUFFERED='1')
        with (HOME/'service.log').open('ab') as log:
            command=[str(PYTHON),'-m','breeze_infer.api',str(HOME/'checkpoint'),'--host','127.0.0.1','--port',str(PORT),'--no-fast-all']
            if budget:
                command=[str(PYTHON),str(ROOT/'limited_runtime.py'),'breeze',str(device),str(budget),'breeze_infer.api',*command[3:]]
                env['FUMIAO_LIMIT_RECEIPT']=str(HOME/'memory-limit.json')
            p=subprocess.Popen(command,cwd=SOURCE,env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
        r={'pid':p.pid,'started':Path(f'/proc/{p.pid}/stat').read_text().rsplit(')',1)[1].split()[19],
           'boot':Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'revision':LOCK['revision'],'source_revision':LOCK['source_revision'],'source':str(SOURCE),'gpu_budget_gib':budget,'device':device}
        (HOME/'service.json').write_text(json.dumps(r))
    for _ in range(180):
        if cancel():stop_service();raise RuntimeError('实例已停止')
        if not service_record():raise RuntimeError('Breeze 服务启动失败，请查看 service.log')
        try:
            with urllib.request.urlopen(URL+'/health',timeout=3) as response:
                if json.load(response).get('status')=='ok':
                    if budget:
                        from resource_gate import valid_receipt
                        if not valid_receipt(HOME/'memory-limit.json',budget):raise RuntimeError('Breeze 显存预算未通过运行检查')
                    return
        except OSError:pass
        time.sleep(1)
    raise RuntimeError('Breeze 模型加载超时，请查看 service.log')


def render(job,folder,cancel=lambda:False,stage=lambda _:None,device=0):
    ensure_service(stage,cancel,device)
    stage('generating')
    body=urllib.parse.urlencode({'text':job['prompt'],'instruction':job['audio_settings']['instruction'],'cfg_scale':4,'seed':job['seed']}).encode()
    request=urllib.request.Request(URL+'/v1/audio/speech',data=body,headers={'Content-Type':'application/x-www-form-urlencoded'})
    raw=bytearray()
    with urllib.request.urlopen(request,timeout=600) as response:
        if response.headers.get('X-Sample-Rate')!='24000':raise RuntimeError('语音采样率不符合预期')
        while block:=response.read(48000):
            if cancel():stop_service();raise RuntimeError('生成已停止')
            raw.extend(block)
            if len(raw)>24000*2*120:raise RuntimeError('语音超过时长限制，请缩短文字')
    if len(raw)<4800 or len(raw)%2:raise RuntimeError('语音输出不完整')
    stage('finalizing');path=folder/'audio.wav'
    with wave.open(str(path),'wb') as out:out.setnchannels(1);out.setsampwidth(2);out.setframerate(24000);out.writeframes(raw)
    return {'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'media_type':'audio/wav'}
