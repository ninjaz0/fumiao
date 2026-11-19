import hashlib
import json
import os
import platform
import shutil
import subprocess
import time
import uuid
from pathlib import Path
import requests
from .assets import bundled
from .state import atomic


class Breeze:
    def __init__(self,state,vault,api):
        self.state,self.vault,self.api=state,vault,api
        self.root=state.root/'breeze';self.root.mkdir(parents=True,exist_ok=True,mode=0o700)
        self.process=None;self.last_tick=0

    def wsl(self,*args,input=None,timeout=60):
        return subprocess.run(['wsl.exe','--distribution','fmWorker','--user','root','--',*map(str,args)],input=input,
                              capture_output=True,timeout=timeout,check=True,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))

    def check(self):
        if platform.system()!='Windows':raise RuntimeError('本地 Breeze 首版需要 Windows 11 与 NVIDIA 显卡')
        if not shutil.which('wsl.exe'):raise RuntimeError('Windows 未提供 WSL，请先更新到 Windows 11')
        status=subprocess.run(['wsl.exe','--status'],capture_output=True,timeout=20)
        if status.returncode:
            subprocess.Popen(['powershell.exe','-NoProfile','-Command',
                "Start-Process wsl.exe -ArgumentList '--install','--no-distribution' -Verb RunAs -Wait"],creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            raise RuntimeError('请完成 Windows 安装确认并重启，重新打开 fmWorker 后继续')

    def install(self):
        self.check()
        if shutil.disk_usage(self.root).free < 20*1024**3:
            raise RuntimeError('Breeze 运行环境需要至少 20 GB 可用磁盘空间')
        lock=json.loads(bundled('wsl.lock.json').read_text(encoding='utf-8'))
        listing=subprocess.check_output(['wsl.exe','--list','--quiet'],timeout=20).decode('utf-16-le',errors='replace')
        if lock['distribution'] not in [line.strip('\x00\r\n ') for line in listing.splitlines()]:
            image=self.root/'ubuntu-root.tar.xz'
            valid=False
            if image.exists():
                with image.open('rb') as stream:valid=hashlib.file_digest(stream,'sha256').hexdigest()==lock['sha256']
            if not valid:
                self.state.resource('breeze',stage='preparing',detail='正在下载独立语音运行环境')
                part=image.with_suffix('.partial');offset=part.stat().st_size if part.exists() else 0
                with requests.get(lock['url'],headers={'Range':f'bytes={offset}-'} if offset else {},stream=True,timeout=60) as response:
                    response.raise_for_status()
                    if response.status_code!=206:offset=0
                    with part.open('ab' if offset else 'wb') as out:
                        for chunk in response.iter_content(4*1024*1024):out.write(chunk)
                with part.open('rb') as stream:
                    if hashlib.file_digest(stream,'sha256').hexdigest()!=lock['sha256']:
                        part.unlink(missing_ok=True);raise RuntimeError('运行环境版本已变化或校验失败，请更新 fmWorker')
                part.replace(image)
            subprocess.run(['wsl.exe','--import','fmWorker',str(self.root/'distribution'),str(image),'--version','2'],check=True,capture_output=True,timeout=900)
        self.state.resource('breeze',stage='preparing',detail='正在安装专用语音环境')
        self.wsl('bash','-s',input=bundled('wsl-bootstrap.sh').read_bytes(),timeout=1800)
        gpu=self.wsl('bash','-c','if command -v nvidia-smi >/dev/null; then nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits; else /usr/lib/wsl/lib/nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits; fi').stdout.decode()
        if not any(float(line.strip())>=12000 for line in gpu.splitlines() if line.strip()):
            raise RuntimeError('Breeze 需要至少 12 GB 的 NVIDIA 显卡')
        return True

    def start(self):
        if self.process and self.process.poll() is None:return
        self.install()
        if not self.state.get('resources')['breeze']['enabled']:
            self.state.resource('breeze',stage='paused',detail='环境已准备，贡献已暂停');return
        cred=self.api.register('breeze')
        lock=json.loads(bundled('agent.lock.json').read_text(encoding='utf-8'))
        config={'site':self.api.site,'secret':cred['secret'],'model':'breeze-tts-2','cloud':False,
                'run_id':uuid.uuid4().hex,
                'agent_sha256':lock['sha256'],'started_at':time.time(),'deadline':time.time()+86400,'idle_minutes':15,'drive_cache':False}
        self.wsl('python3','-c',"import pathlib,sys;p=pathlib.Path('/opt/fmworker/config.json');p.write_bytes(sys.stdin.buffer.read());p.chmod(0o600)",input=json.dumps(config).encode())
        for name in ('agent.tgz','cloud_entry.py','cloud_watchdog.py','drive_cache.py'):
            self.wsl('python3','-c',"import pathlib,sys;p=pathlib.Path('/opt/fmworker')/sys.argv[1];p.write_bytes(sys.stdin.buffer.read());p.chmod(0o600)",name,input=bundled(name).read_bytes(),timeout=120)
        self.wsl('rm','-f','/opt/fmworker/drain')
        self.wsl('rm','-f','/opt/fmworker/worker-status.json')
        self.wsl('python3','-c',"import subprocess,pathlib,json,time;r=pathlib.Path('/opt/fmworker');(r/'controller.json').write_text(json.dumps({'at':time.time()}));f=(r/'watchdog.log').open('ab');subprocess.Popen(['/opt/fmworker/venv/bin/python',str(r/'cloud_watchdog.py')],stdout=f,stderr=f,start_new_session=True)")
        log=(self.root/'worker.log').open('ab')
        self.process=subprocess.Popen(['wsl.exe','--distribution','fmWorker','--user','root','--',
            '/opt/fmworker/venv/bin/python','-u','/opt/fmworker/cloud_entry.py'],stdin=subprocess.DEVNULL,stdout=log,stderr=log,
            creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        log.close();self.state.resource('breeze',stage='preparing',detail='正在下载校验 Breeze 模型')

    def tick(self):
        if platform.system()!='Windows' or not self.process or time.monotonic()-self.last_tick<10:return
        self.last_tick=time.monotonic()
        if self.process.poll() is not None:
            self.state.resource('breeze',stage='paused' if not self.state.get('resources')['breeze']['enabled'] else 'error',current_job=None,detail='语音运行进程已停止');return
        try:
            self.wsl('python3','-c',"import pathlib,json,time;pathlib.Path('/opt/fmworker/controller.json').write_text(json.dumps({'at':time.time()}))")
            raw=self.wsl('cat','/opt/fmworker/worker-status.json').stdout
            status=json.loads(raw)
            self.state.resource('breeze',stage=status.get('stage','preparing'),detail=status.get('detail','正在准备'),current_job=None)
        except Exception:pass

    def drain(self):
        if platform.system()=='Windows' and self.process and self.process.poll() is None:
            self.wsl('touch','/opt/fmworker/drain')

    def stopped(self):return self.process is None or self.process.poll() is not None
