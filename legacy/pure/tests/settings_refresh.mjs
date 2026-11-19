import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../static/studio.js', import.meta.url), 'utf8');
function section(start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1);
  const to = source.indexOf(end, from);
  assert.notEqual(to, -1);
  return source.slice(from, to);
}
const refreshSource = section('function refresh(force = false)', '\nfunction sync(');
const baseState = () => ({workspace_id:1, workspaces:[{id:1,name:'默认团队'}], me:{id:1},
  jobs:[], assets:[], favorites:[], model_policy:{revision:1}, images:{}, nodes:[], users:[], invites:[],
  used:100, reserved:0, quota:20000, disk_free:90000});
const deferred = () => { let resolve; const promise = new Promise(r => {resolve=r}); return {promise,resolve}; };
const settle = async () => { for (let i=0; i<8; i++) await Promise.resolve(); };
function harness() {
  const pending = [], errors = [];
  const trigger = {innerHTML:'old',title:'old',attributes:{},setAttribute(k,v){this.attributes[k]=v}};
  const c = {state:baseState(), workspaceId:'1', stateReceivedAt:0, refreshing:null, refreshForced:false,
    refs:[], parent:null, page:'settings', settingsTab:'profile', detailId:null,imageId:null,
    modal:{open:false}, menuKind:null, modelPolicyBusy:false,
    document:{querySelector:selector => selector === '.workspace-switch' ? trigger : null},
    workspaceButtonElement:()=>({innerHTML:'updated',title:'new',getAttribute:()=>'切换工作区，当前新团队'}),
    paintTiming(){},scheduleEstimate(){},paintAccount(){},syncImageAvailability(){},paintFavorites(){},
    closeMenu(){c.menuKind=null},renderCount:0,renderPage(){c.renderCount++},
    notify:message => errors.push(message),
    req:()=>{const d=deferred();pending.push(d);return d.promise},
  };
  vm.createContext(c); vm.runInContext(refreshSource,c);
  return {c,pending,trigger,errors};
}

// A mutation finishing during a slow poll must get a newer snapshot, and its
// caller must wait for that snapshot rather than falsely reporting completion.
{
  const {c,pending,errors} = harness();
  const original = c.state;
  const poll = c.refresh();
  const forced = c.refresh(true);
  assert.equal(forced,poll);
  let finished=false; forced.then(()=>{finished=true});
  pending[0].resolve({...baseState(),jobs:[{id:1,status:'queued'}]});
  await settle();
  assert.equal(c.state,original,'stale response must not be applied');
  assert.equal(pending.length,2);
  assert.equal(finished,false);
  const latest={...baseState(),jobs:[{id:1,status:'done'}]};
  pending[1].resolve(latest); await forced;
  assert.equal(c.state,latest); assert.equal(c.renderCount,1);
  assert.equal(c.refreshing,null); assert.deepEqual(errors,[]);
}

// Job completion must not replace settings controls or an in-progress form.
for (const settingsTab of ['profile','general','gpu','models','openai','chatService','workspaces','team','storage']) {
  const {c,pending,errors}=harness(); c.settingsTab=settingsTab;
  const done=c.refresh();pending[0].resolve({...baseState(),jobs:[{id:1,status:'done'}]});await done;
  assert.equal(c.renderCount,0,`${settingsTab} should survive unrelated job changes`);
  assert.deepEqual(errors,[]);
}

// Settings still update when their own data changes; workspace creation renders
// once and keeps the menu button itself connected as the focus-return target.
for (const [tab,key,value] of [['gpu','nodes',[{id:2}]],['team','users',[{id:2}]],
  ['openai','images',{configured:true}],['storage','used',300]]) {
  const {c,pending}=harness();c.settingsTab=tab;
  const done=c.refresh();pending[0].resolve({...baseState(),[key]:value});await done;
  assert.equal(c.renderCount,1,`${tab} must update for relevant changes`);
}
{
  const {c,pending,trigger}=harness();c.settingsTab='workspaces';
  const done=c.refresh(true);
  pending[0].resolve({...baseState(),workspaces:[{id:1,name:'默认团队'},{id:2,name:'新团队'}]});await done;
  assert.equal(c.renderCount,1);assert.equal(trigger.innerHTML,'updated');
  assert.equal(c.document.querySelector('.workspace-switch'),trigger);
}

// Native dialog close is asynchronous. Do not replace the underlying page
// until its close event and next paint; awaiters must follow the same lifecycle.
{
  const listeners={}, frames=[];
  const target={isConnected:true,getClientRects:()=>[{}],focus(){c.focused++}};
  const c={window:{},state:{},composer:null,popover:{},closeMenu(){},focused:0,rendered:0,
    modal:{open:true,addEventListener:(type,fn)=>{listeners[type]=fn},close(){this.open=false}},
    document:{querySelector:selector=>selector==='.workspace-switch'?target:selector==='#close-modal'?{}:null},
    requestAnimationFrame:fn=>frames.push(fn),
  };
  vm.createContext(c);
  vm.runInContext(section('let modalSettling = false', '\nasync function copyText('),c);
  // Exercise the actual early-render guard, with a DOM adapter that has no view.
  vm.runInContext(section('function renderPage(animate = true)', '\nfunction bindAssetPreviews('),c);
  vm.runInContext('renderPage(false)',c);
  assert.equal(vm.runInContext('pageRenderPending',c),true);
  let closed=false;const closing=c.closeModal().then(()=>{closed=true});
  await settle();assert.equal(closed,false);
  assert.equal(vm.runInContext('modalSettling',c),true);
  listeners.close();assert.equal(frames.length,1);
  frames.shift()();await closing;
  assert.equal(vm.runInContext('modalSettling',c),false);
  assert.equal(vm.runInContext('pageRenderPending',c),false);
  assert.equal(c.focused,1);
  await c.closeModal(); // Already-closed dialogs never leave callers waiting.
}
console.log('PASS settings refresh races, stale-response rejection, stable controls, relevant updates, and dialog close lifecycle');
