import {useRef, type KeyboardEvent} from 'react';
import {Cloud, Globe, Pause, Play, RotateCw, Volume2, ChevronRight, ListChecks} from 'lucide-react';
import {kinds, type Kind, type Snapshot} from '../api';
import {googleView, resourceRole, resourceShort, resourceView, setupSteps} from '../lib/status';
import {points} from '../lib/format';
import {Dot, Button} from './ui';

export type Selection = 'setup'|'google'|Kind;
export const kindIcon = {breeze:Volume2, flow:Globe, colab:Cloud};

type Props = {
  snap:Snapshot; pending:string|null; selected:Selection; showSetup:boolean;
  onSelect:(s:Selection)=>void; onPrimary:(k:Kind)=>void; onOpenRecords:()=>void;
};

/**
 * 左侧控制栏（参考 EasyColab 左栏的「卡片 + 状态点 + 就地操作」）：
 * 账号 → 资源（每行带独立的开始/暂停按钮）→ 积分摘要。
 */
export function Rail({snap,pending,selected,showSetup,onSelect,onPrimary,onOpenRecords}:Props){
  const g = googleView(snap);
  const steps = setupSteps(snap); const done = steps.filter(s=>s.done).length;
  const listRef = useRef<HTMLDivElement>(null);

  function onKey(e:KeyboardEvent){
    if(e.key!=='ArrowDown'&&e.key!=='ArrowUp') return;
    const items=[...(listRef.current?.querySelectorAll<HTMLElement>('[data-sel]')??[])];
    const i=items.indexOf(document.activeElement as HTMLElement); if(i<0) return;
    e.preventDefault();
    const next=items[(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length];
    next.focus(); onSelect(next.dataset.sel as Selection);
  }

  return <aside className="rail" aria-label="账号与资源">
    <div className="rail-scroll" ref={listRef} onKeyDown={onKey}>
      {showSetup&&<button data-sel="setup" className={'rail-setup'+(selected==='setup'?' selected':'')} aria-current={selected==='setup'||undefined} onClick={()=>onSelect('setup')}>
        <ListChecks size={16} aria-hidden="true"/><span>开始使用</span><span className="grow"/><span className="num muted">{done}/{steps.length}</span>
        <span className="mini-bar" aria-hidden="true"><span style={{width:`${done/steps.length*100}%`}}/></span>
      </button>}

      <div className="rail-group-label" id="lbl-account">Google 账号</div>
      <button data-sel="google" aria-describedby="lbl-account" className={'rail-account'+(selected==='google'?' selected':'')} aria-current={selected==='google'||undefined} onClick={()=>onSelect('google')}>
        <span className="rail-account-top"><Globe size={15} aria-hidden="true"/><span className="ellipsis strong">{snap.google.email||(g.stage==='authorizing'?'等待授权…':'未连接')}</span><ChevronRight size={15} className="chev" aria-hidden="true"/></span>
        <span className="rail-svc"><Dot tone={g.colabTone}/>Colab 授权<span className="grow"/><span className="muted">{g.colabLabel}</span></span>
        <span className="rail-svc"><Dot tone={g.flowTone}/>Flow 会话<span className="grow"/><span className="muted">{g.flowLabel}</span></span>
      </button>

      <div className="rail-group-label">资源</div>
      <div className="rail-resources">
        {kinds.map(kind=>{
          const v = resourceView(snap,kind,pending); const r = snap.resources[kind]; const Icon = kindIcon[kind];
          const ActIcon = v.action==='pause'?Pause:v.action==='retry'?RotateCw:Play;
          return <div key={kind} className={'rail-res'+(selected===kind?' selected':'')+(r.stage==='unsupported'?' is-off':'')}>
            <button data-sel={kind} className="rail-res-main" aria-current={selected===kind||undefined} onClick={()=>onSelect(kind)}>
              <span className={'res-icon tone-'+v.tone}><Icon size={16} aria-hidden="true"/></span>
              <span className="rail-res-text">
                <span className="strong">{resourceShort[kind]}</span>
                <span className="rail-res-state"><Dot tone={v.tone}/><span className="ellipsis">{v.label}</span></span>
              </span>
            </button>
            {v.action!=='none'&&v.action!=='google'&&v.action!=='choose'&&<Button size="sm" variant={v.action==='pause'?'secondary':'ghost'} className="rail-res-act"
              busy={v.actionBusy} disabled={v.actionDisabled} aria-label={`${v.actionLabel} ${resourceShort[kind]}`} title={`${v.actionLabel}（${resourceRole[kind]}）`}
              icon={<ActIcon size={13} aria-hidden="true"/>} onClick={()=>onPrimary(kind)}/>}
            {v.progress!=null&&<span className={'rail-progress'+(v.progress==='indeterminate'?' indeterminate':'')} aria-hidden="true"><span style={typeof v.progress==='number'?{width:`${v.progress*100}%`}:undefined}/></span>}
          </div>;
        })}
      </div>
    </div>

    <button className="rail-points" onClick={onOpenRecords} aria-label="查看贡献记录">
      <span><small>累计贡献积分</small><strong className="num">{points(snap.earned)}</strong></span>
      <span><small>钱包余额</small><strong className="num">{points(snap.balance,0)}</strong></span>
    </button>
  </aside>;
}
