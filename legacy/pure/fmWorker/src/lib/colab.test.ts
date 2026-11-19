import {describe, expect, it} from 'vitest';
import type {ColabAccount, Snapshot} from '../api';
import {accountStatus, acceleratorKey, g4Eligibility, instanceView, planLabel, tierLabel} from './colab';

const account = (patch:Partial<ColabAccount>={}):ColabAccount=>({status:'ready',detail:'',checked_at:1,subscription_tier:null,
  google_ai_plan:{id:null,name:null,status:'unknown',source:null},paid_compute_units_balance:null,consumption_rate_hourly:null,
  eligible_accelerators:[],source:'colab.user-info',...patch});

describe('Colab 订阅与 Google AI 套餐分开显示',()=>{
  it('订阅档位：缺失为未知，未识别档位原样标出',()=>{
    expect(tierLabel(null)).toEqual({text:'未知',known:false});
    expect(tierLabel('SUBSCRIPTION_TIER_PRO_PLUS').text).toBe('Colab Pro+');
    expect(tierLabel('SUBSCRIPTION_TIER_ULTRA_X')).toEqual({text:'未识别档位（SUBSCRIPTION_TIER_ULTRA_X）',known:false});
  });
  it('套餐：只有 confirmed 才显示名称，不由 CU 余额推断',()=>{
    expect(planLabel(account({paid_compute_units_balance:500})).text).toBe('套餐未确认');
    expect(planLabel(account({google_ai_plan:{id:'g1-ultra',name:'Google AI Ultra',status:'confirmed',source:'x'}})).text).toBe('Google AI Ultra');
    expect(planLabel(account({google_ai_plan:{id:null,name:null,status:'authorization_required',source:null}})).needsAuth).toBe(true);
  });
  it('检测状态',()=>{
    expect(accountStatus(null,false).text).toBe('未检测');
    expect(accountStatus(account({status:'error'}),false).tone).toBe('error');
    expect(accountStatus(account(),true).text).toBe('检测中');
  });
});

describe('机型目录与 G4 资格',()=>{
  it('高内存与普通为不同选项',()=>{
    expect(acceleratorKey({id:'A100',label:'A100',variant:'GPU',eligible:true,high_memory:true})).not.toBe(acceleratorKey({id:'A100',label:'A100',variant:'GPU',eligible:true,high_memory:false}));
  });
  it('G4：未列出为未知，明确 false 才阻止',()=>{
    expect(g4Eligibility(account())).toBeNull();
    expect(g4Eligibility(account({eligible_accelerators:[{id:'G4',label:'G4',variant:'GPU',eligible:false,high_memory:null}]}))).toBe(false);
    expect(g4Eligibility(account({eligible_accelerators:[{id:'G4',label:'G4',variant:'GPU',eligible:null,high_memory:null}]}))).toBeNull();
    expect(g4Eligibility(account({eligible_accelerators:[{id:'g4',label:'G4',variant:'GPU',eligible:true,high_memory:null}]}))).toBe(true);
  });
});

describe('实例',()=>{
  const s = {operations:{}} as unknown as Snapshot;
  it('H3 实例标为专用，释放按实例进行',()=>{
    const v=instanceView({id:'i1',node:1,name:'x',purpose:'h3',gpu:'G4',status:'ready',detail:'',started_at:1},s,'colab.release:i1');
    expect(v.purposeText).toBe('H3 专用'); expect(v.releasing).toBe(true); expect(v.canRelease).toBe(false);
    const other=instanceView({id:'i2',node:2,name:'y',purpose:'notebook',gpu:'L4',status:'ready',detail:'',started_at:1},s,'colab.release:i1');
    expect(other.releasing).toBe(false); expect(other.purposeText).toBe('独立实例');
  });
  it('未知状态原样显示，不伪装就绪',()=>{
    expect(instanceView({id:'i',node:null,name:'x',purpose:'notebook',gpu:'L4',status:'weird',detail:'',started_at:1},s,null).label).toBe('weird');
    expect(instanceView({id:'i',node:null,name:'x',purpose:'notebook',gpu:'L4',status:'unknown',detail:'',started_at:1},s,null).label).toBe('结果待核对');
  });
});
