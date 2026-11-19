/**
 * fmWorker 前端与后台的契约。
 *
 * 资源与状态字段对应本机后台；贡献限制已移除。
 * Colab 权益（colab_account）与多实例（colab_instances）由 Colab 与模型节点接口提供。
 * 标记为「提议字段」的属性后台目前不返回；界面在缺失时隐藏或显示未知占位，绝不填假值。
 */
import {invoke} from '@tauri-apps/api/core';

export type Kind = 'breeze'|'flow'|'colab';
export const kinds:Kind[] = ['breeze','flow','colab'];

export type Resource = {
  kind:Kind; enabled:boolean; stage:string; detail?:string; node?:number;
  current_job?:number|null; available?:boolean;
  /** 0–1 或 0–100；仅在后台给出时显示确定进度，否则显示不确定进度。 */
  progress?:number;
};

export type ColabSettings = {idle_minutes:number; max_runtime_minutes:number; drive_cache:boolean; gpu:string};

/** Colab 权益目录中的一项。eligible=null 表示资格未知（以实际分配为准）。 */
export type ColabAccelerator = {id:string; label:string; variant:'CPU'|'GPU'|'TPU'; eligible:boolean|null; high_memory:boolean|null};
/** 只读探测得到的账号权益。Google AI 套餐与 Colab 订阅分开；缺失为 null，0 就是 0。 */
export type ColabAccount = {
  status:'unknown'|'loading'|'ready'|'error'; detail:string; checked_at:number|null;
  subscription_tier:string|null;
  google_ai_plan:{id:string|null; name:string|null; status:'unknown'|'confirmed'|'authorization_required'; source:string|null};
  paid_compute_units_balance:number|null; consumption_rate_hourly:number|null;
  eligible_accelerators:ColabAccelerator[]; source:string|null;
};
/** fmWorker 创建的 Colab 实例。purpose=h3 的实例只执行模型任务，仅接入模型工作队列。 */
export type ColabInstance = {id:string; node:number|null; name:string; purpose:'compute'|'notebook'|'h3'; gpu:string; status:string; detail:string; started_at:number; project_id?:string|null};

export type Snapshot = {
  version:string; os:string;
  account?:{name:string; nickname:string; id:number}|null;
  site:string;
  resources:Record<Kind,Resource>;
  google:{stage?:string; email?:string; detail?:string; flow?:string};
  google_plan_authorization?:{stage?:string; detail?:string};
  chrome?:{prepared:boolean;connected:boolean;stage:string;version:string;client_version?:string;extension_id?:string;folder?:string;distribution?:string};
  earned:number|null; balance:number|null; history_loaded?:boolean;
  history:{job:number; name:string; reward:number; created:number}[];
  events:{at:number; title:string; detail:string; level:string}[];
  operations:Record<string,{running:boolean; error?:string}>;
  draining:boolean; can_quit:boolean;
  /** 旧版单实例字段，保留类型兼容；界面以 colab_instances 为准。 */
  active_colab?:{started_at:number; deadline:number; settings:ColabSettings; meter_basis?:unknown}|null;
  /** theme 之外的旧 Colab 设置（GPU/缓存/空闲释放/最长运行）界面不再提供。 */
  settings:{theme:string; drive_cache?:boolean; gpu?:string; idle_minutes?:number; max_runtime_minutes?:number};
  /** 账号权益（只读探测）。undefined/null 表示后台尚未提供。 */
  colab_account?:ColabAccount|null;
  /** 已创建的实例；undefined 表示后台尚未提供列表（不是“没有实例”）。 */
  colab_instances?:ColabInstance[];
};

/** 后台接受的 RPC 方法（见 runtime/service.py dispatch）。 */
export type Method =
  | 'status' | 'login' | 'logout' | 'refresh' | 'open_platform'
  | 'google.connect' | 'google.reopen' | 'google.cancel' | 'google.disconnect'
  | 'flow.connect' | 'chrome.prepare' | 'chrome.open_extensions' | 'chrome.reveal'
  | 'resource.start' | 'resource.pause'
  | 'pause_all' | 'shutdown'
  | 'colab.probe' | 'colab.plan_authorize' | 'colab.start' | 'colab.deploy' | 'colab.release'
  | 'settings' | 'diagnostics';

export interface Client {
  readonly demo:boolean;
  call<T=unknown>(method:Method, params?:Record<string,unknown>):Promise<T>;
}

/** 真实后台：Tauri IPC，开发时回退到本机 bridge HTTP。与 current/src/api.ts 的 rpc 相同。 */
export const realClient:Client = {
  demo:false,
  async call<T>(method:Method, params:Record<string,unknown>={}):Promise<T>{
    if('__TAURI_INTERNALS__' in window) return method==='shutdown'?invoke<T>('quit_app'):invoke<T>('rpc',{method,params});
    const response = await fetch('http://127.0.0.1:18431/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,params})});
    const value = await response.json();
    if(value.error) throw new Error(value.error);
    return value.result as T;
  }
};

/** 兼容旧调用方式。 */
export const rpc = <T=unknown>(method:string, params:Record<string,unknown>={}) => realClient.call<T>(method as Method, params);

/** 界面仍会写入的 settings 字段。Colab 不再设置空闲释放或最长运行。 */
export const settingOptions = {
  theme:['light','dark'] as const
};
