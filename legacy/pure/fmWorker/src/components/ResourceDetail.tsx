import {Pause, Play, RotateCw, Globe, LogIn, Activity, Download, TriangleAlert} from 'lucide-react';
import type {Kind, Method, Snapshot} from '../api';
import {flowTaskActive, resourceName, resourceRole, resourceView, googleView} from '../lib/status';
import {liveInstances} from '../lib/colab';
import {Button, Card, Progress, StatusPill} from './ui';
import {kindIcon} from './Rail';
import {ChromeSetup} from './ChromeSetup';
import {ColabPanels} from './ColabPanels';

type Act = (m:Method,p?:Record<string,unknown>)=>Promise<unknown>;
type Props = {snap:Snapshot; kind:Kind; pending:string|null; act:Act; onPrimary:(k:Kind)=>void};

const idleText:Record<Kind,string> = {
  breeze:'启用后创建专用 WSL2 环境并加载 Breeze，随后在后台接收语音任务。',
  flow:'使用 Flow 订阅额度执行平台的图片与视频任务。',
  colab:'选择实例类型开始贡献，或一键部署 H3。实例在关闭 fmWorker 后继续运行，直到你释放。'
};

export function ResourceDetail({snap,kind,pending,act,onPrimary}:Props){
  const r = snap.resources[kind]; const v = resourceView(snap,kind,pending); const Icon = kindIcon[kind];
  const g = googleView(snap);
  const PIcon = v.action==='pause'?Pause:v.action==='retry'?RotateCw:v.action==='google'?Globe:Play;
  const instanceCount = kind==='colab'?liveInstances(snap).length:0;
  const message = r.detail || (r.stage==='unsupported'
    ? (snap.os==='Darwin'?'Mac 首版不提供本地 Breeze，可使用 Flow 和 Colab。':'需要 Windows 11 与 NVIDIA 显卡。')
    : v.needsGoogle?'先连接 Google 账号。':idleText[kind]);

  return <div className="detail" aria-labelledby={'h-'+kind}>
    <header className="detail-head">
      <span className={'res-icon lg tone-'+v.tone}><Icon size={20} aria-hidden="true"/></span>
      <div className="min0"><h1 id={'h-'+kind}>{resourceName[kind]}</h1><p className="muted ellipsis">{resourceRole[kind]}{kind==='colab'&&snap.colab_instances?` · ${instanceCount} 台实例`:r.node?` · 节点 ${r.node}`:''}</p></div>
      <span className="grow"/>
      <StatusPill tone={v.tone}>{v.label}</StatusPill>
    </header>

    {kind==='flow'&&<ChromeSetup snap={snap} pending={pending} act={act}/>}
    {(kind!=='flow'||!snap.chrome||snap.chrome.connected||r.enabled||r.current_job)&&!(kind==='colab'&&v.action==='choose'&&v.tone!=='error'&&v.progress==null)&&<Card className={'action-card'+(v.tone==='error'?' is-error':'')}>
      {v.tone==='error'
        ? <div className="error-block" role="alert"><TriangleAlert size={17} aria-hidden="true"/><div><strong>需要处理</strong><p>{v.error||'操作未完成，请重试或导出诊断记录。'}</p></div></div>
        : <p className="state-line" aria-live="polite">{message}</p>}
      {v.progress!=null&&<div className="progress-row"><Progress value={v.progress} label={`${resourceName[kind]}准备进度`}/>
        <span className="num muted small">{typeof v.progress==='number'?Math.round(v.progress*100)+'%':'处理中'}</span></div>}
      {r.current_job?<p className="job-line"><Activity size={15} aria-hidden="true"/>正在执行任务 <span className="num">#{r.current_job}</span>{v.pausing||!r.enabled?<span className="muted">· 完成后停止</span>:null}</p>:null}
      <div className="actions">
        {v.action!=='choose'&&<Button variant={v.action==='pause'?'secondary':'primary'} busy={v.actionBusy} disabled={v.actionDisabled}
          icon={<PIcon size={15} aria-hidden="true"/>} onClick={()=>onPrimary(kind)}>{v.actionLabel}</Button>}
        {kind==='flow'&&snap.google.stage==='connected'&&<Button icon={<LogIn size={15}/>} busy={g.flowOpening} disabled={flowTaskActive(snap)||g.flowOpening||snap.draining||!!pending} title={flowTaskActive(snap)?'当前任务完成后可重新登录':undefined} onClick={()=>act('flow.connect')}>{snap.google.flow==='connected'?'重新登录 Flow':'打开登录窗口'}</Button>}
        {v.tone==='error'&&<Button variant="ghost" icon={<Download size={15}/>} disabled={!!pending} onClick={()=>act('diagnostics')}>导出诊断</Button>}
      </div>
      {v.action==='pause'&&!v.actionDisabled&&<p className="hint">暂停后不再接新任务；正在执行的任务会完成并回传。{kind==='colab'?'暂停不释放实例。':''}</p>}
    </Card>}

    {kind==='colab'&&<ColabPanels snap={snap} pending={pending} act={act}/>}
    {kind==='breeze'&&r.stage!=='unsupported'&&<BreezeRequirements/>}
  </div>;
}

function BreezeRequirements(){
  return <Card title="运行条件">
    <ul className="req-list">
      <li>Windows 11 · NVIDIA 显卡，显存至少 12 GB</li>
      <li>可用磁盘至少 20 GB（模型与运行环境）</li>
      <li>首次启用会创建专用 WSL2 环境，可能需要管理员确认和重启</li>
    </ul>
  </Card>;
}
