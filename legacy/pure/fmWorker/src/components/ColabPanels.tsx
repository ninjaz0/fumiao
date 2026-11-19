import {useState} from 'react';
import {RefreshCw, KeyRound, Play, Rocket, Power, Cpu, Server, TriangleAlert} from 'lucide-react';
import type {ColabAccelerator, Method, Snapshot} from '../api';
import {accountStatus, acceleratorKey, liveInstances, acceleratorText, eligibilityText, g4Eligibility, instanceView, planLabel, tierLabel} from '../lib/colab';
import {dateTime, points} from '../lib/format';
import {Button, Card, Confirm, Dot, StatusPill} from './ui';

type Act = (m:Method,p?:Record<string,unknown>)=>Promise<unknown>;
type Props = {snap:Snapshot; pending:string|null; act:Act};
const running = (s:Snapshot,key:string)=>!!s.operations[key]?.running;

export function ColabPanels({snap,pending,act}:Props){
  const [confirm,setConfirm] = useState<null|{kind:'deploy'}|{kind:'release';id:string;name:string}>(null);
  // 已有实例时先显示实例列表，便于逐台查看或释放；新建入口在其下方。
  const hasInstances = liveInstances(snap).length>0;
  const list = <InstanceList snap={snap} pending={pending} act={act} onRelease={(id,name)=>setConfirm({kind:'release',id,name})}/>;
  return <>
    <ColabAccountCard snap={snap} pending={pending} act={act}/>
    {hasInstances&&list}
    <div className="split">
      <StartCard snap={snap} pending={pending} act={act}/>
      <DeployCard snap={snap} pending={pending} onDeploy={()=>setConfirm({kind:'deploy'})}/>
    </div>
    {!hasInstances&&list}
    <Confirm open={confirm?.kind==='deploy'} title="新建 G4 并部署 H3？" confirmLabel="一键部署 H3"
      body={<p>新建一台 G4 实例，安装 MiniMax H3 并接入平台。会消耗 Colab 计算单元；已有实例保持不变。</p>}
      onCancel={()=>setConfirm(null)} onConfirm={()=>{setConfirm(null);void act('colab.deploy')}}/>
    <Confirm open={confirm?.kind==='release'} danger title={`释放「${confirm?.kind==='release'?confirm.name:''}」？`} confirmLabel="释放实例"
      body={<p>只释放这台实例，其他实例不受影响。请先保存需要保留的文件；临时磁盘和内核内存不保留。</p>}
      onCancel={()=>setConfirm(null)} onConfirm={()=>{const c=confirm;setConfirm(null);if(c?.kind==='release')void act('colab.release',{id:c.id})}}/>
  </>;
}

function ColabAccountCard({snap,pending,act}:Props){
  const a = snap.colab_account;
  const probing = pending==='colab.probe'||running(snap,'colab.probe');
  const st = accountStatus(a,probing);
  const planAuth = snap.google_plan_authorization;
  const authorizing = planAuth?.stage==='authorizing'||pending==='colab.plan_authorize'||running(snap,'colab.plan_authorize');
  const authError = snap.operations['colab.plan_authorize']?.error || (planAuth?.stage==='error'?planAuth.detail:undefined);
  return <Card title="Colab 权益" icon={<KeyRound size={14}/>} badge={st.text}
    actions={<Button size="sm" icon={<RefreshCw size={13} className={probing?'spin':''}/>} disabled={probing||!!pending||snap.google.stage!=='connected'} onClick={()=>act('colab.probe')}>{a&&a.status!=='unknown'?'重新检测':'检测'}</Button>}>
    {!a?<p className="muted small">后台尚未提供权益数据。</p>:<>
      {a.status==='error'&&<div className="error-block small" role="alert"><TriangleAlert size={15} aria-hidden="true"/><p>{a.detail||'权益检测失败'}</p></div>}
      <dl className="kv-list wide">
        <div className="kv"><dt>Colab 订阅</dt><dd>{tierLabel(a.subscription_tier).text}</dd></div>
        <div className="kv"><dt>Google AI 套餐</dt><dd className="kv-inline"><Dot tone={planLabel(a).tone}/>{planLabel(a).text}
          {a.google_ai_plan?.status!=='confirmed'&&<Button size="sm" variant="ghost" busy={authorizing} disabled={authorizing||!!pending||snap.google.stage!=='connected'} onClick={()=>act('colab.plan_authorize')}>套餐授权</Button>}</dd></div>
        <div className="kv"><dt>计算单元余额</dt><dd className="num">{a.paid_compute_units_balance==null?'—':`${points(a.paid_compute_units_balance)} CU`}</dd></div>
        <div className="kv"><dt>账号消耗速率</dt><dd className="num">{a.consumption_rate_hourly==null?'—':`${points(a.consumption_rate_hourly)} CU/小时`}<span className="muted"> · 全部实例合计</span></dd></div>
        <div className="kv"><dt>检测时间</dt><dd className="num muted">{a.checked_at?dateTime(a.checked_at):'—'}</dd></div>
      </dl>
      {authError&&<p className="hint is-error" role="alert">套餐授权未完成：{authError}</p>}
      {authorizing&&<div role="status"><p className="hint">{planAuth?.detail||'请在浏览器中完成套餐授权。'}</p><div className="actions">
        <Button size="sm" variant="ghost" onClick={()=>act('google.reopen')}>重新打开授权页</Button>
        <Button size="sm" variant="ghost" onClick={()=>act('google.cancel')}>取消授权</Button>
      </div></div>}
      {a.status==='ready'&&a.detail&&<p className="hint">{a.detail}</p>}
    </>}
  </Card>;
}

const order = (x:ColabAccelerator)=>x.eligible===true?0:x.eligible==null?1:2;

function StartCard({snap,pending,act}:Props){
  const a = snap.colab_account;
  const [choice,setChoice] = useState<string|null>(null);
  const list = [...(a?.eligible_accelerators??[])].sort((x,y)=>order(x)-order(y));
  const chosen = list.find(x=>acceleratorKey(x)===choice&&x.eligible!==false);
  const starting = pending==='colab.start'||running(snap,'colab.start');
  const error = snap.operations['colab.start']?.error;
  const blocked = snap.google.stage!=='connected'?'先连接 Google 账号。':snap.draining?'正在退出。':'';
  let body;
  if(!a) body = <p className="muted small">后台尚未提供可申请机型。</p>;
  else if(a.status==='loading') body = <p className="muted small">正在读取可申请机型…</p>;
  else if(a.status==='unknown') body = <p className="muted small">先检测 Colab 权益，再选择实例类型。</p>;
  else if(a.status==='error'&&!list.length) body = <p className="muted small">无法读取可申请机型，请重新检测。</p>;
  else if(!list.length) body = <p className="muted small">当前账号没有可申请的机型。</p>;
  else body = <div className="choice-grid" role="radiogroup" aria-label="实例类型">
    {list.map(x=>{const k=acceleratorKey(x);const on=k===choice;return <label key={k} className={'choice'+(on?' on':'')+(x.eligible===false?' off':'')}>
      <input type="radio" name="accelerator" value={k} checked={on} disabled={x.eligible===false||starting} onChange={()=>setChoice(k)}/>
      <span className="choice-icon">{x.variant==='CPU'?<Server size={14}/>:<Cpu size={14}/>}</span>
      <span className="choice-text"><span className="strong">{acceleratorText(x)}</span><span className="muted small">{x.variant} · {eligibilityText(x)}</span></span>
    </label>})}
  </div>;
  return <Card title="创建实例" icon={<Play size={14}/>} badge="空实例">
    {body}
    {chosen?.eligible==null&&chosen&&<p className="hint">资格未知，以 Colab 实际分配结果为准。</p>}
    {error&&<p className="hint is-error" role="alert">{error}</p>}
    <div className="actions">
      <Button variant="primary" icon={<Play size={14}/>} busy={starting} disabled={!chosen||starting||!!blocked||!!pending}
        onClick={()=>chosen&&act('colab.start',{accelerator:chosen.id,...(chosen.high_memory?{high_memory:true}:{})})}>{starting?'正在创建实例':'创建实例'}</Button>
    </div>
    <p className="hint">{blocked||'新建 Colab 空实例，不安装模型。部署视频模型请使用“一键部署 H3”。'}</p>
  </Card>;
}

function DeployCard({snap,pending,onDeploy}:{snap:Snapshot;pending:string|null;onDeploy:()=>void}){
  const g4 = g4Eligibility(snap.colab_account);
  const deploying = pending==='colab.deploy'||running(snap,'colab.deploy');
  const error = snap.operations['colab.deploy']?.error;
  const blocked = snap.google.stage!=='connected'?'先连接 Google 账号。':snap.draining?'正在退出。':g4===false?'权益目录显示 G4 不可申请。':'';
  return <Card title="一键部署 H3" icon={<Rocket size={14}/>} badge="新建 G4">
    <p className="state-line small">每次新建一台 G4，安装 MiniMax H3 并接入平台。已有实例保持不变。</p>
    <p className="kv-inline small"><Dot tone={g4===true?'ok':g4===false?'error':'off'}/>{g4===true?'G4 可申请':g4===false?'G4 无资格':'G4 资格未知，以实际分配为准'}</p>
    {error&&<p className="hint is-error" role="alert">{error}</p>}
    <div className="actions">
      <Button variant="primary" icon={<Rocket size={14}/>} busy={deploying} disabled={deploying||!!blocked||!!pending} onClick={onDeploy}>{deploying?'正在部署':'一键部署 H3'}</Button>
    </div>
    <p className="hint">{blocked||'H3 安装并通过检查后，实例才显示为就绪。'}</p>
  </Card>;
}

function InstanceList({snap,pending,onRelease}:Props&{onRelease:(id:string,name:string)=>void}){
  const list = snap.colab_instances;
  const live = (list??[]).filter(i=>i.status!=='released');
  return <Card title="实例" icon={<Server size={14}/>} badge={list?`${live.length} 台`:undefined}>
    {list===undefined?<p className="muted small">后台尚未提供实例列表。</p>
    :!live.length?<p className="muted small">没有实例。</p>
    :<ul className="instance-list">{live.map(i=>{const v=instanceView(i,snap,pending);return <li key={i.id} className="instance">
      <div className="instance-main">
        <div className="instance-title"><Dot tone={v.tone}/><span className="strong ellipsis">{i.name}</span><span className={'badge'+(i.purpose==='h3'?' badge-h3':'')}>{v.purposeText}</span><span className="badge">{i.gpu}</span></div>
        <div className="instance-meta muted small"><StatusPill tone={v.tone}>{v.label}</StatusPill>{i.node!=null&&<span className="num">节点 {i.node}</span>}<span className="num">启动 {dateTime(i.started_at)}</span></div>
        {i.detail&&<p className="small instance-detail">{i.detail}</p>}
        {v.releaseError&&<p className="hint is-error" role="alert">释放未完成：{v.releaseError}</p>}
      </div>
      <div className="instance-actions">
        <Button size="sm" variant="danger-ghost" icon={<Power size={13}/>} busy={v.releasing} disabled={!v.canRelease||!!pending} onClick={()=>onRelease(i.id,i.name)}>{v.releasing?'正在释放':'释放'}</Button>
      </div>
    </li>})}</ul>}
    <p className="hint">关闭 fmWorker 不会释放实例；只有点击释放才会停止。Google 的配额、断线和回收规则仍然适用。</p>
  </Card>;
}
