import {Check, Globe, ExternalLink, ShieldCheck, RotateCw, X, LogIn, Unplug} from 'lucide-react';
import type {Snapshot, Method} from '../api';
import {flowTaskActive, canDisconnectGoogle, googleView, setupSteps} from '../lib/status';
import {Button, Card, StatusPill, Dot} from './ui';
import type {Selection} from './Rail';

type Act = (m:Method,p?:Record<string,unknown>)=>Promise<unknown>;

export function SetupView({snap,pending,act,onSelect,onDismiss}:{snap:Snapshot;pending:string|null;act:Act;onSelect:(s:Selection)=>void;onDismiss:()=>void}){
  const steps = setupSteps(snap); const g = googleView(snap);
  const next = steps.find(s=>!s.done&&!s.optional) ?? steps.find(s=>!s.done);
  return <div className="detail">
    <header className="detail-head"><div><h1>开始使用</h1><p className="muted">三步把这台电脑接入弗淼资源池。</p></div><span className="grow"/><Button variant="ghost" size="sm" onClick={onDismiss}>隐藏</Button></header>
    <ol className="steps">
      {steps.map((s,i)=>{
        const current = next?.id===s.id;
        return <li key={s.id} className={(s.done?'done ':'')+(current?'current':'')}>
          <span className="step-no" aria-hidden="true">{s.done?<Check size={14}/>:i+1}</span>
          <div className="step-body">
            <div className="step-title">{s.label}{s.optional&&<span className="badge">{s.id==='flow'?'使用 Flow 时':'使用云端资源时'}</span>}<span className="sr-only">{s.done?'（已完成）':'（未完成）'}</span></div>
            {s.id==='google'&&!s.done&&<div className="step-actions">
              {g.stage==='authorizing'
                ?<><StatusPill tone="work">等待浏览器授权</StatusPill><Button size="sm" onClick={()=>act('google.reopen')}>重新打开授权页</Button><Button size="sm" variant="ghost" onClick={()=>act('google.cancel')}>取消</Button></>
                :<Button variant="primary" size="sm" icon={<Globe size={14}/>} busy={pending==='google.connect'} disabled={!!pending} onClick={()=>act('google.connect')}>连接 Google</Button>}
            </div>}
            {s.id==='flow'&&!s.done&&<div className="step-actions">
              {snap.chrome&&!snap.chrome.connected?<Button size="sm" onClick={()=>onSelect('flow')}>安装 Chrome 扩展</Button>:<Button size="sm" disabled={flowTaskActive(snap)||snap.google.stage!=='connected'||g.flowOpening||!!pending} busy={g.flowOpening} onClick={()=>act('flow.connect')}>连接当前 Chrome 的 Flow</Button>}
              {snap.google.stage!=='connected'&&<span className="muted small">先完成第 1 步</span>}
            </div>}
            {s.id==='start'&&!s.done&&<div className="step-actions">
              <Button size="sm" onClick={()=>onSelect('flow')}>Flow</Button>
              <Button size="sm" onClick={()=>onSelect('colab')}>Colab</Button>
              <Button size="sm" disabled={snap.resources.breeze.stage==='unsupported'} onClick={()=>onSelect('breeze')}>Breeze</Button>
            </div>}
          </div>
        </li>;
      })}
    </ol>
    <p className="note"><ShieldCheck size={15} aria-hidden="true"/>{snap.os==='Windows'?'只用本地 Breeze 可以跳过 Google 连接。':'Google 长期凭据只保存在本机系统凭据库。'}</p>
  </div>;
}

export function GooglePanel({snap,pending,act,onDisconnect}:{snap:Snapshot;pending:string|null;act:Act;onDisconnect:()=>void}){
  const g = googleView(snap); const busy=!!pending;
  return <div className="detail">
    <header className="detail-head">
      <span className="res-icon lg tone-off"><Globe size={20} aria-hidden="true"/></span>
      <div><h1>Google 账号</h1><p className="muted ellipsis">{snap.google.email||'一个 Google 账号同时用于 Flow 和 Colab'}</p></div>
      <span className="grow"/>
      <StatusPill tone={g.colabTone}>{g.stage==='connected'?'已连接':g.stage==='authorizing'?'等待授权':g.stage==='error'?'需要重新连接':'未连接'}</StatusPill>
    </header>

    <Card className="action-card">
      <p className="state-line" aria-live="polite">{snap.google.detail||(g.stage==='connected'?'授权有效。':'点击连接后在浏览器中选择 Google 账号。')}</p>
      <div className="actions">
        {g.stage==='authorizing'?<>
          <Button variant="primary" busy disabled>等待授权</Button>
          <Button icon={<ExternalLink size={15}/>} disabled={busy} onClick={()=>act('google.reopen')}>重新打开授权页</Button>
          <Button variant="ghost" icon={<X size={15}/>} disabled={busy} onClick={()=>act('google.cancel')}>取消授权</Button>
        </>:g.stage==='connected'?<>
          {snap.google.flow!=='connected'&&<Button variant="primary" icon={<LogIn size={15}/>} busy={g.flowOpening} disabled={flowTaskActive(snap)||busy||g.flowOpening||!!(snap.chrome&&!snap.chrome.connected)} onClick={()=>act('flow.connect')}>连接 Flow</Button>}
          <Button icon={<RotateCw size={15}/>} disabled={busy} onClick={()=>act('google.connect')}>重新授权</Button>
          <span className="grow"/>
          <Button variant="danger-ghost" icon={<Unplug size={15}/>} disabled={!canDisconnectGoogle(snap,pending)} title="先暂停 Flow 并释放所有 Colab 实例，再断开账号" onClick={onDisconnect}>断开账号</Button>
        </>:<Button variant="primary" icon={<Globe size={15}/>} busy={pending==='google.connect'} disabled={busy} onClick={()=>act('google.connect')}>{g.stage==='error'?'重新连接 Google':'连接 Google'}</Button>}
      </div>
    </Card>

    <Card title="服务状态">
      <dl className="svc-list">
        <div><dt><Dot tone={g.colabTone}/>Colab 授权</dt><dd>{g.colabLabel}</dd><dd className="muted small">用于检测权益、申请和释放你自己的 Colab 实例</dd></div>
        <div><dt><Dot tone={g.flowTone}/>Flow 会话</dt><dd>{g.flowLabel}</dd><dd className="muted small">在 Flow 资源页安装连接助手，沿用当前 Chrome 用户</dd></div>
      </dl>
    </Card>
    <p className="note"><ShieldCheck size={15} aria-hidden="true"/>长期凭据保存在本机系统凭据库，不上传弗淼。</p>
  </div>;
}
