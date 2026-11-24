import {useEffect,useRef,useState} from 'react';
import {ModelSelect} from './chat/ModelSelect';
import {chatRequest} from './chat/ChatWorkspace';
export type SuggestedShot={title:string;prompt:string;narration:string;seconds:5|10|15};
function restoreStoryboard(text:string):{message:number|null;shots:SuggestedShot[]}{
 try{const data=JSON.parse(text),rows=Array.isArray(data)?data:data?.shots;if(Array.isArray(rows)&&rows.length<=12&&rows.every(r=>r&&typeof r.title==='string'&&typeof r.prompt==='string'&&typeof r.narration==='string'&&[5,10,15].includes(r.seconds)))return {message:Array.isArray(data)||data.message===null?null:Number.isSafeInteger(data.message)&&data.message>0?data.message:0,shots:rows}}catch{}
 return {message:0,shots:[]};
}
export function parseStoryboard(text:string):SuggestedShot[]{
 const raw=text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
 const data=JSON.parse(raw);const rows=Array.isArray(data)?data:data.shots;
 if(!Array.isArray(rows)||rows.length<1||rows.length>12)throw new Error('需要 1–12 个镜头');
 return rows.map((r:any)=>{
  if(!r||typeof r.title!=='string'||!r.title.trim()||r.title.length>80||typeof r.prompt!=='string'||!r.prompt.trim()||r.prompt.length>12000||typeof r.narration!=='string'||r.narration.length>300||![5,10,15].includes(r.seconds))throw new Error('镜头格式不完整，请修改后重新读取');
  return {title:r.title,prompt:r.prompt,narration:r.narration,seconds:r.seconds};
 });
}
export function AiStoryboard({workspace,userId,project,onApply}:{workspace:number;userId:number;project:string;onApply:(shots:SuggestedShot[])=>Promise<void>}){
 const key=`fm-storyboard-${userId}-${workspace}-${project}`;
 const [draft,setDraft]=useState(()=>restoreStoryboard(localStorage.getItem(key+'-proposal')||'[]'));
 const [config,setConfig]=useState<any>(),[model,setModel]=useState(''),[brief,setBrief]=useState(()=>localStorage.getItem(key+'-brief')||''),[cid,setCid]=useState(()=>localStorage.getItem(key+'-chat')||''),[shots,setShots]=useState<SuggestedShot[]>(draft.shots),[running,setRunning]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[complete,setComplete]=useState(false);
 const lastMessage=useRef(draft.message);const pending=useRef<any>(null);
 const req=(path:string,body?:unknown)=>chatRequest(workspace,path,body);
 const updateConfig=(c:any)=>{setConfig(c);setModel(m=>m in c.models?m:Object.keys(c.models)[0]||'')};
 useEffect(()=>{let active=true;const refresh=()=>req('/api/chat/config').then(c=>{if(active)updateConfig(c)}).catch(e=>{if(active)setError(e.message)});void refresh();const timer=setInterval(()=>void refresh(),10000);try{pending.current=JSON.parse(localStorage.getItem(key+'-pending')||'null')}catch{}return()=>{active=false;clearInterval(timer)}},[workspace]);
 useEffect(()=>{
  if(!cid)return;let closed=false;
  const accept=(s:any)=>{
   if(closed)return;setRunning(!!s.conversation.active_turn);
   const m=[...s.messages].reverse().find((m:any)=>m.role==='assistant');
   if(!m)return;
   if(lastMessage.current===null&&draft.shots.length){
    const p=pending.current,boundary=s.messages.find((r:any)=>r.role==='assistant'&&(r.state==='running'||r.turn===s.conversation.active_turn))||(p?.cid===cid&&s.conversation.revision>p.body.expected_revision?[...s.messages].reverse().find((r:any)=>r.role==='user'&&r.content===p.body.text):null);
    const rows=boundary?s.messages.slice(0,s.messages.indexOf(boundary)):s.messages,previous=[...rows].reverse().find((r:any)=>r.role==='assistant'&&r.state!=='running');
    lastMessage.current=previous?.id||0;setDraft(d=>({...d,message:lastMessage.current}));
   }
   if(m.state==='running')return;
   pending.current=null;localStorage.removeItem(key+'-pending');
   if(lastMessage.current===m.id)return;lastMessage.current=m.id;
   if(m.state!=='complete'){setError(m.error||'生成未完成，积分已退回');return;}
   setComplete(true);try{setShots(parseStoryboard(m.content));setError('')}catch{setError('未能整理出完整分镜。请调整需求后重新拟定，已有分镜会保留。')}
  };
  void req('/api/chats/'+cid).then(accept).catch(e=>setError(e.message));
  const events=new EventSource('/api/chats/'+cid+'/events?workspace='+workspace);events.onmessage=e=>accept(JSON.parse(e.data));
  return()=>{closed=true;events.close()};
 },[cid,workspace]);
 useEffect(()=>{if(shots.length)localStorage.setItem(key+'-proposal',JSON.stringify({message:lastMessage.current,shots}))},[shots,key,draft.message]);
 const price=config?.pricing.items.find((p:any)=>p.key===model+'|reply')?.amount;
 const send=async()=>{
  setBusy(true);setError('');
  try{
   if(!pending.current){
    const c=await req('/api/chats',{model});const chat=c.conversation.id;localStorage.setItem(key+'-chat',chat);setCid(chat);
    const text='请根据下面需求拟定可编辑分镜，不要执行视频或语音生成。默认目标是 30 秒、6 个镜头。只返回 JSON 数组，1–12 个镜头，每项严格包含 title（简短标题）、prompt（可直接用于视频生成的中文镜头描述）、narration（可为空，按自然朗读每秒约2–3个汉字，5秒不超过12字、10秒不超过25字、15秒不超过35字）、seconds（只能为5、10、15）。保持主体和场景连贯，不编造需求没有提供的事实，不输出 Markdown。需求：\n'+brief;
    pending.current={cid:chat,body:{uid:crypto.randomUUID(),model,text,expected_revision:c.conversation.revision,price_revision:config.pricing.revision}};
    localStorage.setItem(key+'-pending',JSON.stringify(pending.current));
   }
   const p=pending.current;setCid(p.cid);setComplete(false);const snapshot=await req('/api/chats/'+p.cid+'/messages',p.body);setRunning(!!snapshot.conversation.active_turn);const reply=[...snapshot.messages].reverse().find((m:any)=>m.role==='assistant');if(reply?.state==='complete'){lastMessage.current=reply.id;setComplete(true);try{setShots(parseStoryboard(reply.content))}catch{setError('未能整理出完整分镜。请调整需求后重新拟定，已有分镜会保留。')}}
  }catch(e){if((e as any).status && (e as any).status<500){pending.current=null;localStorage.removeItem(key+'-pending');void req('/api/chat/config').then(updateConfig);}setError((e as Error).message)}finally{setBusy(false)}
 };
 return <div className="ai-storyboard">
  <label>创作需求<textarea value={brief} maxLength={8000} rows={4} disabled={running||busy} placeholder="介绍活动主题、受众、地点和希望传达的信息…" onChange={e=>{setBrief(e.target.value);localStorage.setItem(key+'-brief',e.target.value)}}/></label>
  <div className="storyboard-request"><ModelSelect models={config?.models||{}} value={model} disabled={busy||running} onChange={setModel}/><span>{price==null?'':`文字生成 · ${price}`}</span>{running?<button className="secondary" onClick={()=>void req('/api/chats/'+cid+'/stop',{}).catch(e=>setError(e.message))}>停止</button>:<button className="primary" disabled={busy||!brief.trim()||!model||!config?.models[model]||price==null||config?.credits.available<price} onClick={()=>void send()}>{busy?'提交中…':pending.current?'重试确认':complete&&error?`重新拟定 · ${price}`:'拟定分镜'}</button>}</div>
  {error&&<p className="error" role="alert">{error}</p>}

  {!!shots.length&&<><div className="storyboard-proposal">{shots.map((shot,i)=><section key={i}><label>镜头 {i+1}<input value={shot.title} maxLength={80} onChange={e=>setShots(rows=>rows.map((r,j)=>j===i?{...r,title:e.target.value}:r))}/></label><label>画面<textarea rows={3} value={shot.prompt} maxLength={12000} onChange={e=>setShots(rows=>rows.map((r,j)=>j===i?{...r,prompt:e.target.value}:r))}/></label><label>旁白<textarea rows={2} maxLength={300} value={shot.narration} onChange={e=>setShots(rows=>rows.map((r,j)=>j===i?{...r,narration:e.target.value}:r))}/></label><div className="storyboard-seconds" role="group" aria-label={`镜头 ${i+1} 时长`}>{([5,10,15] as const).map(seconds=><button key={seconds} aria-pressed={shot.seconds===seconds} onClick={()=>setShots(rows=>rows.map((r,j)=>j===i?{...r,seconds}:r))}>{seconds}s</button>)}</div></section>)}</div>
   <div className="dialog-actions"><span>{shots.length} 个镜头 · {shots.reduce((t,s)=>t+s.seconds,0)} 秒</span><button className="primary" disabled={busy||shots.some(s=>!s.title.trim()||!s.prompt.trim())} onClick={async()=>{setBusy(true);try{await onApply(shots)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}}>采用分镜，不生成视频</button></div></>}
 </div>
}
