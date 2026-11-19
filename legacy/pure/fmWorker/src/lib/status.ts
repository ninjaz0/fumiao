import type {Kind, Resource, Snapshot} from '../api';

export const resourceName:Record<Kind,string> = {breeze:'Breeze 语音', flow:'Google Flow', colab:'Colab 云端'};
export const resourceShort:Record<Kind,string> = {breeze:'Breeze', flow:'Flow', colab:'Colab'};
export const resourceRole:Record<Kind,string> = {breeze:'本机 NVIDIA · 语音', flow:'Flow 订阅 · 图片与视频', colab:'Colab 实例 · H3'};

export const stageLabel:Record<string,string> = {
  disconnected:'未接入', paused:'已暂停', preparing:'准备中', ready:'可接单', busy:'执行中',
  error:'需要处理', unsupported:'此电脑不支持', connecting:'连接中', authorizing:'等待授权',
  releasing:'释放中', draining:'完成后退出'
};

export type Tone = 'off'|'ok'|'work'|'paused'|'error';
export function stageTone(stage:string):Tone{
  switch(stage){
    case 'ready': return 'ok';
    case 'busy': case 'preparing': case 'connecting': case 'authorizing': case 'releasing': return 'work';
    case 'paused': case 'draining': return 'paused';
    case 'error': return 'error';
    default: return 'off';
  }
}

export type PrimaryAction = 'start'|'resume'|'retry'|'pause'|'google'|'extension'|'choose'|'none';
export type ResourceView = {
  kind:Kind; label:string; tone:Tone;
  action:PrimaryAction; actionLabel:string; actionDisabled:boolean; actionBusy:boolean;
  /** null：不显示进度；'indeterminate'：后台在处理但没有数值。 */
  progress:number|'indeterminate'|null;
  needsGoogle:boolean; starting:boolean; pausing:boolean; error?:string;
};

const isOpRunning = (s:Snapshot,key:string)=>!!s.operations[key]?.running;
export const flowTaskActive = (s:Snapshot)=>!!s.resources.flow.current_job||s.resources.flow.stage==='busy';

export function normalizeProgress(value:number|undefined):number|null{
  if(value==null||!Number.isFinite(value)) return null;
  const v = value>1?value/100:value;
  return Math.max(0,Math.min(1,v));
}

/**
 * 每个资源只看自己的操作键（kind.start / kind.pause，Colab 另含 colab.release），
 * 因此一个资源在安装/部署时，其他资源的暂停按钮仍然可用。
 * `pending` 是前端尚未返回的 RPC 名称+资源（形如 "resource.pause:flow"）。
 */
export function resourceView(s:Snapshot, kind:Kind, pending:string|null):ResourceView{
  const r:Resource = s.resources[kind];
  // Colab 的「开始贡献」是 colab.start（新建空实例）；释放按实例进行，不等于暂停资源。
  const starting = isOpRunning(s,kind+'.start') || pending==='resource.start:'+kind || (kind==='colab'&&pending==='colab.start');
  const pausing = isOpRunning(s,kind+'.pause') || pending==='resource.pause:'+kind;
  const needsGoogle = kind!=='breeze' && s.google.stage!=='connected';
  const opError = s.operations[kind+'.start']?.error || s.operations[kind+'.pause']?.error;
  let label = stageLabel[r.stage] || r.stage;
  if(r.stage==='busy' && r.current_job) label = '执行中 · #'+r.current_job;
  if(starting && !['preparing','connecting','busy','ready'].includes(r.stage) && r.stage!=='error') label = '准备中';
  let tone:Tone = starting && !['error','ready','busy'].includes(r.stage) ? 'work' : stageTone(r.stage);
  if(!r.enabled&&r.stage==='busy'){label='完成后暂停';tone='work'}
  else if(!r.enabled&&r.stage==='ready'){label='已暂停';tone='paused'}

  let action:PrimaryAction='start', actionLabel='开始贡献', actionDisabled=false, actionBusy=false;
  if(r.stage==='unsupported'){action='none';actionLabel='不可用';actionDisabled=true}
  else if(s.draining){action='none';actionLabel='正在退出';actionDisabled=true}
  else if(pausing){action='pause';actionLabel='正在暂停';actionDisabled=true;actionBusy=true}
  else if(r.enabled){action='pause';actionLabel=r.current_job?'暂停接单':'暂停'}
  else if(starting){action='start';actionLabel='正在准备';actionDisabled=true;actionBusy=true}
  else if(r.stage==='busy'){action='none';actionLabel='完成后暂停';actionDisabled=true}
  else if(needsGoogle){action='google';actionLabel='连接 Google'}
  else if(kind==='colab'){action='choose';actionLabel='选择实例类型'}
  else if(kind==='flow'&&s.chrome&&!s.chrome.connected){action='extension';actionLabel='安装 Chrome 扩展'}
  else if(r.stage==='error'){action='retry';actionLabel='重试'}
  else if(r.stage==='paused'){action='resume';actionLabel='恢复贡献'}
  if(kind==='flow'&&s.chrome&&!s.chrome.connected&&!r.enabled&&r.stage!=='busy'){
    label=s.chrome.stage==='update_required'?'扩展需更新':'待连接扩展';tone='paused';
  }

  const working = starting || ['preparing','connecting','releasing'].includes(r.stage);
  const progress = working ? (normalizeProgress(r.progress) ?? 'indeterminate') : null;
  return {kind,label,tone,action,actionLabel,actionDisabled,actionBusy,progress,needsGoogle,starting,pausing,
    error:r.stage==='error'?(r.detail||opError):undefined};
}

export type GoogleView = {
  stage:'connected'|'authorizing'|'error'|'none';
  colabLabel:string; colabTone:Tone; flowLabel:string; flowTone:Tone; flowOpening:boolean;
};
export function googleView(s:Snapshot):GoogleView{
  const g = s.google; const stage = g.stage==='connected'||g.stage==='authorizing'||g.stage==='error' ? g.stage : 'none';
  const flowOpening = isOpRunning(s,'flow.connect');
  const flowConnected = g.flow==='connected'&&(!s.chrome||s.chrome.connected);
  return {
    stage,
    colabLabel: stage==='connected'?'已授权':stage==='authorizing'?'等待浏览器授权':stage==='error'?'授权未完成':'未连接',
    colabTone: stage==='connected'?'ok':stage==='authorizing'?'work':stage==='error'?'error':'off',
    flowLabel: flowConnected?'已登录':s.chrome&&!s.chrome.connected?'扩展未连接':flowOpening?(s.resources.flow.stage==='preparing'?'准备连接组件':'正在同步'):g.flow==='error'?'会话同步失败':g.flow==='login_required'?'待网页登录':stage==='connected'?'待同步':'未连接',
    flowTone: flowConnected?'ok':flowOpening?'work':g.flow==='error'?'error':stage==='connected'?'paused':'off',
    flowOpening
  };
}

export function anyEnabled(s:Snapshot){return (Object.values(s.resources) as Resource[]).some(r=>r.enabled)}
export function anyOperation(s:Snapshot){return Object.values(s.operations).some(o=>o.running)}

/** 托盘/标题使用的整体状态。 */
export function overall(s:Snapshot, online:boolean):{label:string; tone:Tone}{
  if(!online) return {label:'后台未连接',tone:'error'};
  if(s.draining) return {label:'正在结束贡献',tone:'paused'};
  const list = Object.values(s.resources) as Resource[];
  if(list.some(r=>r.stage==='error')) return {label:'有资源需要处理',tone:'error'};
  const working = list.filter(r=>r.enabled&&r.stage==='busy').length;
  const ready = list.filter(r=>r.enabled&&r.stage==='ready').length;
  const preparing = list.filter(r=>r.enabled&&!['ready','busy','error'].includes(r.stage)).length;
  if(working) return {label:`执行中 · ${working} 项`,tone:'work'};
  if(list.some(r=>r.stage==='busy'&&!r.enabled)) return {label:'正在完成当前任务',tone:'work'};
  if(preparing) return {label:ready?`就绪 ${ready} · 准备 ${preparing}`:`准备中 · ${preparing} 项`,tone:'work'};
  if(ready) return {label:`可接单 · ${ready} 项`,tone:'ok'};
  if(anyOperation(s)) return {label:'正在处理',tone:'work'};
  return {label:'未接单',tone:'off'};
}

export type SetupStep = {id:'google'|'flow'|'start'; label:string; done:boolean; optional?:boolean};
export function setupSteps(s:Snapshot):SetupStep[]{
  return [
    {id:'google',label:'连接 Google 账号',done:s.google.stage==='connected',optional:s.os==='Windows'&&s.resources.breeze.stage!=='unsupported'},
    {id:'flow',label:'登录 Flow 网页',done:s.google.flow==='connected'&&(!s.chrome||s.chrome.connected),optional:true},
    {id:'start',label:'开始贡献至少一项资源',done:anyEnabled(s)}
  ];
}

export function canDisconnectGoogle(s:Snapshot,pending:string|null):boolean{
  return !pending&&!(s.colab_instances??[]).some(i=>i.status!=='released')&&!['flow','colab'].some(k=>{
    const r=s.resources[k as Kind];return r.enabled||r.stage==='busy';
  })&&!Object.entries(s.operations).some(([k,v])=>v.running&&(k.startsWith('flow.')||k.startsWith('colab.')));
}
