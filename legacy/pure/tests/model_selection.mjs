import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const s=fs.readFileSync(new URL('../static/studio.js',import.meta.url),'utf8');
const source=s.slice(s.indexOf('function isImage('),s.indexOf('function syncImageAvailability('));
const c={crypto:webcrypto,submitId:'old',persist(){},state:{model_policy:{enabled:{'MiniMax H3':true,'muse-video':true,'muse-image':true,'gpt-image-2.6-sunburst':true}},model_access:{'MiniMax H3':false,'muse-video':true,'muse-image':true,'gpt-image-2.6-sunburst':false},images:{models:{'gpt-image-2.6-sunburst':'gpt','muse-image':'Muse'},configured:false,enabled:true},video_models:{'MiniMax H3':'MiniMax H3','muse-video':'Muse'},ratios:['16:9','9:16','1:1']},draft:{kind:'video',videoModel:'MiniMax H3',model:'gpt-image-2.6-sunburst',ratio:'1:1',quality:'480',seconds:'15',imageQuality:'medium',prompt:'保留提示词'},refs:['ref']};
vm.createContext(c);vm.runInContext(source,c);
c.ensureModelSelection();assert.equal(c.draft.videoModel,'muse-video');assert.equal(c.draft.seconds,'6');assert.equal(c.draft.ratio,'16:9');assert.equal(c.draft.prompt,'保留提示词');
c.state.model_access['muse-video']=false;c.ensureModelSelection();assert.equal(c.selectedModel(),'');assert.equal(c.generationDisabled(c.draft),true);
c.draft.kind='image';c.ensureModelSelection();assert.equal(c.selectedModel(),'muse-image');
c.state.model_access['muse-image']=false;c.ensureModelSelection();assert.equal(c.selectedModel(),'');
c.state.model_access['gpt-image-2.6-sunburst']=true;c.ensureModelSelection();assert.equal(c.selectedModel(),'','unconfigured providers are not usable');
c.state.images.configured=true;c.ensureModelSelection();assert.equal(c.selectedModel(),'gpt-image-2.6-sunburst');
assert.equal(c.selectedModel({kind:'video',model:'MiniMax H3'}),'MiniMax H3','history must retain actual model');
const menu=s.slice(s.indexOf('} else if (kind === "image-model")'),s.indexOf('} else if (kind === "format")'));
assert.ok(menu.includes('FlowPicker.grouped(modelsForKind(),state.model_catalog||{},modelAvailable'));
assert.ok(menu.includes('FlowPicker.sameFamily'));
console.log('PASS available defaults, team filtering, no-model state, preserved drafts and historical model identity');

const catalog=JSON.parse(fs.readFileSync(new URL('../flow_models.json',import.meta.url),'utf8'));
c.state.model_catalog=catalog;c.state.flow={configured:true};c.packReferences=()=>c.refs;
c.state.images.models=Object.fromEntries(Object.entries(catalog).filter(([,v])=>v.kind==='image').map(([k,v])=>[k,v.label]));
c.state.video_models=Object.fromEntries(Object.entries(catalog).filter(([,v])=>v.kind==='video').map(([k,v])=>[k,v.label]));
for(const [model,spec] of Object.entries(catalog)){
 c.state.model_access[model]=true;c.draft.kind=spec.kind;c.draft.model=c.draft.videoModel=model;
 c.draft.ratio='1:1';c.draft.seconds='15';c.draft.resolution='1K';c.refs=[];
 c.normalizeModelParams();assert.equal(c.draft.ratio,spec.ratio);assert.equal(Number(c.draft.seconds),spec.seconds);
 assert.equal(c.draft.resolution,spec.resolution==='原生'?'1K':spec.resolution);
 assert.equal(c.modelAvailable(model),true);
 if(spec.min_refs)assert.match(c.flowInputIssue(),/参考图片/);
 if(spec.mode==='extend')assert.match(c.flowInputIssue(),/来源视频/);
 c.state.flow.configured=false;assert.equal(c.modelAvailable(model),false);c.state.flow.configured=true;
}
console.log('PASS all Flow UI model constraints, provider availability and required source prompts');
