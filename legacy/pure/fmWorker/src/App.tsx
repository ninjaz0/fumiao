import {useCallback, useEffect, useMemo, useState, type ReactNode} from 'react';
import {Pause, Sun, Moon, X, LayoutGrid, History, Settings, LoaderCircle, WifiOff} from 'lucide-react';
import {kinds, type Client, type Kind} from './api';
import {useBackend} from './lib/useBackend';
import {anyEnabled, anyOperation, overall, resourceView, setupSteps} from './lib/status';
import {osLabel} from './lib/format';
import {connectionText} from './lib/connection';
import {Button, Confirm, Dot, Mark, StatusPill} from './components/ui';
import {Rail, type Selection} from './components/Rail';
import {ResourceDetail} from './components/ResourceDetail';
import {GooglePanel, SetupView} from './components/AccountViews';
import {RecordsPage, SettingsPage} from './components/Pages';
import {Login} from './components/Login';

type Page = 'console'|'records'|'settings';
const tabs:{id:Page;label:string;Icon:typeof LayoutGrid}[] = [
  {id:'console',label:'控制台',Icon:LayoutGrid},{id:'records',label:'记录',Icon:History},{id:'settings',label:'设置',Icon:Settings}
];
const SETUP_KEY='fmworker.setupHidden';

export default function App({client,subscribe,demoSlot}:{client:Client;subscribe?:(fn:()=>void)=>()=>void;demoSlot?:ReactNode}){
  const {snap,online,phase,retry,pending,error,clearError,act} = useBackend(client,subscribe);
  const [page,setPage] = useState<Page>('console');
  const [sel,setSel] = useState<Selection|null>(null);
  const [setupHidden,setSetupHidden] = useState(()=>localStorage.getItem(SETUP_KEY)==='1');
  const [confirm,setConfirm] = useState<null|'disconnect'>(null);

  const theme = snap?.settings.theme==='dark'?'dark':'light';
  useEffect(()=>{document.documentElement.dataset.theme=theme},[theme]);

  // 引导只在首次使用时出现：Google 未连接，或从未有资源接入过平台（没有节点编号）。重开后暂停不算首次。
  const firstRun = !!snap && (snap.google.stage!=='connected' || !kinds.some(k=>snap.resources[k].node||snap.resources[k].enabled));
  const setupOpen = !!snap && firstRun && !setupHidden && setupSteps(snap).some(s=>!s.done&&!s.optional);
  const selected:Selection = useMemo(()=>{
    if(sel && !(sel==='setup'&&!setupOpen)) return sel;
    if(!snap) return 'flow';
    if(setupOpen) return 'setup';
    const r = snap.resources;
    return kinds.find(k=>r[k].stage==='error') ?? kinds.find(k=>r[k].stage==='busy') ?? kinds.find(k=>r[k].enabled) ?? ((snap.colab_instances??[]).some(i=>i.status!=='released')?'colab':'flow');
  },[sel,snap,setupOpen]);

  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{
      if(!(e.metaKey||e.ctrlKey)||e.altKey) return;
      const i=['1','2','3'].indexOf(e.key); if(i>=0){e.preventDefault();setPage(tabs[i].id)}
    };
    window.addEventListener('keydown',onKey); return ()=>window.removeEventListener('keydown',onKey);
  },[]);

  const onPrimary = useCallback((kind:Kind)=>{
    if(!snap) return;
    const v = resourceView(snap,kind,pending);
    if(v.actionDisabled) return;
    if(v.action==='google'){setPage('console');setSel('google');return}
    if(v.action==='extension'){setPage('console');setSel('flow');return}
    if(v.action==='choose'){setPage('console');setSel('colab');return}
    if(v.action==='pause') void act('resource.pause',{kind});
    else if(v.action!=='none') void act('resource.start',{kind});
  },[snap,pending,act]);

  const select = (s:Selection)=>{setSel(s);setPage('console')};
  const hideSetup = ()=>{localStorage.setItem(SETUP_KEY,'1');setSetupHidden(true);setSel(null)};

  const demoBanner = client.demo && <div className="demo-banner" role="note">演示模式 · 全部数据为本地模拟，不连接弗淼、Google 或 GPU</div>;

  if(!snap) return <div className="app"><div className="boot">{demoBanner}<Mark size={36}/><p className="muted" role="status">
    {phase==='connecting'?<LoaderCircle size={14} className="spin"/>:<WifiOff size={14}/>} {connectionText[phase]}</p>
    {phase!=='connecting'&&<Button onClick={()=>void retry()}>重新连接</Button>}</div>{demoSlot}</div>;

  if(!snap.account) return <div className="app">{demoBanner}
    {error&&<div className="alert" role="alert"><span>{error}</span><button aria-label="关闭提示" onClick={clearError}><X size={15}/></button></div>}
    <Login online={online} pending={pending} act={act}/>{demoSlot}</div>;

  const ov = !online&&phase==='connecting'?{label:'重新连接中',tone:'work' as const}:overall(snap,online);
  const enabled = anyEnabled(snap);
  const pauseAllBusy = pending==='pause_all'||!!snap.operations.pause_all?.running;
  const latest = snap.events[0];

  return <div className="app">
    <header className="topbar">
      <div className="brand"><Mark/><span>fmWorker</span></div>
      <nav className="tabs" aria-label="主导航">
        {tabs.map(t=><button key={t.id} className="tab" aria-current={page===t.id?'page':undefined} onClick={()=>setPage(t.id)} title={`${t.label}（Ctrl/⌘+${tabs.indexOf(t)+1}）`}><t.Icon size={15} aria-hidden="true"/>{t.label}</button>)}
      </nav>
      <span className="grow"/>
      <StatusPill tone={ov.tone}>{ov.label}</StatusPill>
      <Button size="sm" icon={<Pause size={14}/>} busy={pauseAllBusy} disabled={!enabled||!!pending||snap.draining} onClick={()=>act('pause_all')}>全部暂停</Button>
      <button className="icon-btn" aria-label={theme==='dark'?'切换到浅色':'切换到深色'} title={theme==='dark'?'浅色':'深色'} disabled={!!pending}
        onClick={()=>act('settings',{theme:theme==='dark'?'light':'dark'})}>{theme==='dark'?<Sun size={16}/>:<Moon size={16}/>}</button>
    </header>
    {demoBanner}
    {!online&&<div className="alert warn" role="status">{phase==='connecting'?<LoaderCircle size={15} className="spin"/>:<WifiOff size={15}/>}<span>{connectionText[phase]} · 以下为上一次读取的状态。</span>{phase!=='connecting'&&<Button size="sm" onClick={()=>void retry()}>重新连接</Button>}</div>}
    {error&&<div className="alert" role="alert"><span>{error}</span><button aria-label="关闭提示" onClick={clearError}><X size={15}/></button></div>}
    {snap.draining&&<div className="alert info" role="status"><LoaderCircle size={15} className="spin"/><span>{snap.can_quit?'任务已完成，可以退出。Colab 实例继续运行，云端模型继续接单。':'正在等待当前任务完成，完成后退出。已连接的 Colab 实例继续运行。'}</span></div>}

    <div className="body">
      <Rail snap={snap} pending={pending} selected={page==='console'?selected:('' as Selection)} showSetup={setupOpen}
        onSelect={select} onPrimary={onPrimary} onOpenRecords={()=>setPage('records')}/>
      <main className="main" id="main">
        {page==='console'&&<>
          {selected==='setup'&&<SetupView snap={snap} pending={pending} act={act} onSelect={select} onDismiss={hideSetup}/>}
          {selected==='google'&&<GooglePanel snap={snap} pending={pending} act={act} onDisconnect={()=>setConfirm('disconnect')}/>}
          {(kinds as Selection[]).includes(selected)&&<ResourceDetail snap={snap} kind={selected as Kind} pending={pending} act={act} onPrimary={onPrimary}/>}
        </>}
        {page==='records'&&<RecordsPage snap={snap} pending={pending} act={act} onManage={()=>setPage('console')}/>}
        {page==='settings'&&<SettingsPage snap={snap} pending={pending} act={act} onColab={()=>select('colab')}/>}
      </main>
    </div>

    <footer className="statusbar">
      <span className="sb-item"><Dot tone={online?'ok':'error'}/>{online?(anyOperation(snap)?'后台处理中':'后台已连接'):'后台未连接'}</span>
      {latest&&<span className={'sb-item sb-event ellipsis'+(latest.level==='error'?' is-error':'')} title={latest.detail||latest.title}>{latest.title}{latest.detail?' · '+latest.detail:''}</span>}
      <span className="grow"/>
      <span className="sb-item muted">{snap.account.nickname||snap.account.name}</span>
      <span className="sb-item muted">{osLabel(snap.os)} · <span className="num">v{snap.version}</span></span>
    </footer>

    <Confirm open={confirm==='disconnect'} danger title="断开 Google 账号？" confirmLabel="断开"
      body={<p>删除本机保存的 Google 凭据与 Flow 会话。需先暂停 Flow 并释放所有 Colab 实例；断开后需要重新授权。</p>}
      onCancel={()=>setConfirm(null)} onConfirm={()=>{setConfirm(null);void act('google.disconnect')}}/>
    {demoSlot}
  </div>;
}
