import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const s=fs.readFileSync(new URL('../static/studio.js',import.meta.url),'utf8');
const section=(start,end)=>s.slice(s.indexOf(start),s.indexOf(end,s.indexOf(start)));
const visible='flow:omni-1.2-flash-8s-landscape',hidden='flow:veo-3.1-fast-8s-landscape';
const state={workspaces:[],images:{configured:true},model_policy:{enabled:{[visible]:true,[hidden]:false}},
 model_catalog:{[visible]:{kind:'video',label:'Omni 1.2 Flash'},[hidden]:{kind:'video',label:'Veo Fast',hidden:true}},
 model_groups:{[visible]:{kind:'video',label:'Omni 1.2 Flash',models:[visible]}},
 pricing:{revision:4,items:[{key:visible+'|native',model:visible,kind:'video',label:'Omni 1.2 Flash',amount:1},{key:hidden+'|native',model:hidden,kind:'video',label:'Veo Fast',amount:7}]}};
let submitted;const form={querySelector:()=>({}),querySelectorAll:()=>[{dataset:{price:visible+'|native'},value:'3'}]};
const c={state,esc:v=>v,document:{querySelector:()=>form},req:async(_,body)=>{submitted=body},refresh:async()=>{},notify:()=>{}};
vm.createContext(c);
vm.runInContext(section('let modelPolicyBusy=false','function bindModelSettings('),c);
vm.runInContext(section('function pricesView()','function creditAdjustment('),c);
assert.match(c.modelSettingsView(),/Omni 1.2 Flash/);
assert.doesNotMatch(c.modelSettingsView(),/Veo Fast/);
assert.match(c.pricesView(),/Omni 1.2 Flash/);
assert.doesNotMatch(c.pricesView(),/Veo Fast|Flow · 图片/);
c.bindCreditSettings();await form.onsubmit({preventDefault(){}});
assert.equal(submitted.expected_revision,4);
assert.equal(submitted.values[visible+'|native'],3);
assert.equal(submitted.values[hidden+'|native'],7);
console.log('PASS hidden settings/prices, no empty image group and preservation of hidden model prices');
