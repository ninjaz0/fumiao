import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const catalog=JSON.parse(fs.readFileSync(new URL('../flow_models.json',import.meta.url),'utf8'));
catalog['MiniMax H3']={label:'MiniMax H3',kind:'video'};
catalog['muse-video']={label:'Muse',kind:'video'};
const enabled=Object.fromEntries(Object.entries(catalog).map(([id,spec])=>[id,Boolean(spec.family)||['MiniMax H3','muse-video'].includes(id)]));
const models=Object.fromEntries(Object.entries(catalog).filter(([id])=>enabled[id]).map(([id,spec])=>[id,spec.label]));
const popover={innerHTML:'',setAttribute(){},querySelector(){return null}};
const c={crypto:webcrypto,state:{model_catalog:catalog,model_access:enabled,video_models:models,images:{models:{},configured:true,enabled:true},flow:{configured:true},ratios:['16:9','9:16']},draft:{kind:'video',videoModel:'flow:veo-3.1-quality-8s-landscape',ratio:'16:9',seconds:'8',flowSourceJob:null},persist(){},refs:[],packReferences:()=>[],popover,esc:s=>s,ic:()=>'',submitId:'test'};
vm.createContext(c);vm.runInContext(fs.readFileSync(new URL('../static/flowpicker.js',import.meta.url),'utf8'),c);
const source=fs.readFileSync(new URL('../static/studio.js',import.meta.url),'utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
vm.runInContext(section('function isImage(','function syncImageAvailability('),c);
vm.runInContext(section('function radio(','popover.addEventListener("change"'),c);
const normalized=value=>JSON.parse(JSON.stringify(value));
const available=id=>enabled[id]===true;
assert.deepEqual(normalized(c.FlowPicker.grouped(models,catalog,available,c.selectedModel()).map(([,label])=>label)).sort(),['MiniMax H3','Muse','Omni 1.2 Flash','Veo 3.1 Quality'].sort());
c.showMenuBody('image-model');assert.equal((popover.innerHTML.match(/role="option"/g)||[]).length,4);assert.doesNotMatch(popover.innerHTML,/<span>[^<]*(?:\d+s|16:9|9:16)/);
assert.equal(c.composerModelLabel(),'Veo 3.1 Quality');
c.showMenuBody('duration');assert.deepEqual([...popover.innerHTML.matchAll(/data-value="(\d+)"/g)].map(x=>Number(x[1])),[4,6,8]);
c.setFlowParams({ratio:'9:16'});assert.equal(c.selectedModel(),'flow:veo-3.1-quality-8s-portrait');
c.setFlowParams({seconds:6});assert.equal(c.selectedModel(),'flow:veo-3.1-quality-6s-portrait');
c.setFlowParams({mode:'i2v'});assert.equal(c.selectedModel(),'flow:veo-3.1-quality-i2v-6s-portrait');
c.showMenuBody('duration');assert.deepEqual([...popover.innerHTML.matchAll(/data-value="(\d+)"/g)].map(x=>Number(x[1])),[4,6]);
c.setFlowParams({mode:'extend'});c.draft.flowSourceJob=62;c.setFlowParams({ratio:'16:9'});assert.equal(c.draft.flowSourceJob,null);assert.equal(c.draft.seconds,'8');
c.draft.videoModel='flow:omni-1.2-flash-15s-portrait';c.normalizeModelParams();
assert.equal(c.composerModelLabel(),'Omni 1.2 Flash');
c.setFlowParams({ratio:'16:9'});assert.equal(c.selectedModel(),'flow:omni-1.2-flash-10s-landscape');assert.equal(c.draft.seconds,'10');
c.showMenuBody('duration');assert.deepEqual([...popover.innerHTML.matchAll(/data-value="(\d+)"/g)].map(x=>Number(x[1])),[3,4,5,6,7,8,9,10]);
// Every offered parameter pair must resolve to the same allowed native spec.
for(const [id,spec] of Object.entries(catalog).filter(([,s])=>s.family)){
 const options=c.FlowPicker.options(catalog,id,available);
 for(const seconds of options.seconds){
  const resolved=c.FlowPicker.resolve(catalog,id,available,{mode:spec.mode,ratio:spec.ratio,seconds});
  assert.equal(catalog[resolved].mode,spec.mode);assert.equal(catalog[resolved].ratio,spec.ratio);assert.equal(catalog[resolved].seconds,seconds);assert.ok(available(resolved));
 }
}
// Closing a native spec removes that combination; closing a family removes it.
for(const [id,spec] of Object.entries(catalog))if(spec.family==='flow:veo-3.1-quality'&&spec.ratio==='9:16'&&spec.seconds===6)enabled[id]=false;
assert.ok(!c.FlowPicker.options(catalog,'flow:veo-3.1-quality-4s-portrait',available).seconds.includes(6));
for(const [id,spec] of Object.entries(catalog))if(spec.family==='flow:omni-1.2-flash')enabled[id]=false;
assert.ok(!c.FlowPicker.grouped(models,catalog,available,'MiniMax H3').some(([,label])=>label==='Omni 1.2 Flash'));
console.log('PASS four clean model names, independent duration/ratio menus, native variant dispatch, mode changes, source reset and admin restrictions');
