import type {ColabAccelerator, ColabAccount, ColabInstance, Snapshot} from '../api';
import type {Tone} from './status';

/** Colab 订阅档位（来自 Colab user-info 的 subscriptionTier）。不等于 Google AI 套餐。 */
const tierNames:Record<string,string> = {
  SUBSCRIPTION_TIER_NONE:'Colab 免费版', NONE:'Colab 免费版', FREE:'Colab 免费版',
  SUBSCRIPTION_TIER_PRO:'Colab Pro', PRO:'Colab Pro',
  SUBSCRIPTION_TIER_PRO_PLUS:'Colab Pro+', PRO_PLUS:'Colab Pro+', 'PRO+':'Colab Pro+',
};
export function tierLabel(tier:string|null|undefined):{text:string; known:boolean}{
  if(tier==null||tier==='') return {text:'未知',known:false};
  const name = tierNames[tier.toUpperCase()];
  return name?{text:name,known:true}:{text:`未识别档位（${tier}）`,known:false};
}

export function planLabel(a:ColabAccount):{text:string; tone:Tone; needsAuth:boolean}{
  const p = a.google_ai_plan;
  if(p?.status==='confirmed'&&(p.name||p.id)) return {text:p.name||p.id!,tone:'ok',needsAuth:false};
  if(p?.status==='authorization_required') return {text:'需要补充授权',tone:'paused',needsAuth:true};
  return {text:'套餐未确认',tone:'off',needsAuth:false};
}

export function accountStatus(a:ColabAccount|null|undefined, probing:boolean):{text:string; tone:Tone}{
  if(probing||a?.status==='loading') return {text:'检测中',tone:'work'};
  if(!a||a.status==='unknown') return {text:'未检测',tone:'off'};
  if(a.status==='error') return {text:'检测失败',tone:'error'};
  return {text:'已检测',tone:'ok'};
}

/** 机型选择的唯一键：同一加速器可能分普通/高内存两项。 */
export const acceleratorKey = (x:ColabAccelerator)=>`${x.id}${x.high_memory?':hm':''}`;
export function acceleratorText(x:ColabAccelerator){return x.label+(x.high_memory?' · 高内存':'')}
export function eligibilityText(x:ColabAccelerator){return x.eligible===true?'可申请':x.eligible===false?'无资格':'资格未知'}

/** G4 资格：只读目录中明确列出 false 时才阻止一键部署；未列出或 null 视为未知。 */
export function g4Eligibility(a:ColabAccount|null|undefined):boolean|null{
  const list = a?.eligible_accelerators?.filter(x=>x.id.toUpperCase()==='G4')??[];
  if(!list.length) return null;
  if(list.some(x=>x.eligible===true)) return true;
  if(list.every(x=>x.eligible===false)) return false;
  return null;
}

const instanceStatus:Record<string,[string,Tone]> = {
  requesting:['申请中','work'], allocating:['申请中','work'], connecting:['连接中','work'], deploying:['部署中','work'], installing:['安装中','work'],
  ready:['就绪','ok'], busy:['执行中','work'], idle:['就绪','ok'], offline:['离线','off'], disconnected:['未连接','off'],
  releasing:['释放中','work'], released:['已释放','off'], error:['故障','error'], unknown:['结果待核对','paused'],
};
export function instanceView(i:ColabInstance, s:Snapshot, pending:string|null){
  const [label,tone] = instanceStatus[i.status] ?? [i.status||'未知','off'];
  const releasing = i.status==='releasing' || pending==='colab.release:'+i.id
    || !!s.operations['colab.release:'+i.id]?.running || !!s.operations['colab.release.'+i.id]?.running;
  const releaseError = s.operations['colab.release:'+i.id]?.error || s.operations['colab.release.'+i.id]?.error;
  return {label:releasing&&i.status!=='releasing'?'正在释放':label, tone:releasing?'work' as Tone:tone, releasing,
    canRelease:!releasing&&i.status!=='released', releaseError,
    purposeText:i.purpose==='h3'?'H3 专用':'独立实例'};
}

export function liveInstances(s:Snapshot){return (s.colab_instances??[]).filter(i=>i.status!=='released')}
