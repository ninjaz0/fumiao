import json
import os
import platform
import threading
import time
import webbrowser
import urllib.request
from pathlib import Path

from . import __version__
from .state import State,Vault,atomic
from .platform import Platform,PlatformError
from .google import Google
from .flow import Flow
from .colab import Colab
from .colab_account import empty_account
from .breeze import Breeze
from .chrome_bridge import ChromeBridge

KINDS=('breeze','flow','colab')
DEFAULT_SETTINGS={'theme':'light','drive_cache':True}


class Service:
    def __init__(self,state=None,vault=None,start_thread=True):
        for scheme,proxy in urllib.request.getproxies().items():
            if scheme in ('http','https') and proxy:os.environ.setdefault(scheme+'_proxy',proxy)
        exclusions=os.environ.get('no_proxy',os.environ.get('NO_PROXY',''))
        os.environ['no_proxy']=','.join(filter(None,[exclusions,'127.0.0.1','localhost','::1']))
        self.state=state or State();self.vault=vault or Vault()
        self.state.set('settings',DEFAULT_SETTINGS|{k:v for k,v in self.state.get('settings',{}).items() if k in DEFAULT_SETTINGS})
        self.state.set('draining',False)
        plan_auth=self.state.get('google_plan_authorization',{})
        if plan_auth.get('stage')=='authorizing':
            self.state.set('google_plan_authorization',{'stage':'error','detail':'上一次套餐授权已中断，请重新授权'})
        saved_google=self.state.get('google')
        if saved_google.get('stage')=='authorizing':
            self.state.set('google',saved_google|{'stage':'error','detail':'上一次授权已中断，请重新连接 Google'})
        elif saved_google.get('flow')=='connected':
            self.state.set('google',saved_google|{'flow':'disconnected'})
        resources=self.state.get('resources')
        for saved in resources.values():saved.pop('limits',None)
        self.state.set('resources',resources)
        for kind in KINDS:
            self.state.resource(kind,enabled=False,stage='unsupported' if kind=='breeze' and platform.system()!='Windows' else 'disconnected',
                                current_job=None,detail='')
        self.api=Platform(self.state,self.vault)
        self.chrome=ChromeBridge(self.state,start=start_thread)
        self.google=Google(self.state,self.vault);self.flow=Flow(self.state,self.vault,self.api,chrome=self.chrome)
        self.colab=Colab(self.state,self.vault,self.google,self.api);self.breeze=Breeze(self.state,self.vault,self.api)
        self.operations={};self.op_lock=threading.Lock();self.cache={'earned':None,'balance':None,'history':[],'history_loaded':False}
        self.last_refresh=0;self.last_flow_probe=0;self.last_colab_probe=0;self.stopping=threading.Event();self.errors={}
        if start_thread:threading.Thread(target=self.loop,daemon=True,name='fmworker-controller').start()

    def background(self,key,fn):
        with self.op_lock:
            if self.operations.get(key,{}).get('running'):raise RuntimeError('此操作正在进行')
            self.operations[key]={'running':True}
        def run():
            try:fn()
            except Exception as exc:
                message=str(exc) if isinstance(exc,(RuntimeError,PlatformError)) else '操作未完成，请检查网络或导出诊断记录'
                self.state.event('操作未完成',message,'error')
                with self.op_lock:self.operations[key]={'running':False,'error':message}
                kind=key.split('.')[0]
                if kind in KINDS and not (key=='flow.connect' and self.flow.active):
                    self.state.resource(kind,stage='error',detail=message)
            else:
                with self.op_lock:self.operations[key]={'running':False}
        threading.Thread(target=run,daemon=True,name=key).start()
        return {'started':True}

    def status(self):
        data=self.state.get('resources')
        with self.op_lock:ops=dict(self.operations)
        can_quit=not self.flow.active and self.breeze.stopped() and not any(o['running'] for o in ops.values())
        return {'version':__version__,'os':platform.system(),'account':self.state.get('account'),
                'site':self.api.site,'resources':data,'google':self.state.get('google'),'chrome':self.chrome.status(),
                'google_plan_authorization':self.state.get('google_plan_authorization',{}),
                'settings':self.state.get('settings'),'events':self.state.get('events'),
                'active_colab':None,'colab_account':self.state.get('colab_account') or empty_account(),
                'colab_instances':self.colab.public_instances(),
                'google_plan_authorization':self.state.get('google_plan_authorization',{}),
                'operations':ops,'draining':self.state.get('draining'),'can_quit':can_quit,**self.cache}

    def refresh(self):
        if not self.state.get('account'):return
        data=self.api.request('GET','/api/fmworker/account').json()
        history=self.api.request('GET','/api/fmworker/history').json()['items']
        self.cache={'earned':data['earned'],'balance':(data.get('wallet') or {}).get('balance'),'history':history,'history_loaded':True}
        self.last_refresh=time.monotonic()

    def probe_colab(self):
        with self.op_lock:
            if self.operations.get('colab.probe',{}).get('running'):return {'started':False}
        self.last_colab_probe=time.monotonic()
        try:return self.background('colab.probe',self.colab.probe.run)
        except RuntimeError:return {'started':False}  # Another login callback won the operation slot.

    def loop(self):
        while not self.stopping.wait(3):
            self.detect_existing_flow()
            if self.state.get('account') and self.state.get('google').get('stage')=='connected' and not self.last_colab_probe:
                self.probe_colab()
            for name,fn in [('flow',self.flow.tick),('colab',self.colab.tick),('breeze',self.breeze.tick)]:
                try:fn()
                except Exception as exc:
                    if time.monotonic()-self.errors.get(name,0)>120:
                        self.errors[name]=time.monotonic()
                        message=str(exc) if isinstance(exc,(RuntimeError,PlatformError)) else '连接暂时中断，将自动重试'
                        self.state.event(name+' 连接提示',message,'error')
            if time.monotonic()-self.last_refresh>45:
                try:self.refresh()
                except Exception:self.last_refresh=time.monotonic()
            if self.state.get('draining') and not self.flow.active:self.flow.close()

    def detect_existing_flow(self):
        if self.state.get('draining') or self.state.get('google').get('stage')!='connected':return
        if self.flow.backend_ready or not self.chrome.status()['connected']:return
        if time.monotonic()-self.last_flow_probe<30:return
        with self.op_lock:
            if self.operations.get('flow.connect',{}).get('running') or self.operations.get('flow.start',{}).get('running'):return
        self.last_flow_probe=time.monotonic()
        try:self.background('flow.connect',self.flow.detect)
        except RuntimeError:pass  # A manual connect may have won the operation slot.

    def start(self,kind,accelerator=None,high_memory=False):
        if kind not in KINDS:raise ValueError('未知资源')
        if self.state.get('draining'):raise RuntimeError('正在退出，请重新打开软件后接入资源')
        if not self.state.get('account'):raise RuntimeError('请先登录弗淼')
        if kind in ('flow','colab'):
            if self.state.get('google').get('stage')!='connected':raise RuntimeError('请先在 Google 账号页面连接账号')
        if kind=='flow' and not self.chrome.status()['connected']:
            raise RuntimeError('请先按照 Flow 页面指引安装并连接 Chrome 扩展')
        if kind=='breeze' and platform.system()!='Windows':raise RuntimeError('Mac 首版可使用 Flow 和 Colab')
        if kind=='colab':
            if not accelerator:raise RuntimeError('请先选择实例类型')
            return self.background('colab.start',lambda:self.colab.start(accelerator,high_memory))
        def work():
            self.api.register(kind)
            resource=self.state.get('resources')[kind]
            self.api.configure(kind,True)
            try:
                if kind=='flow':self.flow.connect()
                else:self.breeze.start()
            except Exception:
                self.api.configure(kind,False);raise
        return self.background(kind+'.start',work)

    def pause(self,kind):
        if kind=='colab':
            self.colab.drain();return
        resource=self.state.get('resources')[kind]
        self.state.resource(kind,enabled=False)
        try:
            if resource.get('node'):self.api.configure(kind,False)
        finally:
            if kind=='breeze':self.breeze.drain()
            if kind=='flow' and not self.flow.active:self.state.resource(kind,stage='paused',detail='已停止接收新任务')

    def dispatch(self,method,params):
        if method=='status':return self.status()
        if method=='login':
            previous=self.state.get('account')
            current=self.api.login(str(params.get('name','')),str(params.get('password','')))
            self.cache={'earned':None,'balance':None,'history':[],'history_loaded':False}
            if previous and previous['id']!=current['user']['id']:
                for kind in KINDS:self.state.resource(kind,node=None,enabled=False)
            self.refresh()
            if self.state.get('google').get('stage')=='connected':
                self.probe_colab()
            return {'ok':True}
        if method=='refresh':return self.background('refresh',self.refresh)
        if method=='logout':
            if not self.status()['can_quit'] or any(r.get('enabled') for k,r in self.state.get('resources').items() if k!='colab'):raise RuntimeError('请先暂停本地和 Flow 任务，再退出登录；Colab 实例继续运行')
            self.api.logout()
            self.cache={'earned':None,'balance':None,'history':[],'history_loaded':False}
            return {'ok':True}
        if method=='open_platform':webbrowser.open(self.api.site);return {'ok':True}
        if method=='google.connect':
            def connected():
                self.state.event('Google 已授权','请在当前 Chrome 用户中连接 Flow')
                self.probe_colab()
                if self.chrome.status()['connected']:self.background('flow.connect',self.flow.connect)
            self.google.begin(connected);return {'ok':True}
        if method=='google.disconnect':
            if self.flow.active:raise RuntimeError('请等待 Flow 当前任务完成')
            resources=self.state.get('resources')
            if resources['flow'].get('enabled'):
                raise RuntimeError('请先暂停 Flow 贡献')
            pending=self.state.get('allocation_pending')
            active=any(r.get('status')!='released' and r.get('phase')!='rejected' for r in self.state.get('colab_instances',{}).values())
            if active or self.state.get('managed_colab') or (pending and pending.get('phase')!='unassigned'):
                raise RuntimeError('请先核对并释放 Colab 实例')
            with self.op_lock:
                if any(v.get('running') and (k.startswith('flow.') or k.startswith('colab.')) for k,v in self.operations.items()):
                    raise RuntimeError('连接操作正在进行，请完成后再断开账号')
            self.flow.close();self.google.disconnect();self.vault.delete('flow-cookie');self.state.set('flow_project',None);return {'ok':True}
        if method=='google.reopen':self.google.reopen();return {'ok':True}
        if method=='google.cancel':self.google.cancel();return {'ok':True}
        if method=='chrome.prepare':return self.chrome.prepare()
        if method=='chrome.open_extensions':return self.chrome.open_extensions()
        if method=='chrome.reveal':return self.chrome.reveal()
        if method=='flow.connect':
            if self.flow.active:raise RuntimeError('请等待 Flow 当前任务完成后再登录')
            return self.background('flow.connect',self.flow.connect)
        if method=='resource.start':return self.start(params['kind'],params.get('accelerator'),params.get('high_memory',False))
        if method=='colab.start':return self.start('colab',params.get('accelerator'),params.get('high_memory',False))
        if method=='colab.probe':
            if self.state.get('google').get('stage')!='connected':raise RuntimeError('请先连接 Google 账号')
            return self.probe_colab()
        if method=='colab.plan_authorize':
            self.google.begin_plan(self.probe_colab);return {'ok':True}
        if method=='colab.deploy':
            if self.state.get('draining'):raise RuntimeError('正在退出，请重新打开软件后部署')
            if not self.state.get('account'):raise RuntimeError('请先登录弗淼')
            if self.state.get('google').get('stage')!='connected':raise RuntimeError('请先连接 Google 账号')
            return self.background('colab.deploy',self.colab.deploy)
        if method=='resource.pause':return self.background(params['kind']+'.pause',lambda:self.pause(params['kind']))
        if method=='pause_all' or method=='shutdown':
            if method=='shutdown':self.state.set('draining',True)
            def pause_all():
                kinds=('flow','breeze') if method=='shutdown' else KINDS
                for kind in kinds:self.state.resource(kind,enabled=False)
                for kind in kinds:
                    if not self.operations.get(kind+'.pause',{}).get('running'):
                        self.background(kind+'.pause',lambda current=kind:self.pause(current))
            return self.background('shutdown' if method=='shutdown' else 'pause_all',pause_all)
        if method=='colab.release':
            instance_id=params.get('id')
            if not isinstance(instance_id,str) or not instance_id:raise RuntimeError('请选择要释放的实例')
            return self.background('colab.release.'+instance_id,lambda:self.colab.release(instance_id))
        if method=='settings':
            settings=self.state.get('settings')
            valid={'theme':('light','dark'),'drive_cache':(True,False)}
            if not params or any(k not in valid or v not in valid[k] for k,v in params.items()):raise ValueError('设置值无效')
            settings.update(params);self.state.set('settings',settings);return {'ok':True}
        if method=='diagnostics':
            report=self.status();report.pop('account',None);report['google']={'stage':report['google'].get('stage')}
            diagnostic=self.state.root/'flow/connection-diagnostic.json'
            if diagnostic.exists():
                try:report['flow_connection']=json.loads(diagnostic.read_text(encoding='utf-8'))
                except (OSError,ValueError):pass
            target=self.state.root/'diagnostics'/('fmWorker-'+time.strftime('%Y%m%d-%H%M%S')+'.json')
            atomic(target,report);self.state.event('诊断记录已导出',str(target));return {'path':str(target)}
        raise ValueError('未知操作')
