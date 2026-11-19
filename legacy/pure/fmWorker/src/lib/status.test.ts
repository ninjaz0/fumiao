import {describe, expect, it} from 'vitest';
import type {Snapshot} from '../api';
import {flowTaskActive, canDisconnectGoogle, googleView, overall, resourceView, setupSteps} from './status';
import {points, remaining} from './format';

function snap(patch:Partial<Snapshot>={}):Snapshot{
  const r=(kind:'breeze'|'flow'|'colab')=>({kind,enabled:false,stage:'disconnected'});
  return {version:'0.1.0',os:'Darwin',account:{name:'t',nickname:'t',id:1},site:'',resources:{breeze:{...r('breeze'),stage:'unsupported'},flow:r('flow'),colab:r('colab')},
    google:{stage:'connected',flow:'connected'},earned:null,balance:null,history:[],events:[],operations:{},draining:false,can_quit:true,
    settings:{theme:'light',drive_cache:true,gpu:'G4',idle_minutes:15,max_runtime_minutes:120},...patch};
}

describe('resourceView',()=>{
  it('Colab 部署时 Flow 仍可独立暂停',()=>{
    const s=snap({resources:{breeze:{kind:'breeze',enabled:false,stage:'unsupported'},flow:{kind:'flow',enabled:true,stage:'ready'},colab:{kind:'colab',enabled:true,stage:'preparing',progress:42}},operations:{'colab.start':{running:true}}});
    const flow=resourceView(s,'flow',null), colab=resourceView(s,'colab',null);
    expect(flow.action).toBe('pause'); expect(flow.actionDisabled).toBe(false);
    expect(colab.action).toBe('pause'); expect(colab.actionDisabled).toBe(false);
    expect(colab.progress).toBeCloseTo(.42);
  });
  it('未启用且正在准备时禁用开始',()=>{
    const s=snap({operations:{'flow.start':{running:true}}});
    const v=resourceView(s,'flow',null); expect(v.actionDisabled).toBe(true); expect(v.actionBusy).toBe(true); expect(v.progress).toBe('indeterminate');
  });
  it('未连接 Google 时引导连接，Breeze 不受影响',()=>{
    const s=snap({google:{},os:'Windows',resources:{breeze:{kind:'breeze',enabled:false,stage:'disconnected'},flow:{kind:'flow',enabled:false,stage:'disconnected'},colab:{kind:'colab',enabled:false,stage:'disconnected'}}});
    expect(resourceView(s,'colab',null).action).toBe('google');
    expect(resourceView(s,'breeze',null).action).toBe('start');
  });
  it('暂停与错误状态的恢复动作',()=>{
    const s=snap({resources:{breeze:{kind:'breeze',enabled:false,stage:'unsupported'},flow:{kind:'flow',enabled:false,stage:'paused'},colab:{kind:'colab',enabled:false,stage:'error',detail:'x'}}});
    expect(resourceView(s,'flow',null).action).toBe('resume');
    const c=resourceView(s,'colab',null); expect(c.action).toBe('choose'); expect(c.error).toBe('x');
    expect(resourceView(s,'breeze',null).actionDisabled).toBe(true);
  });
  it('排空时禁用全部主操作',()=>{
    const s=snap({draining:true}); expect(resourceView(s,'flow',null).actionDisabled).toBe(true);
  });
  it('释放单台 Colab 实例不等于暂停资源',()=>{
    const s=snap({operations:{'colab.release:i1':{running:true}}}); expect(resourceView(s,'colab',null).pausing).toBe(false);
  });
});

describe('未知与真实零值',()=>{
  it('null 显示占位，0 显示 0',()=>{expect(points(null)).toBe('—');expect(points(0)).toBe('0')});
  it('剩余时间',()=>{expect(remaining(100,200_000)).toBe('已到期');expect(remaining(3600+600,0)).toBe('1 小时 10 分')});
});

describe('google 与整体状态',()=>{
  it('授权中/取消后',()=>{
    expect(googleView(snap({google:{stage:'authorizing'}})).colabLabel).toBe('等待浏览器授权');
    expect(googleView(snap({google:{stage:'error'}})).stage).toBe('error');
  });
  it('离线优先显示',()=>{expect(overall(snap(),false).label).toBe('后台未连接')});
  it('引导步骤',()=>{expect(setupSteps(snap({google:{}})).filter(s=>s.done).length).toBe(0)});
});

describe('真实后台整合边界',()=>{
  it('准备中不能显示成已经贡献或可接单',()=>{
    const s=snap();s.resources.colab={kind:'colab',enabled:true,stage:'preparing'};
    expect(overall(s,true)).toEqual({label:'准备中 · 1 项',tone:'work'});
  });
  it('暂停中的任务不能再次启动',()=>{
    const s=snap();s.resources.flow={kind:'flow',enabled:false,stage:'busy',current_job:42};
    expect(resourceView(s,'flow',null).actionDisabled).toBe(true);
    expect(resourceView(s,'flow',null).label).toBe('完成后暂停');
  });
  it('已有实例时仍可新建（多实例），开始贡献需要先选择实例类型',()=>{
    const s=snap({colab_instances:[{id:'i1',node:1,name:'G4 · H3',purpose:'h3',gpu:'G4',status:'ready',detail:'',started_at:1}]});
    const v=resourceView(s,'colab',null);
    expect(v.action).toBe('choose'); expect(v.actionDisabled).toBe(false);
  });
  it('有未释放实例时不能断开 Google',()=>{
    const s=snap({colab_instances:[{id:'i1',node:1,name:'x',purpose:'notebook',gpu:'L4',status:'ready',detail:'',started_at:1}]});
    expect(canDisconnectGoogle(s,null)).toBe(false);
    s.colab_instances![0].status='released'; expect(canDisconnectGoogle(s,null)).toBe(true);
  });
  it('Flow组件准备中不声称已打开登录窗口',()=>{
    const s=snap({google:{stage:'connected'},operations:{'flow.connect':{running:true}}});
    s.resources.flow.stage='preparing';expect(googleView(s).flowLabel).toBe('准备连接组件');
  });
  it('本地Breeze用户可以跳过Google引导',()=>{
    const s=snap({os:'Windows',google:{}});s.resources.breeze={kind:'breeze',stage:'ready',enabled:true};
    expect(setupSteps(s).some(step=>!step.done&&!step.optional)).toBe(false);
  });
  it('断开Google前必须停止云端资源',()=>{
    const s=snap();s.resources.flow.enabled=true;expect(canDisconnectGoogle(s,null)).toBe(false);
    s.resources.flow.enabled=false;s.resources.breeze.enabled=true;expect(canDisconnectGoogle(s,null)).toBe(true);
  });
});

it('Flow 执行任务期间不能重新登录，包括暂停后的排空阶段',()=>{
  const s=snap();
  expect(flowTaskActive(s)).toBe(false);
  s.resources.flow.current_job=42;
  expect(flowTaskActive(s)).toBe(true);
  s.resources.flow.current_job=null;s.resources.flow.stage='busy';
  expect(flowTaskActive(s)).toBe(true);
});

it('未安装扩展时指向安装向导，已启用资源仍能暂停',()=>{
  const s=snap({chrome:{prepared:false,connected:false,stage:'not_installed',version:'0.3.0'}});
  expect(resourceView(s,'flow',null).action).toBe('extension');
  expect(googleView(s).flowLabel).toBe('扩展未连接');
  s.resources.flow.enabled=true;s.resources.flow.stage='busy';
  expect(resourceView(s,'flow',null).action).toBe('pause');
});
