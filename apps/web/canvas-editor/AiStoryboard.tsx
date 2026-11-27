import {useEffect,useRef,useState} from 'react';
import {ChatBill,type TurnBill} from './chat/ChatBill';
import {ModelSelect} from './chat/ModelSelect';
import {useChatQuote,quoteFunded} from './chat/useChatQuote';
import {chatRequest} from './chat/ChatWorkspace';
import type {CanvasGenerationMode} from './types';

export type SuggestedShot={title:string;prompt:string;narration:string;seconds:5|10|15};
export type StoryboardApplyOptions={
 generationMode: CanvasGenerationMode;
 tailChain: boolean;
 gridLayout?: '2x2'|'3x3';
};

const MAX_STORYBOARD_SHOTS = 120;

type ReplySource={cid:string;message:number;turn?:string};
function StoryboardBill({workspace,source}:{workspace:number;source:ReplySource}){
 const {cid,message,turn}=source;
 const [bill,setBill]=useState<TurnBill>();
 const [error,setError]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{
  let current=true;
  setBill(undefined);setError(false);
  void chatRequest<{bills:TurnBill[]}>(workspace,'/api/chats/'+cid+'/bills').then(r=>{
   if(current)setBill(r.bills.find(b=>b.message===message&&(!turn||b.turn===turn)));
  },()=>{if(current)setError(true)});
  return ()=>{current=false};
 },[workspace,cid,message,turn,retry]);
 if(error)return <button type="button" onClick={()=>setRetry(n=>n+1)}>重新载入分镜账单</button>;
 return bill?<ChatBill bill={bill}/>:null;
}

function restoreStoryboard(text:string):{message:number|null;shots:SuggestedShot[];source:ReplySource|null;legacy:boolean}{
 try{
  const data=JSON.parse(text),rows=Array.isArray(data)?data:data?.shots;
  if(Array.isArray(rows)&&rows.length<=MAX_STORYBOARD_SHOTS&&rows.every(r=>r&&typeof r.title==='string'&&typeof r.prompt==='string'&&typeof r.narration==='string'&&[5,10,15].includes(r.seconds))){
   const message=Array.isArray(data)||data.message===null?null:Number.isSafeInteger(data.message)&&data.message>0?data.message:0;
   const legacy=Array.isArray(data)||(!Object.hasOwn(data,'source')&&!Object.hasOwn(data,'turn'));
   const source=data.source?.message===message && message && typeof data.source.cid==='string' && data.source.cid.length>0 &&
    (!Object.hasOwn(data.source,'turn') || (typeof data.source.turn==='string'&&data.source.turn.length>0)) ? data.source:null;
   return {message,shots:rows,source,legacy};
  }
 }catch{}
 return {message:0,shots:[],source:null,legacy:false};
}
export function parseStoryboard(text:string):SuggestedShot[]{
 const raw=text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
 const data=JSON.parse(raw);const rows=Array.isArray(data)?data:data.shots;
 if(!Array.isArray(rows)||rows.length<1||rows.length>MAX_STORYBOARD_SHOTS)throw new Error(`需要 1–${MAX_STORYBOARD_SHOTS} 个镜头`);
 return rows.map((r:any)=>{
  if(!r||typeof r.title!=='string'||!r.title.trim()||r.title.length>80||typeof r.prompt!=='string'||!r.prompt.trim()||r.prompt.length>12000||typeof r.narration!=='string'||r.narration.length>300||![5,10,15].includes(r.seconds))throw new Error('镜头格式不完整，请修改后重新读取');
  return {title:r.title,prompt:r.prompt,narration:r.narration,seconds:r.seconds};
 });
}
export function AiStoryboard({workspace,userId,project,onApply,onRecharge,onConfigureModels}:{
 workspace:number;userId:number;project:string;onApply:(shots:SuggestedShot[],options:StoryboardApplyOptions)=>Promise<void>;
 onRecharge:()=>void;onConfigureModels?:()=>void;
}){
 const key=`fm-storyboard-${userId}-${workspace}-${project}`;
 const [draft]=useState(()=>restoreStoryboard(localStorage.getItem(key+'-proposal')||'[]'));
 const [config,setConfig]=useState<any>(),[model,setModel]=useState(''),[brief,setBrief]=useState(()=>localStorage.getItem(key+'-brief')||''),[cid,setCid]=useState(()=>localStorage.getItem(key+'-chat')||''),[shots,setShots]=useState<SuggestedShot[]>(draft.shots),[running,setRunning]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[complete,setComplete]=useState(false);
 const [shotMessage,setShotMessage]=useState(draft.message);
 const [shotSource,setShotSource]=useState<ReplySource|null>(null);
 const [sourceRetry,setSourceRetry]=useState(0),[sourceError,setSourceError]=useState(false);
 // Pre-upgrade proposals recorded only the globally unique assistant message.
 // The most recent chat can belong to a different (failed) attempt.
 useEffect(()=>{
  if(!draft.shots.length || !draft.message || draft.message!==shotMessage || (!draft.legacy && !draft.source) || shotSource)return;
  let current=true;
  setSourceError(false);
  void chatRequest<ReplySource & {content:string}>(workspace,'/api/chat/messages/'+draft.message+'/source')
   .then(async(source)=>{
    if(!current || source.message!==draft.message || (draft.source && draft.source.cid!==source.cid))return;
    let original:SuggestedShot[];
    try{original=parseStoryboard(source.content)}catch{return}
    // Edits may change every shot. A different chat needs additional evidence
    // from the original user message before an edited draft can display its bill.
    if(source.cid!==cid && JSON.stringify(original)!==JSON.stringify(draft.shots)){
     const chat=await chatRequest(workspace,'/api/chats/'+source.cid);
     const reply=chat.messages.find((m:any)=>m.id===source.message&&m.role==='assistant'&&m.state==='complete');
     const user=chat.messages.find((m:any)=>m.id===reply?.reply_to&&m.role==='user');
     let context;try{context=JSON.parse(user?.context||'{}')}catch{return}
     if(chat.conversation.id!==source.cid || chat.conversation.workspace!==workspace || user?.author!==userId ||
       context.project!==project || !reply || (draft.source?.turn && reply.turn!==draft.source.turn))return;
    }
    if(current)setShotSource(existing=>existing??{cid:source.cid,message:source.message,turn:draft.source?.turn});
   }).catch(e=>{if(current && e.status!==403 && e.status!==404)setSourceError(true)});
  return ()=>{current=false};
 },[workspace,userId,project,cid,draft,shotMessage,shotSource,sourceRetry]);
 const [latestReceipt,setLatestReceipt]=useState<ReplySource|null>(null);
 const showReceipt=(source:ReplySource|null)=>source&&<StoryboardBill key={source.cid+'-'+source.message} workspace={workspace} source={source}/>;
 const setResult=(chat:string,m:any)=>{
  const source={cid:chat,message:m.id,turn:m.turn||undefined};
  if(m.state!=='complete' || lastMessage.current!==m.id)
   setLatestReceipt(current=>current?.cid===chat&&current.message===m.id?current:source);
  if(m.state!=='complete'){lastMessage.current=m.id;setError(m.error||'生成未完成，积分已退回');return}
  if(lastMessage.current===m.id){
   // Older local drafts carried the globally unique assistant message ID.
   if(draft.message===m.id && draft.shots.length && (draft.legacy || (draft.source?.cid===chat && (!draft.source.turn || draft.source.turn===m.turn)))){
    try{parseStoryboard(m.content);setShotSource(current=>current??source)}
    catch{setError('未能整理出完整分镜。请调整需求后重新拟定，已有分镜会保留。')}
   }
   return;
  }
  lastMessage.current=m.id;setComplete(true);
  try{setShots(parseStoryboard(m.content));setShotMessage(m.id);setShotSource(source);setError('')}
  catch{setError('未能整理出完整分镜。请调整需求后重新拟定，已有分镜会保留。')}
 };
 const [targetCount,setTargetCount]=useState<number>(12);
 const [generationMode,setGenerationMode]=useState<CanvasGenerationMode>('first_last_frame');
 const [tailChain,setTailChain]=useState<boolean>(true);
 const [gridLayout,setGridLayout]=useState<'2x2'|'3x3'>('3x3');
 const lastMessage=useRef(draft.message);const pending=useRef<any>(null);
 const [stopping,setStopping]=useState(false);
 const stopPending=useRef(false);
 const [applying,setApplying]=useState(false);
 const req=(path:string,body?:unknown)=>chatRequest(workspace,path,body);
 const updateConfig=(c:any)=>{setConfig(c);setModel(m=>m in c.models?m:Object.keys(c.models)[0]||'')};
 useEffect(()=>{let active=true;const refresh=()=>req('/api/chat/config').then(c=>{if(active)updateConfig(c)}).catch(e=>{if(active)setError(e.message)});void refresh();const timer=setInterval(()=>void refresh(),10000);try{pending.current=JSON.parse(localStorage.getItem(key+'-pending')||'null')}catch{}return()=>{active=false;clearInterval(timer)}},[workspace]);
 useEffect(()=>{
  if(!cid)return;let closed=false;
  const accept=(s:any)=>{
   if(closed || s.conversation.id!==cid || (s.conversation.workspace!=null&&s.conversation.workspace!==workspace) || (s.conversation.owner!=null&&s.conversation.owner!==userId))return;
   setRunning(!!s.conversation.active_turn);
   const m=[...s.messages].reverse().find((m:any)=>m.role==='assistant');
   if(!m)return;
   if(lastMessage.current===null&&draft.shots.length){
    const p=pending.current,boundary=s.messages.find((r:any)=>r.role==='assistant'&&(r.state==='running'||(s.conversation.active_turn&&r.turn===s.conversation.active_turn)))||(p?.cid===cid&&s.conversation.revision>p.body.expected_revision?[...s.messages].reverse().find((r:any)=>r.role==='user'&&r.content===p.body.text):null);
    const rows=boundary?s.messages.slice(0,s.messages.indexOf(boundary)):s.messages,previous=[...rows].reverse().find((r:any)=>r.role==='assistant'&&r.state!=='running');
    if(previous?.state==='complete' && draft.legacy){
     try{
      const original=parseStoryboard(previous.content);
      setShotMessage(previous.id);
      if(JSON.stringify(original)===JSON.stringify(draft.shots))setShotSource({cid,message:previous.id,turn:previous.turn||undefined});
     }catch{/* An invalid reply cannot identify a storyboard. */}
    }
    lastMessage.current=previous?.id||0;
   }
   if(m.state==='running')return;
   pending.current=null;localStorage.removeItem(key+'-pending');
   setResult(cid,m);
  };
  void req('/api/chats/'+cid).then(accept).catch(e=>setError(e.message));
  const events=new EventSource('/api/chats/'+cid+'/events?workspace='+workspace);events.onmessage=e=>accept(JSON.parse(e.data));
  return()=>{closed=true;events.close()};
 },[cid,workspace]);
 useEffect(()=>{
  if(!shots.length)return;
  // Keep the legacy shape while awaiting verification; source:null explicitly
  // marks an edit whose reply is tracked without an attributable receipt.
  const retainLegacy=draft.legacy && shotMessage===draft.message && !shotSource;
  const source=shotSource??(shotMessage===draft.message?draft.source:null);
  localStorage.setItem(key+'-proposal',JSON.stringify({message:shotMessage,shots,...(retainLegacy?{}:{source})}));
 },[shots,key,draft,shotMessage,shotSource]);
 const trackHint = generationMode === 'omni_ref'
      ? '采用全能多参考链路（可在画面描述中引用 @角色名/@场景名 或 <Picture N>）。'
      : generationMode === 'grid_preview'
        ? `采用 ${gridLayout} 宫格构图预览链路，确保画面构图连贯。`
        : '采用经典首尾帧连贯链路，注意镜头间动作与光影承接。';
 const text=`请根据下面需求拟定可编辑分镜，不要执行视频或语音生成。目标是约 ${targetCount} 个镜头（最多支持 ${MAX_STORYBOARD_SHOTS} 个镜头）。${trackHint}只返回 JSON 数组，1–${MAX_STORYBOARD_SHOTS} 个镜头，每项严格包含 title（简短标题）、prompt（可直接用于视频生成的中文镜头描述）、narration（可为空，按自然朗读每秒约2–3个汉字，5秒不超过12字、10秒不超过25字、15秒不超过35字）、seconds（只能为5、10、15）。保持主体和场景连贯，不编造需求没有提供的事实，不输出 Markdown。需求：\n`+brief;
 const native=config?.models[model]?.billing==="token";
 const canvasContext=async()=>({project,expected_revision:(await req('/api/canvases/'+project)).revision});
 const offered=useChatQuote(native&&brief.trim()&&!running?JSON.stringify([workspace,project,model,text,config?.pricing.revision,config?.credits.exact?.available]):null,
  async()=>req('/api/chat/quote',{cid:null,model,text,context:await canvasContext()}));
 const storedCap=pending.current?.body.max_charge;
 const price=storedCap ?? (native?offered.quote?.max_charge:config?.pricing.items.find((p:any)=>p.key===model+'|reply')?.amount);
 const funded = !!pending.current || (!!config && quoteFunded(config.credits.exact?.available,config.credits.available,price));
 const send=async()=>{
  setBusy(true);setError('');
  try{
   if(!pending.current){
    if(native&&!offered.quote)return;
    const context=native?await canvasContext():undefined;
    const c=await req('/api/chats',{model,context});const chat=c.conversation.id;localStorage.setItem(key+'-chat',chat);setCid(chat);
    pending.current={cid:chat,body:{uid:crypto.randomUUID(),model,text,expected_revision:c.conversation.revision,price_revision:config.pricing.revision,...offered.quote,context}};
    localStorage.setItem(key+'-pending',JSON.stringify(pending.current));
   }
   const p=pending.current;setCid(p.cid);setComplete(false);const snapshot=await req('/api/chats/'+p.cid+'/messages',p.body);setRunning(!!snapshot.conversation.active_turn);const reply=[...snapshot.messages].reverse().find((m:any)=>m.role==='assistant');if(reply&&reply.state!=='running')setResult(p.cid,reply);
  }catch(e){if((e as any).status && (e as any).status<500){offered.refresh();pending.current=null;localStorage.removeItem(key+'-pending');void req('/api/chat/config').then(updateConfig);}setError((e as Error).message)}finally{setBusy(false)}
 };
 const stop=async()=>{
  if(stopPending.current)return;
  stopPending.current=true;
  setStopping(true);
  try{const snapshot=await req('/api/chats/'+cid+'/stop',{});setRunning(!!snapshot.conversation.active_turn)}
  catch(e){setError((e as Error).message)}
  finally{stopPending.current=false;setStopping(false)}
 };
 return <div className="ai-storyboard">
  <div className="fm-storyboard-options">
   <label>目标镜头数（最高 120 镜）
    <select value={targetCount} disabled={running||busy} onChange={e=>setTargetCount(Number(e.target.value))}>
     {[6,12,24,36,60,90,120].map(n=><option key={n} value={n}>{n} 个镜头</option>)}
    </select>
   </label>
   <label>分镜生成链路
    <select value={generationMode} disabled={running||busy} onChange={e=>setGenerationMode(e.target.value as CanvasGenerationMode)}>
     <option value="first_last_frame">经典首尾帧连贯</option>
     <option value="omni_ref">全能参考</option>
     <option value="grid_preview">九宫格/四宫格低成本构图预览</option>
    </select>
   </label>
   {generationMode==='grid_preview'&&<label>宫格规格
    <select value={gridLayout} disabled={running||busy} onChange={e=>setGridLayout(e.target.value as '2x2'|'3x3')}>
     <option value="2x2">2×2 四宫格</option>
     <option value="3x3">3×3 九宫格</option>
    </select>
   </label>}
   <label className="fm-storyboard-check">
    <input type="checkbox" checked={tailChain} disabled={running||busy} onChange={e=>setTailChain(e.target.checked)}/>
    <span>自动标记跨镜尾帧衔接</span>
   </label>
  </div>
  <label>创作需求<textarea value={brief} maxLength={8000} rows={4} disabled={running||busy} placeholder="介绍剧集剧情、角色关系、场景与希望传达的节奏…" onChange={e=>{setBrief(e.target.value);localStorage.setItem(key+'-brief',e.target.value)}}/></label>
  <div className="storyboard-request">{model&&config?.models[model]&&<>
   <ModelSelect models={config.models} value={model} disabled={busy||running} onChange={setModel}/>
   {price!=null&&<span className="fm-number">{`文字生成 · ${native||storedCap?"最高 ":""}${price} 积分`}</span>}
  </>}{running?<><span className="fm-state-change" role="status">{stopping?'正在停止…':'正在拟定分镜…'}</span><button className="secondary" disabled={stopping} onClick={()=>void stop()}>停止</button></>:model&&<button className="primary" disabled={busy||!brief.trim()||!config?.models[model]||!funded} onClick={()=>void send()}>{busy?'提交中…':pending.current?'重试确认':complete&&error?'重新拟定':'拟定分镜'}</button>}</div>
  {!running&&config&&(!model
   ? <p role="status">当前空间暂无可用对话模型{onConfigureModels
    ? <button className="secondary" type="button" onClick={onConfigureModels}>前往配置对话模型</button>
    : "，请联系管理员开通"}</p>
   : price==null ? <p role="status">{native?(offered.error||(brief.trim()?"正在报价":"按 Token 计费")):"当前对话模型尚未定价"}{native&&offered.error&&<button type="button" onClick={offered.refresh}>重新报价</button>}</p>
   : !funded && <p role="status">当前空间积分不足<button className="secondary" type="button" onClick={onRecharge}>去充值</button></p>)}
  {error&&<p className="error" role="alert">{error}</p>}
  {latestReceipt?.cid===cid && (latestReceipt.cid!==shotSource?.cid || latestReceipt.message!==shotSource.message) && showReceipt(latestReceipt)}

  {!shotSource&&sourceError&&<button type="button" onClick={()=>setSourceRetry(n=>n+1)}>重新载入分镜账单</button>}
  {!!shots.length&&<>{showReceipt(shotSource)}<div className="storyboard-proposal">{shots.map((shot,i)=><section key={i}><label>镜头 {i+1}<input value={shot.title} maxLength={80} onChange={e=>setShots(rows=>rows.map((r,j)=>j===i?{...r,title:e.target.value}:r))}/></label><label>画面<textarea rows={3} value={shot.prompt} maxLength={12000} onChange={e=>setShots(rows=>rows.map((r,j)=>j===i?{...r,prompt:e.target.value}:r))}/></label><label>旁白<textarea rows={2} maxLength={300} value={shot.narration} onChange={e=>setShots(rows=>rows.map((r,j)=>j===i?{...r,narration:e.target.value}:r))}/></label><div className="storyboard-seconds" role="group" aria-label={`镜头 ${i+1} 时长`}>{([5,10,15] as const).map(seconds=><button key={seconds} aria-pressed={shot.seconds===seconds} onClick={()=>setShots(rows=>rows.map((r,j)=>j===i?{...r,seconds}:r))}>{seconds}s</button>)}</div></section>)}</div>
   <div className="dialog-actions"><span className="fm-number">{shots.length} 个镜头 · {shots.reduce((t,s)=>t+s.seconds,0)} 秒</span><button className="primary" disabled={busy||shots.some(s=>!s.title.trim()||!s.prompt.trim())} onClick={async()=>{setBusy(true);setApplying(true);try{await onApply(shots,{generationMode,tailChain,gridLayout})}catch(e){setError((e as Error).message)}finally{setBusy(false);setApplying(false)}}}>{applying?'正在加入画布…':'采用分镜，不生成视频'}</button></div></>}
 </div>
}