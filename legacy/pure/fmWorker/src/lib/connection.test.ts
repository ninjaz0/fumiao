import {describe,it,expect} from 'vitest';
import {connectionPhase,CONNECTION_TIMEOUT_MS} from './connection';
describe('启动连接等待',()=>{
  it('30 秒内保持正在连接，包括网络断开时',()=>{
    expect(connectionPhase(false,0,true)).toBe('connecting');
    expect(connectionPhase(false,CONNECTION_TIMEOUT_MS-1,false)).toBe('connecting');
  });
  it('30 秒后区分网络断开和连接超时',()=>{
    expect(connectionPhase(false,CONNECTION_TIMEOUT_MS,true)).toBe('timeout');
    expect(connectionPhase(false,CONNECTION_TIMEOUT_MS,false)).toBe('offline');
  });
  it('连接成功和重新计时能够退出超时状态',()=>{
    expect(connectionPhase(true,60_000,true)).toBe('connected');
    expect(connectionPhase(false,0,true)).toBe('connecting');
  });
});
