/**
 * 演示模式（仅 `npm run demo` / `npm run build:demo`）。
 * 完全在内存中模拟后台快照，不发出任何网络请求，不调用 Tauri、Google 或弗淼。
 * 生产构建中 __FM_DEMO__ 为 false，本文件不会被打包。
 */
import type {Client, ColabAccelerator, ColabAccount, ColabInstance, Kind, Method, Resource, Snapshot} from '../api';

export type ScenarioId = 'extension'|'login'|'setup'|'authorizing'|'connected'|'deploying'|'running'|'paused'|'error'|'draining'|'offline'|'colab-none'|'colab-multi'|'colab-noperm'|'colab-unknown'|'colab-pending';
export const scenarios:{id:ScenarioId; label:string}[] = [
  {id:'extension',label:'安装 Chrome 扩展'},
  {id:'login',label:'首次登录'},
  {id:'setup',label:'未连接 Google'},
  {id:'authorizing',label:'等待授权'},
  {id:'connected',label:'已连接 · 未接单'},
  {id:'deploying',label:'Colab 部署中'},
  {id:'running',label:'运行中'},
  {id:'paused',label:'重开后暂停'},
  {id:'error',label:'故障恢复'},
  {id:'draining',label:'退出排空'},
  {id:'offline',label:'后台断开'},
  {id:'colab-none',label:'Colab · 无实例'},
  {id:'colab-multi',label:'Colab · 多实例'},
  {id:'colab-noperm',label:'Colab · 无资格'},
  {id:'colab-unknown',label:'Colab · 订阅未知'},
  {id:'colab-pending',label:'Colab · 操作中/失败'}
];

const catalog = ():ColabAccelerator[]=>[
  {id:'CPU',label:'CPU',variant:'CPU',eligible:true,high_memory:false},
  {id:'T4',label:'T4',variant:'GPU',eligible:true,high_memory:false},
  {id:'L4',label:'L4',variant:'GPU',eligible:true,high_memory:false},
  {id:'A100',label:'A100',variant:'GPU',eligible:true,high_memory:true},
  {id:'G4',label:'G4',variant:'GPU',eligible:true,high_memory:false},
  {id:'TPU_V5E1',label:'TPU v5e-1',variant:'TPU',eligible:false,high_memory:false}
];
const account = (patch:Partial<ColabAccount>={}):ColabAccount=>({status:'ready',detail:'',checked_at:Math.floor(Date.now()/1000)-300,
  subscription_tier:'SUBSCRIPTION_TIER_PRO_PLUS',google_ai_plan:{id:null,name:null,status:'unknown',source:null},
  paid_compute_units_balance:412.6,consumption_rate_hourly:null,eligible_accelerators:catalog(),source:'colab user-info（演示）',...patch});
const inst = (patch:Partial<ColabInstance>&{id:string}):ColabInstance=>({node:null,name:'Colab 实例',purpose:'compute',gpu:'L4',status:'ready',detail:'',started_at:Math.floor(Date.now()/1000)-1800,project_id:null,...patch});

const now = ()=>Math.floor(Date.now()/1000);
const res = (kind:Kind,patch:Partial<Resource>={}):Resource=>({kind,enabled:false,stage:'disconnected',current_job:null,...patch});

function base(os:string):Snapshot{
  return {
    version:'0.3.2',os,account:{name:'demo_user',nickname:'演示账户',id:1},site:'https://nvmes.com',
    resources:{breeze:res('breeze',os==='Windows'?{}:{stage:'unsupported'}),flow:res('flow'),colab:res('colab')},
    google:{},chrome:{prepared:false,connected:false,stage:'not_installed',version:'0.3.2'},earned:null,balance:null,history_loaded:false,history:[],events:[],operations:{},
    draining:false,can_quit:true,
    settings:{theme:'light'},colab_account:{...account(),status:'unknown',checked_at:null,subscription_tier:null,paid_compute_units_balance:null,eligible_accelerators:[],source:null},colab_instances:[]
  };
}

const sampleHistory = ()=>{const t=now();return [
  {job:48213,name:'Colab · H3 视频',reward:21.7,created:t-1200},
  {job:48190,name:'Flow · 图片',reward:2.1,created:t-5400},
  {job:48122,name:'Flow · 视频',reward:9.8,created:t-9800},
  {job:48007,name:'Colab · H3 视频',reward:14,created:t-86400},
  {job:47950,name:'Breeze · 语音',reward:0.7,created:t-90000}
]};
const sampleEvents = (extra:Snapshot['events']=[])=>{const t=now();return [...extra,
  {at:t-60,title:'Flow 任务完成',detail:'任务 #48190 已回传',level:'info'},
  {at:t-900,title:'Google 已授权',detail:'正在打开 Flow 登录窗口',level:'info'},
  {at:t-1000,title:'后台已启动',detail:'',level:'info'}
]};

export function buildScenario(id:ScenarioId, os:string, theme:string):Snapshot{
  const s = base(os); s.settings.theme = theme;
  const connected = ()=>{s.chrome={prepared:true,connected:true,stage:'connected',version:'0.3.2'};s.google={stage:'connected',email:'demo.user@gmail.com',flow:'connected',detail:'Colab 授权与 Flow 会话均已就绪'}};
  const loaded = ()=>{s.earned=1284.35;s.balance=3620;s.history_loaded=true;s.history=sampleHistory();s.events=sampleEvents()};
  const instance = (offsetMin=34)=>{s.colab_account=account();s.colab_instances=[inst({id:'c-h3',node:3107,name:'G4 · H3',purpose:'h3',gpu:'G4',detail:'MiniMax H3 已就绪',started_at:now()-offsetMin*60})]};
  switch(id){
    case 'extension': connected();s.chrome={prepared:false,connected:false,stage:'not_installed',version:'0.3.2'};s.google.flow=undefined;break;
    case 'login': s.account=null; break;
    case 'setup': s.earned=0;s.balance=500;s.history_loaded=true; break;
    case 'authorizing': s.google={stage:'authorizing',detail:'已在浏览器打开 Google 授权页'}; break;
    case 'connected': connected(); loaded(); break;
    case 'deploying':
      connected(); loaded();
      s.resources.flow={...s.resources.flow,enabled:true,stage:'ready',node:2201,detail:'等待平台分配任务'};
      s.resources.colab={...s.resources.colab,enabled:true,stage:'preparing',progress:0.42,detail:'正在安装 H3（12/29 个文件）'};
      instance(2);s.colab_instances=[inst({id:'c-h3',name:'G4 · H3',purpose:'h3',gpu:'G4',status:'deploying',detail:'正在安装 MiniMax H3（12/29）'})];s.operations={'colab.deploy':{running:true}}; break;
    case 'running':
      connected(); loaded();
      s.resources.flow={...s.resources.flow,enabled:true,stage:'busy',node:2201,current_job:48231,detail:'正在生成视频'};
      s.resources.colab={...s.resources.colab,enabled:true,stage:'ready',detail:'H3 已加载，等待任务'};
      if(os==='Windows') s.resources.breeze={...s.resources.breeze,enabled:true,stage:'ready',node:1902,detail:'WSL2 环境运行中'};
      instance(); break;
    case 'paused':
      connected(); loaded();
      s.resources.flow={...s.resources.flow,stage:'paused',node:2201,detail:'已停止接收新任务'};
      s.resources.colab={...s.resources.colab,stage:'paused',detail:'重新打开应用后默认暂停'};
      instance(52);
      s.events=sampleEvents([{at:now()-20,title:'已核对上次云端实例',detail:'正在核对上次实例，释放后可重新开始',level:'info'}]); break;
    case 'error':
      connected(); loaded();
      s.resources.flow={...s.resources.flow,enabled:true,stage:'ready',node:2201,detail:'等待平台分配任务'};
      s.colab_account=account();
      s.resources.colab={...s.resources.colab,stage:'error',detail:'Colab 未分配 L4：资源不足，未创建实例。可选择其他机型重试。'};
      s.operations={'colab.start':{running:false,error:'Colab 未分配 L4：资源不足'}};
      s.events=sampleEvents([{at:now()-30,title:'操作未完成',detail:'Colab 未分配 L4：资源不足',level:'error'}]); break;
    case 'draining':
      connected(); loaded();
      s.draining=true;s.can_quit=false;
      s.resources.flow={...s.resources.flow,stage:'busy',current_job:48231,node:2201,detail:'完成当前任务后退出'};
      s.resources.colab={...s.resources.colab,stage:'paused',detail:'已停止接收新任务，实例继续运行'};
      instance(); break;
    case 'offline': connected(); loaded(); break;
    case 'colab-none': connected(); loaded(); s.colab_account=account(); s.colab_instances=[]; break;
    case 'colab-multi':
      connected(); loaded();
      s.colab_account=account({google_ai_plan:{id:'g1-ultra-tier',name:'Google AI Ultra',status:'confirmed',source:'同账号已有登录（演示）'},consumption_rate_hourly:13.08});
      s.resources.colab={...s.resources.colab,enabled:true,stage:'ready',detail:'2 台实例已接入平台'};
      s.colab_instances=[
        inst({id:'c-l4',node:3101,name:'L4 · Colab',gpu:'L4',detail:'JupyterLab 连接组件已就绪',project_id:'p1',started_at:now()-7200}),
        inst({id:'c-h3',node:3107,name:'G4 · H3',purpose:'h3',gpu:'G4',status:'busy',detail:'正在执行 H3 任务 #48231'}),
        inst({id:'c-a100',node:3110,name:'A100 · Colab',gpu:'A100 · 高内存',status:'offline',detail:'最后心跳 12 分钟前',started_at:now()-14400})
      ]; break;
    case 'colab-noperm':
      connected(); loaded();
      s.colab_account=account({subscription_tier:'SUBSCRIPTION_TIER_NONE',paid_compute_units_balance:0,
        eligible_accelerators:catalog().map(x=>({...x,eligible:false}))}); break;
    case 'colab-unknown':
      connected(); loaded();
      s.colab_account=account({subscription_tier:null,paid_compute_units_balance:null,detail:'Colab 未返回订阅档位',
        google_ai_plan:{id:null,name:null,status:'authorization_required',source:null},
        eligible_accelerators:catalog().filter(x=>x.id!=='G4').map(x=>({...x,eligible:null}))}); break;
    case 'colab-pending':
      connected(); loaded(); s.colab_account=account();
      s.colab_instances=[inst({id:'c-new',name:'L4 · Colab',status:'requesting',detail:'正在向 Colab 申请 L4'})];
      s.operations={'colab.start':{running:true},'colab.deploy':{running:false,error:'Colab 暂时无法分配 G4，未创建实例'}}; break;
  }
  return s;
}

type Listener = ()=>void;

export class DemoClient implements Client{
  readonly demo = true;
  scenario:ScenarioId; os:string; offline=false;
  private s:Snapshot; private timer:number; private listeners=new Set<Listener>();
  private authAt=0;

  constructor(id:ScenarioId='connected', os='Darwin'){
    this.scenario=id; this.os=os; this.s=buildScenario(id,os,'light'); this.offline=id==='offline';
    this.timer=window.setInterval(()=>this.tick(),700);
  }
  subscribe(fn:Listener){this.listeners.add(fn);return ()=>{this.listeners.delete(fn)}}
  private emit(){this.listeners.forEach(f=>f())}
  load(id:ScenarioId, os=this.os){
    const theme=this.s.settings.theme; this.scenario=id; this.os=os;
    this.s=buildScenario(id,os,theme); this.offline=id==='offline'; this.authAt=id==='authorizing'?Date.now():0; this.emit();
  }
  setOffline(v:boolean){this.offline=v;this.emit()}
  dispose(){clearInterval(this.timer)}

  private ev(title:string,detail='',level='info'){this.s.events=[{at:now(),title,detail,level},...this.s.events].slice(0,40)}
  private op(key:string,running:boolean,error?:string){this.s.operations={...this.s.operations,[key]:{running,...(error?{error}:{})}}}
  private setInst(id:string,patch:Partial<ColabInstance>){this.s.colab_instances=(this.s.colab_instances??[]).map(i=>i.id===id?{...i,...patch}:i)}
  private r(kind:Kind,patch:Partial<Resource>){this.s.resources={...this.s.resources,[kind]:{...this.s.resources[kind],...patch}}}

  private tick(){
    const s=this.s; let changed=false;
    if(s.google.stage==='authorizing' && this.authAt && Date.now()-this.authAt>6000){
      s.google={stage:'connected',email:'demo.user@gmail.com',detail:'Colab 已授权，请完成 Flow 网页登录'};this.authAt=0;
      this.ev('Google 已授权','正在打开 Flow 登录窗口');this.op('flow.connect',true);changed=true;
      window.setTimeout(()=>{this.op('flow.connect',false);this.s.google={...this.s.google,flow:'connected',detail:'Colab 授权与 Flow 会话均已就绪'};this.ev('Flow 已登录');this.emit()},3500);
    }
    for(const kind of ['breeze','flow','colab'] as Kind[]){
      const r=s.resources[kind];
      if(s.operations[kind+'.start']?.running && r.enabled){
        const p=(r.progress??0)+(kind==='colab'?0.04:0.2);
        if(p>=1){this.r(kind,{stage:'ready',progress:undefined,node:r.node??(2000+kind.length),detail:'等待平台分配任务'});this.op(kind+'.start',false);this.ev(kind+' 可接单')}
        else this.r(kind,{stage:'preparing',progress:p,detail:kind==='colab'?`正在部署 H3 执行器（${Math.round(p*100)}%）`:'正在连接'});
        changed=true;
      }
    }
    if(changed) this.emit();
  }

  async call<T>(method:Method, params:Record<string,unknown>={}):Promise<T>{
    await new Promise(r=>setTimeout(r,120));
    if(this.offline) throw new Error('后台未响应（演示）');
    const s=this.s; const kind=params.kind as Kind;
    const ok=(v:unknown={ok:true})=>{this.emit();return v as T};
    switch(method){
      case 'chrome.prepare': s.chrome={prepared:true,connected:false,stage:'waiting',version:'0.3.2',folder:this.os==='Windows'?'C:\\Users\\Demo\\AppData\\Local\\fmWorker\\chrome-extension':'/Users/demo/Library/Application Support/fmWorker/chrome-extension'};return ok();
      case 'chrome.open_extensions': case 'chrome.reveal': this.ev('演示模式未打开外部窗口');return ok();
      case 'status': return structuredClone(s) as T;
      case 'login':
        if(!params.name||!params.password) throw new Error('请输入用户名和密码');
        this.load('setup');return ok();
      case 'logout':
        if(Object.values(s.resources).some(r=>r.enabled)) throw new Error('请先暂停资源，再退出登录');
        s.account=null;s.earned=null;s.balance=null;s.history=[];s.history_loaded=false;return ok();
      case 'refresh': if(s.earned==null){s.earned=0;s.balance=500}s.history_loaded=true;return ok({started:true});
      case 'open_platform': this.ev('已打开弗淼网页（演示未真正打开）');return ok();
      case 'google.connect': s.google={stage:'authorizing',detail:'已在浏览器打开 Google 授权页'};this.authAt=Date.now();this.ev('等待 Google 授权');return ok();
      case 'google.reopen': this.authAt=Date.now();this.ev('已重新打开授权页（演示）');return ok();
      case 'google.cancel': s.google={stage:'error',detail:'授权已取消，可重新连接'};this.authAt=0;this.ev('已取消授权');return ok();
      case 'google.disconnect':
        if(s.resources.flow.current_job) throw new Error('请等待 Flow 当前任务完成');
        s.google={};(['flow','colab'] as Kind[]).forEach(k=>this.r(k,{enabled:false,stage:'disconnected',node:undefined}));this.ev('已断开 Google');return ok();
      case 'flow.connect':
        if(s.operations['flow.connect']?.running) throw new Error('此操作正在进行');
        this.op('flow.connect',true);
        window.setTimeout(()=>{this.op('flow.connect',false);this.s.google={...this.s.google,flow:'connected'};this.ev('Flow 已登录');this.emit()},3000);return ok({started:true});
      case 'resource.start':
        if(kind==='colab') return this.call<T>('colab.start',params);
        if(s.draining) throw new Error('正在退出，请重新打开软件后接入资源');
        if(kind!=='breeze'&&s.google.stage!=='connected') throw new Error('请先在 Google 账号页面连接账号');
        if(s.operations[kind+'.start']?.running) throw new Error('此操作正在进行');
        this.r(kind,{enabled:true,stage:'preparing',progress:0,detail:'正在准备'});this.op(kind+'.start',true);return ok({started:true});
      case 'resource.pause':
        this.r(kind,{enabled:false});this.op(kind+'.pause',true);
        window.setTimeout(()=>{this.op(kind+'.pause',false);this.op(kind+'.start',false);this.r(kind,{stage:'paused',current_job:null,progress:undefined,detail:'已停止接收新任务'});this.ev(kind+' 已暂停');this.emit()},1200);
        return ok({started:true});
      case 'pause_all': case 'shutdown':
        if(method==='shutdown'){s.draining=true;s.can_quit=false}
        (['breeze','flow','colab'] as Kind[]).forEach(k=>{if(s.resources[k].enabled) void this.call('resource.pause',{kind:k})});return ok({started:true});
      case 'colab.probe':
        this.op('colab.probe',true);s.colab_account={...(s.colab_account??account()),status:'loading'};
        window.setTimeout(()=>{this.op('colab.probe',false);this.s.colab_account=account({google_ai_plan:this.s.colab_account?.google_ai_plan??account().google_ai_plan});this.ev('Colab 权益已更新');this.emit()},1500);
        return ok({started:true});
      case 'colab.plan_authorize':
        this.op('colab.plan_authorize',true);
        window.setTimeout(()=>{this.op('colab.plan_authorize',false,'当前授权无法查询 Google AI 套餐（演示结果）');this.ev('套餐授权未完成','','error');this.emit()},1200);
        return ok({started:true});
      case 'colab.start': {
        if(!params.accelerator) throw new Error('请先选择实例类型');
        if(s.operations['colab.start']?.running) throw new Error('此操作正在进行');
        const id='c-'+Date.now();this.op('colab.start',true);
        s.colab_instances=[...(s.colab_instances??[]),inst({id,name:`${params.accelerator}${params.high_memory?' · 高内存':''} · Colab`,gpu:String(params.accelerator),status:'requesting',detail:'正在向 Colab 申请'})];
        window.setTimeout(()=>{this.setInst(id,{status:'connecting',detail:'正在运行连接组件'});this.emit()},1500);
        window.setTimeout(()=>{this.setInst(id,{status:'ready',node:3200+Math.floor(Math.random()*90),detail:'已接入 nvmes.com，可在Colab 打开'});this.op('colab.start',false);this.r('colab',{enabled:true,stage:'ready'});this.ev('Colab 实例已接入');this.emit()},3500);
        return ok({started:true});
      }
      case 'colab.deploy': {
        if(s.operations['colab.deploy']?.running) throw new Error('此操作正在进行');
        const id='h3-'+Date.now();this.op('colab.deploy',true,undefined);
        s.colab_instances=[...(s.colab_instances??[]),inst({id,name:'G4 · H3',purpose:'h3',gpu:'G4',status:'requesting',detail:'正在申请 G4'})];
        window.setTimeout(()=>{this.setInst(id,{status:'deploying',detail:'正在安装 MiniMax H3'});this.emit()},1500);
        window.setTimeout(()=>{this.setInst(id,{status:'ready',node:3300+Math.floor(Math.random()*90),detail:'MiniMax H3 已通过检查'});this.op('colab.deploy',false);this.ev('H3 实例已就绪');this.emit()},4500);
        return ok({started:true});
      }
      case 'colab.release': {
        const id=String(params.id);this.op('colab.release:'+id,true);this.setInst(id,{status:'releasing'});
        window.setTimeout(()=>{this.op('colab.release:'+id,false);this.s.colab_instances=(this.s.colab_instances??[]).filter(i=>i.id!==id);this.ev('Colab 实例已释放');this.emit()},2000);
        return ok({started:true});
      }
      case 'settings': s.settings={...s.settings,...params} as Snapshot['settings'];return ok();
      case 'diagnostics': this.ev('诊断记录已导出','演示模式未写入文件');return ok({path:'(演示) fmWorker-diagnostics.json'});
    }
    throw new Error('未知操作');
  }
}
