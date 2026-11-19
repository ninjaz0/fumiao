/** 未知值统一显示为「—」。只有后台给出真实 0 时才显示 0。 */
export const UNKNOWN = '—';

export function points(value:number|null|undefined, digits=2):string{
  if(value==null||!Number.isFinite(value)) return UNKNOWN;
  return value.toLocaleString('zh-CN',{maximumFractionDigits:digits});
}

export function dateTime(sec:number):string{
  return new Date(sec*1000).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
}
export function clock(sec:number):string{
  return new Date(sec*1000).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
}

export function minutesLabel(m:number):string{
  if(m%60===0) return `${m/60} 小时`;
  return `${m} 分钟`;
}

/** 剩余时间，例如「1 小时 12 分」；已过期返回「已到期」。 */
export function remaining(deadlineSec:number, nowMs=Date.now()):string{
  const diff = Math.round(deadlineSec - nowMs/1000);
  if(diff<=0) return '已到期';
  const h = Math.floor(diff/3600), m = Math.floor((diff%3600)/60);
  if(h) return `${h} 小时 ${m} 分`;
  if(m) return `${m} 分钟`;
  return '不到 1 分钟';
}

export function osLabel(os:string):string{
  if(os==='Darwin') return 'Apple 芯片 Mac';
  if(os==='Windows') return 'Windows';
  return os||UNKNOWN;
}

export function errorText(e:unknown):string{
  return String(e instanceof Error?e.message:e).replace(/^Error: /,'');
}
