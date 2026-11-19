import {RefreshCw, History, Copy, LogOut, Download, ArrowUpRight, Sun, Moon, Cloud, Power} from 'lucide-react';
import type {Method, Snapshot} from '../api';
import {clock, dateTime, osLabel, points} from '../lib/format';
import {Button, Card} from './ui';

type Act = (m:Method,p?:Record<string,unknown>)=>Promise<unknown>;

export function RecordsPage({snap,pending,act,onManage}:{snap:Snapshot;pending:string|null;act:Act;onManage:()=>void}){
  const refreshing = pending==='refresh'||!!snap.operations.refresh?.running;
  const copyLog = ()=>{void navigator.clipboard?.writeText(snap.events.map(e=>`[${clock(e.at)}] ${e.title}${e.detail?' — '+e.detail:''}`).join('\n'))};
  return <div className="page records">
    <div className="records-main">
      <header className="page-head"><h1>贡献记录</h1><span className="grow"/>
        <Button size="sm" icon={<RefreshCw size={14} className={refreshing?'spin':''}/>} disabled={refreshing} onClick={()=>act('refresh')}>刷新</Button></header>
      <div className="stats">
        <div className="stat"><small>累计贡献积分</small><strong className="num">{points(snap.earned)}</strong></div>
        <div className="stat"><small>钱包余额</small><strong className="num">{points(snap.balance,0)}</strong></div>
      </div>
      <p className="hint">成功并通过平台校验的任务，按非赠送积分部分的 70% 计入；本人任务不计；积分不可提现。</p>
      <Card className="table-card">
        {snap.history.length?<table className="table">
          <thead><tr><th scope="col">任务</th><th scope="col">资源</th><th scope="col">时间</th><th scope="col" className="r">积分</th></tr></thead>
          <tbody>{snap.history.map(row=><tr key={row.job}><td className="num">#{row.job}</td><td>{row.name}</td><td className="num muted">{dateTime(row.created)}</td><td className="num r strong">+{row.reward.toFixed(2)}</td></tr>)}</tbody>
        </table>:<div className="empty">
          <History size={26} aria-hidden="true"/>
          <h2>{snap.history_loaded?'还没有贡献记录':'记录尚未加载'}</h2>
          <p className="muted">{snap.history_loaded?'完成首个可结算任务后会显示在这里。':'请检查平台连接后刷新。'}</p>
          <Button size="sm" onClick={onManage}>管理资源</Button>
        </div>}
      </Card>
    </div>
    <section className="log-panel" aria-label="运行日志">
      <header><span className="strong">运行日志</span><span className="badge num">{snap.events.length} 条</span><span className="grow"/>
        <button className="icon-btn" aria-label="复制日志" title="复制日志" onClick={copyLog} disabled={!snap.events.length}><Copy size={14}/></button></header>
      <ol className="log">{snap.events.length?snap.events.slice(0,40).map((e,i)=><li key={i} className={'lv-'+e.level}>
        <time className="num">{clock(e.at)}</time><div><span>{e.title}</span>{e.detail&&<p>{e.detail}</p>}</div></li>)
        :<li className="muted">暂无运行记录</li>}</ol>
    </section>
  </div>;
}

export function SettingsPage({snap,pending,act,onColab}:{snap:Snapshot;pending:string|null;act:Act;onColab:()=>void}){
  const busy=!!pending; const dark=snap.settings.theme==='dark';
  return <div className="page settings">
    <header className="page-head"><h1>设置</h1></header>
    <Card>
      <div className="setting"><div><strong>外观</strong></div>
        <div className="segmented" role="radiogroup" aria-label="外观">
          <button role="radio" aria-checked={!dark} disabled={busy} onClick={()=>act('settings',{theme:'light'})}><Sun size={14}/>浅色</button>
          <button role="radio" aria-checked={dark} disabled={busy} onClick={()=>act('settings',{theme:'dark'})}><Moon size={14}/>深色</button>
        </div></div>
      <div className="setting"><div><strong>Colab 实例</strong><small>选择实例类型开始贡献、一键部署 H3、查看和释放实例。</small></div>
        <Button size="sm" icon={<Cloud size={14}/>} onClick={onColab}>前往 Colab</Button></div>
      <div className="setting"><div><strong>诊断记录</strong><small>导出运行状态，不含密码和登录凭据。</small></div>
        <Button size="sm" icon={<Download size={14}/>} disabled={busy} onClick={()=>act('diagnostics')}>导出</Button></div>
      <div className="setting"><div><strong>弗淼网页</strong><small>创作、排队和作品管理在网页完成。</small></div>
        <Button size="sm" icon={<ArrowUpRight size={14}/>} onClick={()=>act('open_platform')}>打开</Button></div>
      <div className="setting"><div><strong>退出软件</strong><small>完成当前任务后退出。已连接的 Colab 实例继续运行，云端模型继续接单。</small></div>
        <Button size="sm" icon={<Power size={14}/>} disabled={busy||snap.draining} onClick={()=>act('shutdown')}>{snap.draining?'正在退出':'退出 fmWorker'}</Button></div>
      <div className="setting"><div><strong>弗淼账号</strong><small>{snap.account?.nickname||snap.account?.name}{snap.account?.name&&snap.account.nickname?` · ${snap.account.name}`:''}</small></div>
        <Button size="sm" icon={<LogOut size={14}/>} disabled={busy} onClick={()=>act('logout')}>退出登录</Button></div>
    </Card>
    <p className="muted small about">fmWorker <span className="num">v{snap.version}</span> · {osLabel(snap.os)} · 关闭窗口后驻留托盘；退出不会释放 Colab 实例。</p>
  </div>;
}
