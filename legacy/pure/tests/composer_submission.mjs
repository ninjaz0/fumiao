import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const source=fs.readFileSync(new URL('../static/studio.js',import.meta.url),'utf8');
const start=source.indexOf('async function submitJob(');
const submit=source.slice(start,source.indexOf('\nfunction submitCurrent()',start));
function context(req){
 const c={crypto:webcrypto,req,revisionPending:false,uploadBusy:false,draft:{kind:'video',prompt:'已提交的提示词',ratio:'16:9',quality:'768',seconds:'15',sampling_steps:32,seed:'123',model:'',resolution:'1K',imageQuality:'medium'},refs:['reference-one'],parent:12,retainedSeed:123,submitId:'draft-before',savedRange:{},state:{images:{default_model:'gpt-image-2.6-sunburst'}},generationDisabled:()=>false,flowInputIssue:()=>'',flowSpec:()=>null,isImage:j=>j.kind==='image',isAudio:j=>j.kind==='audio',promptLimit:()=>12000,selectedModel:j=>j.model || 'MiniMax H3',updateComposerControls:()=>{},persist:()=>{},rendered:0,renderEditor:()=>{c.rendered++},notify:()=>{},refresh:async()=>{},resetSelection:()=>{},renderPage:()=>{},scrollTo:()=>{},document:{querySelector:()=>null},page:'home',libraryTab:'videos',libraryScope:'history',detailId:12,imageId:null,detailEditing:true};
 c.h3InputIssue=()=>'';c.isH3=j=>(j.model||j.videoModel||'MiniMax H3')==='MiniMax H3';c.h3Options=j=>({mode:(j||c.draft).h3?.mode||'reference',video_audio:[]});c.activeReferences=()=>c.refs;vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function normalizedSteps('),source.indexOf('\nfunction normalizeModelParams(')),c);vm.runInContext(submit,c);return c;
}
let body;
const success=context(async(path,value)=>{body=JSON.parse(JSON.stringify(value));return{id:99}});success.referencePicking={page:'home'};
success.draft.packs=[{id:'pack-1',revision:3,name:'私有素材包',media:['pack-image']}];
await success.submitJob();
assert.deepEqual(body.asset_packs,[{id:'pack-1',revision:3}]);assert.equal(success.draft.packs.length,0);assert.equal(success.referencePicking,null);
assert.equal(body.sampling_steps,32);assert.equal(body.prompt,'已提交的提示词');assert.deepEqual(body.refs,['reference-one']);
assert.equal(success.draft.prompt,'');assert.equal(success.refs.length,0);assert.equal(success.parent,null);assert.equal(success.savedRange,null);
assert.equal(success.draft.quality,'768');assert.equal(success.draft.seconds,'15');assert.equal(success.draft.seed,'123');
assert.equal(success.rendered,1);assert.equal(success.page,'library');assert.equal(success.revisionPending,false);
const failed=context(async()=>{throw new Error('请求失败')});
failed.draft.packs=[{id:'pack-2',revision:1,media:['retained']}];
await assert.rejects(failed.submitJob(),/请求失败/);
assert.equal(failed.draft.packs[0].id,'pack-2');
assert.equal(failed.draft.prompt,'已提交的提示词');assert.equal(failed.refs[0],'reference-one');assert.equal(failed.rendered,0);assert.equal(failed.revisionPending,false);
const unconfirmed=context(async()=>({}));
await assert.rejects(unconfirmed.submitJob(),/尚未确认/);assert.equal(unconfirmed.draft.prompt,'已提交的提示词');
let resolve;
const delayed=context(()=>new Promise(r=>resolve=r));const pending=delayed.submitJob();
delayed.draft.prompt='等待返回时新写的下一条提示词';delayed.refs=['new-reference'];delayed.submitId='new-edit-id';
resolve({id:100});await pending;
assert.equal(delayed.draft.prompt,'等待返回时新写的下一条提示词');assert.equal(delayed.refs[0],'new-reference');assert.equal(delayed.rendered,0);
let againBody;const again=context(async(path,value)=>{againBody=value;return {id:101}});
await again.submitJob({id:20,kind:'video',prompt:'历史任务',refs:[],ratio:'16:9',quality:480,seconds:5,sampling_steps:50});
assert.equal(againBody.sampling_steps,50);assert.deepEqual(JSON.parse(JSON.stringify(againBody.asset_packs)),[]);
assert.equal(again.draft.prompt,'已提交的提示词');assert.equal(again.rendered,0);
const image=context(async()=>({id:102}));image.draft.kind='image';await image.submitJob();assert.equal(image.draft.prompt,'');assert.equal(image.libraryTab,'images');
console.log('PASS clear accepted editor submissions, retain parameters, preserve failures and concurrent new edits, and leave unrelated drafts when regenerating history');

let speechBody;const speech=context(async(path,value)=>{assert.equal(path,'/api/audio-jobs');speechBody=value;return {id:103}});speech.draft.kind='audio';speech.draft.model='breeze-tts-2';speech.draft.voiceDescription='温柔自然';await speech.submitJob();assert.equal(speech.libraryTab,'audio');assert.equal(speechBody.instruction,'温柔自然');assert.equal(speechBody.refs,undefined);assert.equal(speech.draft.prompt,'');assert.equal(speech.draft.voiceDescription,'温柔自然');

let fastBody;const fast=context(async(path,value)=>{fastBody=value;return{id:104}});fast.draft.fast_mode=true;await fast.submitJob();assert.equal(fastBody.sampling_steps,4);assert.equal(fast.draft.sampling_steps,32);assert.equal(fast.draft.fast_mode,true);
fast.draft.fast_mode=false;assert.equal(fast.effectiveSteps(fast.draft),32);
await again.submitJob({id:30,kind:'video',model:'MiniMax H3',prompt:'快速历史',refs:[],ratio:'16:9',quality:768,seconds:5,sampling_steps:4});assert.equal(againBody.sampling_steps,4);
await again.submitJob({id:31,kind:'video',model:'muse-video',prompt:'Muse历史',refs:[],ratio:'16:9',quality:768,seconds:6,sampling_steps:20,fast_mode:true});assert.equal(againBody.sampling_steps,20);
console.log('PASS fast toggle sends four steps, preserves normal choice, and replays history without leaking into Muse');
