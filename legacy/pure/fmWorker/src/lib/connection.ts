export const CONNECTION_TIMEOUT_MS=30_000;
export type ConnectionPhase='connecting'|'connected'|'offline'|'timeout';
export function connectionPhase(online:boolean,elapsed:number,networkAvailable:boolean):ConnectionPhase{
  if(online)return 'connected';
  if(elapsed<CONNECTION_TIMEOUT_MS)return 'connecting';
  return networkAvailable?'timeout':'offline';
}
export const connectionText={connecting:'正在连接…',connected:'已连接',offline:'无网络，请检查网络连接',timeout:'连接超时，正在重试…'};
