import {useCallback, useEffect, useRef, useState} from 'react';
import type {Client, Method, Snapshot} from '../api';
import {errorText} from './format';
import {connectionPhase,CONNECTION_TIMEOUT_MS,type ConnectionPhase} from './connection';

export const POLL_MS = 2500;

export type Backend = {
  /** null：尚未从后台取得任何快照（真实模式下不渲染虚构内容）。 */
  snap:Snapshot|null;
  online:boolean;
  phase:ConnectionPhase;
  retry:()=>Promise<void>;
  /** 前端正在等待返回的 RPC，形如 "resource.pause:flow"；用于按钮即时反馈。 */
  pending:string|null;
  error:string;
  clearError:()=>void;
  refresh:()=>Promise<void>;
  act:<T=unknown>(method:Method, params?:Record<string,unknown>)=>Promise<T|undefined>;
};

export function useBackend(client:Client, subscribe?:(fn:()=>void)=>()=>void):Backend{
  const [snap,setSnap] = useState<Snapshot|null>(null);
  const [online,setOnline] = useState(false);
  const [pending,setPending] = useState<string|null>(null);
  const [error,setError] = useState('');
  const alive = useRef(true);
  const onlineRef = useRef(false);
  const retryStarted = useRef(Date.now());
  const [clock,setClock]=useState(Date.now());
  const active=useRef<Promise<void>|null>(null);

  const refresh = useCallback(()=>{
    if(active.current)return active.current;
    const task=(async()=>{
      let timeout:number|undefined;
      try{
        const data=await Promise.race([client.call<Snapshot>('status'),new Promise<never>((_,reject)=>{
          timeout=window.setTimeout(()=>reject(new Error('连接超时')),CONNECTION_TIMEOUT_MS);
        })]);
        if(alive.current){setSnap(data);onlineRef.current=true;setOnline(true)}
      }catch{
        if(alive.current){
          if(onlineRef.current)retryStarted.current=Date.now();
          onlineRef.current=false;setOnline(false);
        }
      }finally{if(timeout!==undefined)window.clearTimeout(timeout)}
    })();
    active.current=task.finally(()=>{active.current=null});
    return active.current;
  },[client]);

  const retry=useCallback(async()=>{
    retryStarted.current=Date.now();setClock(Date.now());await refresh();
  },[refresh]);

  useEffect(()=>{
    alive.current = true; void refresh();
    const timer = window.setInterval(refresh,POLL_MS);
    const ticker=window.setInterval(()=>setClock(Date.now()),1000);
    const off = subscribe?.(()=>void refresh());
    return ()=>{alive.current=false;clearInterval(timer);clearInterval(ticker);off?.()};
  },[refresh,subscribe]);

  const act = useCallback(async<T,>(method:Method, params:Record<string,unknown>={})=>{
    const key = method+(typeof params.kind==='string'?':'+params.kind:typeof params.id==='string'?':'+params.id:'');
    setPending(key); setError('');
    try{const result = await client.call<T>(method,params); await refresh(); return result}
    catch(e){setError(errorText(e)); return undefined}
    finally{if(alive.current) setPending(null)}
  },[client,refresh]);

  const phase=connectionPhase(online,clock-retryStarted.current,navigator.onLine!==false);
  return {snap,online,phase,retry,pending,error,clearError:()=>setError(''),refresh,act};
}
