import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const source=fs.readFileSync(new URL('../static/studio.js',import.meta.url),'utf8');
function fn(name){const start=source.indexOf('function '+name+'(');assert(start>=0,name);const end=source.indexOf('\nfunction ',start+1);return source.slice(start,end);}
function context(){
 const c={crypto:webcrypto,structuredClone,state:{assets:[...Array.from({length:12},(_,i)=>({id:'p'+i,kind:'ref',w:864,h:480})),{id:'portrait',kind:'ref',w:480,h:864},{id:'video',kind:'ref_video'},{id:'audio',kind:'ref_audio'}],jobs:[]},draft:{kind:'video',videoModel:'MiniMax H3',prompt:'保留 <Picture 1> 的衣着',quality:'768',seconds:'10',packs:[]},refs:['p0'],parent:31,retainedSeed:42,submitId:'old',h3UploadSlot:null,updateComposerControls:()=>{},persist:()=>{},isImage:(j)=>j.kind==='image',isAudio:j=>j.kind==='audio',selectedModel:j=>j.videoModel||j.model};
 vm.createContext(c);
 for(const name of ['isH3','h3Options','h3Frames','referenceAsset','referenceType','activeReferences','assignH3Frame','packReferences','checkReferenceImages','importReferenceImages'])vm.runInContext(fn(name),c);
 return c;
}
const c=context();c.importReferenceImages(['p1','p1']);assert.deepEqual([...c.refs],['p0','p1']);const token=c.submitId;c.importReferenceImages(['p1']);assert.equal(c.submitId,token);assert.equal(c.draft.prompt,'保留 <Picture 1> 的衣着');assert.equal(c.parent,31);assert.equal(c.retainedSeed,42);assert.equal(c.draft.quality,'768');assert.equal(c.draft.seconds,'10');
const old=[...c.refs];assert.throws(()=>c.importReferenceImages(['p2','missing']),/当前空间/);assert.deepEqual([...c.refs],old);assert.throws(()=>c.importReferenceImages(['video']),/当前空间/);
c.draft.packs=[{id:'pack',revision:1,media:['p2','p3','p4','p5','p6','p7']}];c.importReferenceImages(['p3']);assert.deepEqual([...c.refs],old);c.importReferenceImages(['p8']);assert.throws(()=>c.importReferenceImages(['p9']),/9 张/);assert.equal(c.packReferences().length,9);
const full=context();full.refs=['p0','p1','p2','p3','p4','p5','p6','video','audio','v2','a2','v3'];full.state.assets.push(...['v2','v3'].map(id=>({id,kind:'ref_video'})),{id:'a2',kind:'ref_audio'});assert.throws(()=>full.importReferenceImages(['p7']),/上限/);assert.equal(full.refs.length,12);
const frames=context();frames.draft.h3={mode:'frames',first_frame:null,last_frame:null,video_audio:[]};frames.refs=[];
assert.throws(()=>frames.importReferenceImages(['p1','portrait']),/比例相同/);assert.equal(frames.draft.h3.first_frame,null);assert.equal(frames.refs.length,0);frames.importReferenceImages(['p1','p2']);assert.equal(frames.draft.h3.first_frame,'p1');assert.equal(frames.draft.h3.last_frame,'p2');assert.throws(()=>frames.importReferenceImages(['p3']),/填满/);assert.equal(frames.draft.h3.last_frame,'p2');
// Library picker only exposes successfully generated, accessible pictures; normal library keeps failures.
c.libraryTab='images';c.libraryScope='history';c.referencePicking={page:'home'};c.matchesLibrary=()=>true;c.state.jobs=[{id:1,kind:'image',status:'done',result:'p0'},{id:2,kind:'image',status:'failed'},{id:3,kind:'image',status:'running'},{id:4,kind:'image',status:'done',result:'other-space'},{id:5,kind:'video',status:'done',result:'video'}];vm.runInContext(fn('libraryJobs'),c);assert.deepEqual([...c.libraryJobs().map(j=>j.id)],[1]);c.referencePicking=null;assert.equal(c.libraryJobs().length,4);
console.log('PASS direct import, deduplication, immutable drafts, atomic limits including pack refs, frame aspect rollback, scoped completed-image picker and normal asset history');
