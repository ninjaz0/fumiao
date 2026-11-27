import {useEffect,useLayoutEffect,useRef,useState,useMemo,type ClipboardEvent,type MouseEvent} from 'react';
import {ArrowUp,Square,Plus,Copy,Check,RotateCcw,Trash2,Pencil,PanelLeft,X,FileText,MessageSquare,ArrowDown,LoaderCircle,ExternalLink} from 'lucide-react';
import {marked} from 'marked';
import DOMPurify from 'dompurify';
import {useChatQuote,quoteFunded,type ChatQuote} from './useChatQuote';
import {ChatBill,type TurnBill} from './ChatBill';
import {ModelSelect} from './ModelSelect';
import {ConversationList,type Conversation} from './ConversationList';
import {chatFreshness} from './freshness';
import {scrollMotion} from '../../app/motion';
import {chatSettingsHref,hasAvailableChatModels} from './guidance';

export type Message={id:number;role:'user'|'assistant';content:string;state:string;model:string;author_name:string;error?:string;turn?:string|null;context:string;reply_to:number|null};
type Snapshot={conversation:Conversation;messages:Message[];accepted_turn?:string};
type PendingSend={cid:string;body:{uid:string;model:string;text:string;expected_revision:number;price_revision:string|number;retry:number|null;context?:ChatContext;max_charge?:string}};
type Config={models:Record<string,{label:string;provider:string;billing?:"token"}>;pricing:{revision:number;items:{key:string;amount:number|null}[]};credits:{available:number;exact?:{available:string}}};
export type ChatContext={project:string;node:string;expected_revision:number;writeback?:boolean;script_ids?:string[];node_ids?:string[]};
export type ApplyOptions={automatic?:boolean;expectedText?:string;targetNode?:string;targetProject?:string;uid?:string};
type Props={workspace:number;userId:number;isAdmin?:boolean;configureLabel?:string;configureHref?:string;onConfigureModels?:(event:MouseEvent<HTMLButtonElement|HTMLAnchorElement>)=>void;compact?:boolean;inline?:boolean;onActivityChange?:(active:boolean)=>void;project?:string;node?:string;nodeTitle?:string;getContext?:()=>Promise<ChatContext>;onApply?:(cid:string,message:Message,mode:'new'|'replace',options?:ApplyOptions)=>Promise<void>;onClose?:()=>void;openCanvas?:(event:MouseEvent<HTMLAnchorElement>)=>void;onRecharge?:()=>void};
class ApiError extends Error {constructor(public status:number,message:string){super(message)}}
export async function chatRequest<T=any>(workspace:number,path:string,body?:unknown,method?:string):Promise<T>{
 const r=await fetch(path,{method:method||(body===undefined?'GET':'POST'),credentials:'same-origin',headers:{'Content-Type':'application/json','X-Workspace-Id':String(workspace)},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await r.json();if(!r.ok)throw new ApiError(r.status,typeof data.detail==='string'?data.detail:'操作未完成，请重试');return data;
}
function Markdown({text}:{text:string}){
 const html=useMemo(()=>DOMPurify.sanitize(marked.parse(text,{async:false,gfm:true,breaks:true}) as string,{ALLOWED_TAGS:['p','br','strong','em','del','ul','ol','li','blockquote','pre','code','h1','h2','h3','h4','hr','a','table','thead','tbody','tr','th','td'],ALLOWED_ATTR:['href','title'],ALLOW_DATA_ATTR:false,ALLOWED_URI_REGEXP:/^(?:https?:|mailto:)/i}),[text]);
 return <div className="fm-chat-prose" dangerouslySetInnerHTML={{__html:html}} onClick={e=>{const a=(e.target as HTMLElement).closest('a');if(a){e.preventDefault();if(/^https?:|^mailto:/i.test(a.href))window.open(a.href,'_blank','noopener,noreferrer')}}}/>;
}
const DRAFT_LIMIT=12000,DRAFT_WARN=10800;
const Credit=()=> <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 1c1.7 7 4 9.3 11 11-7 1.7-9.3 4-11 11C10.3 16 8 13.7 1 12 8 10.3 10.3 8 12 1Z"/></svg>;

export function ChatWorkspace(props:Props){
 const {workspace,userId,compact,inline,project,node}=props;
 const [narrow,setNarrow]=useState(false);
 const historyToggle=useRef<HTMLButtonElement>(null),historyClose=useRef<HTMLButtonElement>(null);
 const wasOverlayOpen=useRef(false);
 const historyOverlay=!!compact||narrow;
 useEffect(()=>{
  const query=matchMedia('(max-width: 760px)');
  const sync=()=>setNarrow(query.matches);
  sync();
  query.addEventListener('change',sync);
  return ()=>query.removeEventListener('change',sync);
 },[]);

 const scope=`fm-chat-${userId}-${workspace}-${project||'main'}-${node||''}`;
 const acceptConversation=useMemo(()=>chatFreshness(),[scope]);
 const [list,setList]=useState<Conversation[]>([]),[data,setData]=useState<Snapshot|null>(null),[cid,setCid]=useState(()=>sessionStorage.getItem(scope+'-active')||''),[config,setConfig]=useState<Config|null>(null),[selectedModel,setModel]=useState('deepseek-flash');
 const model=config?.models[selectedModel]?selectedModel:'';
 const [draft,setDraft]=useState(()=>sessionStorage.getItem(scope+'-draft-'+cid)||''),[pendingDraft,setPendingDraft]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(true),[history,setHistory]=useState(false),[rename,setRename]=useState<string|null>(null),[notice,setNotice]=useState(''),[deleted,setDeleted]=useState(''),[copied,setCopied]=useState<number|null>(null),[network,setNetwork]=useState(false),[newBelow,setNewBelow]=useState(false),[clipped,setClipped]=useState(0);
 const [picker,setPicker]=useState<Message|null>(null),[projects,setProjects]=useState<{id:string;title:string}[]>([]),[target,setTarget]=useState(''),[canvasName,setCanvasName]=useState('新画布');
 const [applied,setApplied]=useState<{id:string;message:number}|null>(null);
 const [listLoading,setListLoading]=useState(true),[listError,setListError]=useState('');
 const [writes,setWrites]=useState<Record<string,{cid:string;uid:string}>>(()=>{try{return JSON.parse(sessionStorage.getItem(scope+'-writes')||'{}')}catch{return {}}}),[applying,setApplying]=useState(false),[updatedMessage,setUpdatedMessage]=useState<number|null>(null);
 const writing=useRef<number|null>(null);
 const saveWrites=(fn:(current:Record<string,{cid:string;uid:string}>)=>Record<string,{cid:string;uid:string}>)=>setWrites(current=>{const next=fn(current);sessionStorage.setItem(scope+'-writes',JSON.stringify(next));return next});
 const forgetWrite=(id:number)=>saveWrites(current=>{const next={...current};delete next[id];return next});
 const deletedWasCurrent=useRef(false);
 const operationPending=useRef(false);
 const creatingConversation=useRef(false);
 const initialHistory=useRef(true), cfgRef=useRef<Config|null>(null);
 const scroll=useRef<HTMLDivElement>(null),input=useRef<HTMLTextAreaElement>(null),follow=useRef(true),alive=useRef(true),current=useRef(cid),pending=useRef<{signature:string;uid:string}|null>(null);
 const [pendingVersion,refreshPending]=useState(0);
 const pendingKey=(id:string)=>scope+'-pending-send-'+id;
 const waiting=useMemo(()=>{
  if(!cid)return null;
  try{const value=JSON.parse(sessionStorage.getItem(pendingKey(cid))||'null') as PendingSend|null;return value?.cid===cid&&value.body?.uid?value:null}catch{return null}
 },[scope,cid,pendingVersion]);
 const savePending=(p:PendingSend,done=false)=>{
  if(done)sessionStorage.removeItem(pendingKey(p.cid));else sessionStorage.setItem(pendingKey(p.cid),JSON.stringify(p));
  refreshPending(v=>v+1);
 };
 const req=<T=any,>(path:string,body?:unknown,method?:string)=>chatRequest<T>(workspace,path,body,method);
 const loadList=async()=>{const started=acceptConversation.startList();try{const r=await req<{conversations:Conversation[]}>('/api/chats'+(project?'?project='+encodeURIComponent(project)+'&node='+encodeURIComponent(node||''):''));if(alive.current){setList(items=>acceptConversation.reconcile(r.conversations,items,started));setListError('');if(initialHistory.current&&compact&&!current.current&&r.conversations.length){const id=r.conversations[0].id;current.current=id;setCid(id);sessionStorage.setItem(scope+'-active',id)}initialHistory.current=false}}catch(e){if(alive.current)setListError((e as Error).message);throw e}finally{if(alive.current)setListLoading(false)}};
 const loadConfig=async()=>{const c=await req<Config>('/api/chat/config');if(alive.current){cfgRef.current=c;setConfig(c);setModel(m=>m in c.models?m:Object.keys(c.models)[0]||'')}};
 const update=(s:Snapshot)=>{if(!alive.current||!acceptConversation(s.conversation))return;if(s.conversation.id===current.current)setData(s);setList(items=>[s.conversation,...items.filter(c=>c.id!==s.conversation.id)].sort((a,b)=>b.updated-a.updated));};
 const updateDraft=(value:string,pasted=false)=>{setDraft(value);setPendingDraft(null);if(!pasted&&value.length<DRAFT_LIMIT)setClipped(0);const key=scope+'-draft-'+current.current;if(value)sessionStorage.setItem(key,value);else sessionStorage.removeItem(key)};
 const measurePaste=(e:ClipboardEvent<HTMLTextAreaElement>)=>{const field=e.currentTarget,text=e.clipboardData.getData('text/plain').replace(/\r\n?/g,'\n');let room=DRAFT_LIMIT-field.value.length+field.selectionEnd-field.selectionStart;if(/[\uD800-\uDBFF]/.test(text[room-1]??''))room--;setClipped(room<text.length?[...text.slice(room)].length:0)};
 const applyPresetDraft=(value:string)=>{if(!draft.trim()||draft===value){updateDraft(value);input.current?.focus();return}setPendingDraft(value)};
 const confirmPendingDraft=()=>{if(pendingDraft===null)return;updateDraft(pendingDraft);input.current?.focus()};
 const cancelPendingDraft=()=>{setPendingDraft(null);input.current?.focus()};
 const choose=(id:string)=>{setDraft(sessionStorage.getItem(scope+'-draft-'+id)||'');setPendingDraft(null);setClipped(0);const found=list.find(c=>c.id===id);if(found&&config?.models[found.model])setModel(found.model);current.current=id;setCid(id);setData(null);setError('');setRename(null);setPicker(null);setHistory(false);pending.current=null;setLoading(!!id);follow.current=true;setNewBelow(false);sessionStorage.setItem(scope+'-active',id)};
 const switchConversation=(id:string)=>{
  if(creatingConversation.current)return;
  if(id===current.current){setHistory(false);return}
  choose(id);
 };
 useEffect(()=>{alive.current=true;setListLoading(true);setListError('');void Promise.all([loadConfig(),inline?loadList():loadList().catch(()=>{})]).catch(e=>setError(e.message)).finally(()=>setLoading(false));const timer=setInterval(()=>{void loadConfig().catch(()=>{});void loadList().catch(()=>{})},10000);return()=>{alive.current=false;clearInterval(timer)}},[workspace,project,node]);
 useEffect(()=>{if(input.current&&!inline){input.current.style.height='0px';input.current.style.height=Math.min(input.current.scrollHeight,180)+'px'}},[draft,cid,inline]);
 useEffect(()=>{
  if(!cid)return;let closed=false;const url='/api/chats/'+cid;
  void req<Snapshot>(url).then(s=>{if(!closed){update(s);setModel(m=>s.conversation.model in (cfgRef.current?.models||{})?s.conversation.model:m);setLoading(false)}}).catch(e=>{if(!closed){if(e.status===404)choose('');setError(e.message);setLoading(false)}});
  const events=new EventSource(url+'/events?workspace='+workspace);
  events.onmessage=e=>{if(closed)return;setNetwork(false);const next=JSON.parse(e.data) as Snapshot;update(next);setLoading(false)};
  events.onerror=()=>{if(!closed)setNetwork(true)};
  events.addEventListener('unavailable',()=>{events.close();if(!closed){setError('这段对话已删除或你已无权访问');setData(null);setLoading(false)}});
  return()=>{closed=true;events.close()};
 },[cid,workspace]);
 useEffect(()=>{if(follow.current&&scroll.current){scroll.current.scrollTop=scroll.current.scrollHeight;setNewBelow(false)}else if(data?.conversation.active_turn)setNewBelow(true)},[data?.messages]);
 useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),4000);return()=>clearTimeout(t)},[notice]);
 useEffect(()=>{
  if(!data||!props.onApply||writing.current!==null)return;
  const message=data.messages.find(m=>m.role==='assistant'&&m.state!=='running'&&writes[m.id]?.cid===data.conversation.id);
  if(!message)return;
  if(message.state!=='complete'){forgetWrite(message.id);return}
  const source=data.messages.find(m=>m.id===message.reply_to);let context:any={};try{context=JSON.parse(source?.context||'{}')}catch{}
  if(!context.writeback||context.project!==project||context.node!==node||typeof context.text!=='string'){forgetWrite(message.id);return}
  writing.current=message.id;setApplying(true);
  void props.onApply(data.conversation.id,message,'replace',{automatic:true,expectedText:context.text,targetNode:context.node,targetProject:context.project,uid:writes[message.id].uid})
   .then(()=>{if(alive.current){setUpdatedMessage(message.id);setNotice('已更新节点文字，可撤销')}})
   .catch(e=>{if(alive.current)setError((e as Error).message)})
   .finally(()=>{forgetWrite(message.id);writing.current=null;if(alive.current)setApplying(false)});
 },[data,writes,project,node]);
 const running=!!data?.conversation.active_turn;
 const activeWork=busy||running||applying||Object.keys(writes).length>0;
 const activityCallback=useRef(props.onActivityChange);activityCallback.current=props.onActivityChange;
 useEffect(()=>{activityCallback.current?.(activeWork)},[activeWork]);
 const native=config?.models[model]?.billing==="token";
 const balance=config?.credits.exact?.available;
 const revision=data?.conversation.revision;
 const latest=data?.messages.at(-1);
 const retryId=latest && ['failed','stopped','interrupted'].includes(latest.state)?latest.id:undefined;
 const quoteKey=JSON.stringify([workspace,model,cid,revision,project,node,config?.pricing.revision,balance]);
 const quoteFor=async(text:string,retry?:number)=>req<ChatQuote>('/api/chat/quote',{cid:cid||null,model,text,retry,context:await props.getContext?.()});
 const offered=useChatQuote(native&&!waiting&&!running&&draft.trim()?JSON.stringify([quoteKey,draft]):null,()=>quoteFor(draft));
 const retryOffer=useChatQuote(native&&!waiting&&!running&&retryId?JSON.stringify([quoteKey,retryId]):null,()=>quoteFor('',retryId));
 const fixedPrice=config?.pricing.items.find(p=>p.key===model+'|reply')?.amount;
 const price=native?offered.quote?.max_charge:fixedPrice;
 const funds=(p:string|number|null|undefined)=>!!config&&quoteFunded(balance,config.credits.available,p);
 const creditNotice=model&&config&&!running&&(native
  ? (offered.error||retryOffer.error)&&<p className="fm-chat-balance" role="status">{offered.error||retryOffer.error}<button type="button" onClick={()=>{offered.refresh();retryOffer.refresh()}}>重新报价</button>{props.onRecharge&&<button type="button" onClick={props.onRecharge}>去充值</button>}</p>
  : price==null?<p className="fm-chat-balance" role="status">当前对话模型尚未定价</p>
  : !funds(price)&&<p className="fm-chat-balance" role="status">当前空间积分不足{props.onRecharge&&<button type="button" onClick={props.onRecharge}>去充值</button>}</p>);
 const ready=!!model&&!waiting&&!busy&&!applying&&!running&&!loading&&(!cid||!!data);
 const canSend=ready&&funds(price);
 const canRetry=ready&&funds(native?retryOffer.quote?.max_charge:fixedPrice);
 const [billing,setBilling]=useState<{cid:string;bills:TurnBill[];error?:string}>();
 const [billVersion,refreshBills]=useState(0);
 useEffect(()=>{
  if(!cid||!revision)return;
  let current=true;
  void req<{bills:TurnBill[]}>('/api/chats/'+cid+'/bills').then(r=>{if(current)setBilling({cid,bills:r.bills})},
   ()=>{if(current)setBilling({cid,bills:[],error:'账单载入失败'})});
  return ()=>{current=false};
 },[cid,workspace,revision,billVersion]);
 const bills=billing?.cid===cid?billing.bills:[];
 const billError=billing?.cid===cid&&billing.error&&<button type="button" onClick={()=>refreshBills(v=>v+1)}>账单载入失败，重试</button>;
 const priceLabel=native?'本次最高扣费':'每条完整回复';
 const priceHint=price==null?(native?(offered.error?'报价不可用':draft.trim()?'报价中':'按 Token 计费'):'未定价'):undefined;
 const cost=<span className="fm-chat-cost fm-number" title={price!=null?`${priceLabel} ${price} 积分，可用 ${config?.credits.available}`:priceHint} aria-label={price!=null?`${priceLabel} ${price} 积分`:priceHint}>{priceHint??<><Credit/>{native?'最高 ':''}{price}</>}</span>;
 const noModels=hasAvailableChatModels(config)===false;
 const canConfigure=props.isAdmin??Boolean(props.onConfigureModels||props.configureHref);
 const configureLabel=props.configureLabel||'前往配置对话模型';
 const resolvedConfigureHref=props.configureHref||(props.onConfigureModels?undefined:chatSettingsHref(workspace));
 const renderConfigureAction=(primary:boolean)=>resolvedConfigureHref?(
  <a className={primary?'fm-chat-primary':'fm-chat-no-model-link'} href={resolvedConfigureHref} onClick={props.onConfigureModels}>{configureLabel}</a>
 ):(
  <button type="button" className={primary?'fm-chat-primary':undefined} onClick={props.onConfigureModels}>{configureLabel}</button>
 );
 const noModelBanner=noModels&&(
  <div className="fm-chat-notice fm-chat-no-model" role="status">
   <span>{canConfigure?'当前空间暂无可用对话模型':'当前空间暂无可用对话模型，请联系管理员开通'}</span>
   {canConfigure&&renderConfigureAction(false)}
  </div>
 );
 const safely=async(fn:()=>Promise<void>)=>{
  if(operationPending.current)return;
  operationPending.current=true;setError('');setBusy(true);
  try{await fn()}catch(e){if(alive.current)setError((e as Error).message)}
  finally{operationPending.current=false;creatingConversation.current=false;if(alive.current)setBusy(false)}
 };
 const transmit=async(p:PendingSend)=>{
  const {cid:sentId,body}=p;
  let result:Snapshot;
  try{result=await req<Snapshot>('/api/chats/'+sentId+'/messages',body)}
  catch(e){
   if(e instanceof ApiError&&e.status>=400&&e.status<500){
    savePending(p,true);
    if(e.status===409){
     offered.refresh();retryOffer.refresh();update(await req('/api/chats/'+sentId));await loadConfig();
    }
   }
   throw e;
  }
  savePending(p,true);
  if(body.context?.writeback&&props.onApply){
   const reply=result.accepted_turn?result.messages.find(m=>m.turn===result.accepted_turn):[...result.messages].reverse().find(m=>m.role==='assistant');
   if(reply)saveWrites(current=>({...current,[reply.id]:{cid:result.conversation.id,uid:current[reply.id]?.uid||crypto.randomUUID()}}));
  }
  update(result);
  if(!body.retry)setDraft(latest=>{
    const key=scope+'-draft-'+sentId;
    if(current.current!==sentId){if(sessionStorage.getItem(key)===body.text)sessionStorage.removeItem(key);return latest}
    if(latest===body.text){sessionStorage.removeItem(key);return ''}
    return latest;
  });
  pending.current=null;follow.current=true;await loadConfig();
 };
 const confirmSend=waiting&&!busy&&<button className="fm-chat-primary" type="button" onClick={()=>void safely(()=>transmit(waiting))}>确认上次发送</button>;
 const send=async(retry?:number)=>safely(async()=>{
  const quote=retry?retryOffer.quote:offered.quote;
  if(waiting||!model||(!retry&&!draft.trim())||(native&&!quote))return;
  setPendingDraft(null);
  let active=data;
  creatingConversation.current=!active;
  const context=props.getContext?await props.getContext():undefined;
  if(!active){active=await req<Snapshot>('/api/chats',{model,context});const key=scope+'-draft-';const saved=sessionStorage.getItem(key);if(saved!==null){sessionStorage.setItem(key+active.conversation.id,saved);sessionStorage.removeItem(key)}current.current=active.conversation.id;setCid(active.conversation.id);sessionStorage.setItem(scope+'-active',active.conversation.id);setData(active)}
  creatingConversation.current=false;
  const signature=JSON.stringify([active.conversation.id,model,draft,retry]);
  if(pending.current?.signature!==signature)pending.current={signature,uid:crypto.randomUUID()};
  const request={cid:active.conversation.id,body:{uid:pending.current.uid,model,text:retry?'':draft,expected_revision:active.conversation.revision,price_revision:config!.pricing.revision,...quote,retry:retry||null,context}};
  savePending(request);await transmit(request);
 });
 const stop=()=>safely(async()=>{update(await req('/api/chats/'+cid+'/stop',{}));await loadConfig()});
 const removeConversation=async(item:Conversation)=>{const r=await req<{conversation:Pick<Conversation,'id'|'revision'>}>('/api/chats/'+item.id,undefined,'DELETE');acceptConversation.remove(r.conversation);deletedWasCurrent.current=item.id===current.current;setDeleted(item.id);setList(items=>items.filter(c=>c.id!==item.id));if(deletedWasCurrent.current)choose('');setHistory(false)};
 const remove=()=>safely(async()=>{if(data)await removeConversation(data.conversation)});
 const restore=()=>safely(async()=>{const r=await req<Snapshot>('/api/chats/'+deleted+'/restore',{});if(deletedWasCurrent.current&&!current.current)choose(deleted);update(r);setDeleted('');await loadList()});
 const copy=async(m:Message)=>{try{await navigator.clipboard.writeText(m.content);setCopied(m.id);setTimeout(()=>setCopied(null),2000)}catch{setError('复制失败，请选择文字手动复制')}};
 const adopt=(m:Message,mode:'new'|'replace')=>safely(async()=>{if(props.onApply){const source=data?.messages.find(item=>item.id===m.reply_to);let context:any={};try{context=JSON.parse(source?.context||'{}')}catch{}await props.onApply(cid,m,mode,{expectedText:typeof context.text==='string'?context.text:undefined,targetNode:typeof context.node==='string'&&context.node?context.node:undefined,targetProject:typeof context.project==='string'&&context.project?context.project:undefined});setNotice(mode==='new'?'已新建文本节点':'已替换节点文字')}else{setPicker(m);setTarget('');const r=await req('/api/canvases');setProjects(r.projects)}});
 const confirmCanvas=()=>safely(async()=>{
  if(!picker)return;
  const p=target?await req('/api/canvases/'+target):await req('/api/canvases',{title:canvasName.trim()||'新画布'});
  const result=await req('/api/chats/'+cid+'/apply',{uid:crypto.randomUUID(),message:picker.id,project:p.id,expected_revision:p.revision,mode:'new'});
  setApplied({id:result.id,message:picker.id});setPicker(null);setNotice('已放入画布');
 });
 const inlineFailure=latest&&['failed','stopped','interrupted'].includes(latest.state)?latest.error||(latest.state==='stopped'?'已停止，积分已退回':'生成中断，积分已退回'):'';
 const draftLimit=draft.length>=DRAFT_WARN&&<p className="fm-chat-balance fm-chat-limit fm-number">{draft.length}/{DRAFT_LIMIT} 字{clipped>0&&<span role="alert">，已达上限，粘贴内容末尾 {clipped} 字未保留</span>}</p>;
 const draftConfirmBanner=pendingDraft!==null&&(
  <div
   className="fm-chat-notice fm-chat-draft-confirm"
   role="status"
   onKeyDown={e=>{if(e.key==='Escape'){cancelPendingDraft();e.stopPropagation()}}}
   style={{flexWrap:'wrap',gap:'8px 12px',padding:'8px 12px',borderRadius:10,background:'var(--chat-surface)',border:'1px solid var(--chat-line)',color:'var(--chat-text)',margin:inline?'0 6px 8px':'0 0 10px'}}
  >
   <span style={{flex:'1 1 200px',minWidth:0,overflowWrap:'anywhere'}}>当前输入框已有草稿，是否替换为「{pendingDraft}」？</span>
   <span style={{display:'inline-flex',alignItems:'center',gap:8,flexShrink:0}}>
    <button type="button" className="fm-chat-primary" disabled={inline&&(busy||running)} style={{textDecoration:'none',padding:'4px 10px',borderRadius:6}} onClick={confirmPendingDraft}>替换当前草稿</button>
    <button type="button" style={{textDecoration:'none',padding:'4px 8px',color:'var(--chat-muted)'}} onClick={cancelPendingDraft}>取消</button>
   </span>
  </div>
 );
 useLayoutEffect(()=>{
  const open=historyOverlay&&history;
  if(open) historyClose.current?.focus({preventScroll:true});
  else if(wasOverlayOpen.current&&historyOverlay) historyToggle.current?.focus({preventScroll:true});
  wasOverlayOpen.current=open;
 },[history,historyOverlay]);
 if(inline)return <div className="fm-chat fm-chat-node" onKeyDown={e=>{if(e.key==='Escape'&&pendingDraft!==null){cancelPendingDraft();e.stopPropagation()}}}>
  <form className="fm-text-form" onSubmit={e=>{e.preventDefault();if(canSend)void send()}}>
   {noModelBanner||(model&&<div className="fm-text-presets">{[['补充镜头','保留原意，补充画面主体、动作、镜头运动和环境细节，只输出可直接使用的镜头提示词。'],['改写图生视频','基于当前文字改写为图生视频提示词，重点描述动作、镜头和画面变化，不虚构参考图片中未提供的事实。只输出提示词。']].map(([label,text])=><button type="button" key={label} disabled={busy||running} onClick={()=>applyPresetDraft(text)}>{label}</button>)}</div>)}
   {draftConfirmBanner}
   <textarea ref={input} className="composer-prompt" aria-label="文本生成要求" placeholder={model?'描述你想生成的文字，或说明修改要求':'暂无可用模型'} value={draft} maxLength={DRAFT_LIMIT} rows={3} onChange={e=>updateDraft(e.target.value,(e.nativeEvent as InputEvent).inputType==='insertFromPaste')} onPaste={measurePaste} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(canSend&&draft.trim())void send()}}}/>
   {(error||inlineFailure)&&<div className="fm-chat-error" role="alert"><span>{error||inlineFailure}</span>{error&&<button type="button" className="fm-chat-icon" aria-label="关闭错误提示" onClick={()=>setError('')}><X size={14}/></button>}</div>}
   {network&&<p className="fm-text-state" role="status">正在重新连接</p>}
   <div className="composer-bottom fm-text-bottom">
    {model&&config&&<><ModelSelect models={config.models} value={model} disabled={busy||applying||running} onChange={setModel}/>
    {cost}</>}
    {(running||applying)&&<span className="fm-text-state" role="status">{applying?'正在写入':'生成中'}</span>}
    {running?<button type="button" className="fm-chat-send" aria-label="停止生成" onClick={()=>void stop()} disabled={busy}><Square className="fm-state-change" size={15} fill="currentColor"/></button>:model&&<button type="submit" className="fm-chat-send" aria-label="生成文本" disabled={!canSend||!draft.trim()}><ArrowUp className="fm-state-change" size={21}/></button>}
   </div>
   {draftLimit}
   {confirmSend}{!waiting&&creditNotice}
   {billError}{bills.filter(b=>b.user_message===latest?.reply_to).map(b=><ChatBill key={b.turn} bill={b}/>)}
  </form>
 </div>;
 const headerTitle=compact?props.nodeTitle||'AI 写作':data?.conversation.title||'新对话';
 return <div onKeyDown={e=>{if(e.key==='Escape'&&pendingDraft!==null){cancelPendingDraft();e.stopPropagation();return}if(e.key==='Escape'&&history){setHistory(false);e.stopPropagation()}}} data-history-overlay={historyOverlay||undefined} className={'fm-chat '+(compact?'fm-chat-compact ':'')+(history?'fm-chat-history-open':'')}>
  <aside className="fm-chat-history" aria-label="对话历史" inert={historyOverlay&&!history}>
   <div className="fm-chat-history-top"><h2>对话</h2><button type="button" className="fm-chat-icon" aria-label="关闭对话历史" ref={historyClose} onClick={()=>setHistory(false)}><X size={18}/></button></div>
   <button type="button" className="fm-chat-new" disabled={busy&&creatingConversation.current} onClick={()=>switchConversation('')}><Plus size={18}/>新对话</button>
   <ConversationList items={list} loading={listLoading} loadError={listError} selected={cid} busy={busy&&creatingConversation.current} onChoose={switchConversation} onRefresh={loadList} onDelete={removeConversation} onRename={async(item,title)=>{update(await req<Snapshot>('/api/chats/'+item.id,{title,expected_revision:item.revision},'PATCH'))}}/>
  </aside>
  {historyOverlay&&history&&<button type="button" className="fm-chat-history-backdrop" aria-hidden="true" tabIndex={-1} onClick={()=>setHistory(false)}/>}
  <section className="fm-chat-main" aria-label="AI 对话" inert={historyOverlay&&history}>
   <header className="fm-chat-header"><button type="button" className="fm-chat-icon fm-chat-history-toggle" ref={historyToggle} aria-expanded={history} aria-label="对话历史" onClick={()=>setHistory(!history)}><PanelLeft size={18}/></button>
    {rename!==null?<form className="fm-chat-rename" onSubmit={e=>{e.preventDefault();void safely(async()=>{update(await req('/api/chats/'+cid,{title:rename,expected_revision:data!.conversation.revision},'PATCH'));setRename(null)})}}><input autoFocus maxLength={80} aria-label="对话名称" value={rename} onChange={e=>setRename(e.target.value)}/><button className="fm-chat-icon" type="submit" disabled={busy||!rename.trim()} aria-label="保存名称"><Check size={16}/></button><button className="fm-chat-icon" type="button" onClick={()=>setRename(null)} aria-label="取消改名"><X size={16}/></button></form>:<h1 title={headerTitle}>{headerTitle}</h1>}
    <div className="fm-chat-header-actions">{data&&!compact&&rename===null&&<button type="button" className="fm-chat-icon" aria-label="重命名对话" disabled={busy} onClick={()=>setRename(data.conversation.title)}><Pencil size={16}/></button>}{data?.conversation.can_delete&&<button type="button" className="fm-chat-icon" aria-label="删除对话" disabled={running||busy} onClick={()=>void remove()}><Trash2 size={16}/></button>}{compact&&<button type="button" className="fm-chat-icon" aria-label="新对话" disabled={busy&&creatingConversation.current} onClick={()=>switchConversation('')}><Plus size={18}/></button>}{props.onClose&&<button type="button" className="fm-chat-icon" aria-label="关闭 AI 写作" onClick={props.onClose}><X size={18}/></button>}</div>
   </header>
   <div className="fm-chat-scroll" ref={scroll} onScroll={()=>{const e=scroll.current!;follow.current=e.scrollHeight-e.scrollTop-e.clientHeight<80;if(follow.current)setNewBelow(false)}}>
    <div className="fm-chat-messages">
     {(loading||(!config&&!error))&&!data?<p className="fm-chat-empty-note" role="status">正在载入对话…</p>:!data?.messages.length?(noModels?<div className="fm-chat-empty fm-chat-empty-unavailable" role="status"><MessageSquare size={28} strokeWidth={1.5}/><h2>暂无可用对话模型</h2><p>{canConfigure?'当前空间暂无可用对话模型，请前往设置完成配置或开通模型权限。':'当前空间暂无可用对话模型，请联系管理员开通。'}</p>{canConfigure&&<div className="fm-chat-empty-actions">{renderConfigureAction(true)}</div>}</div>:<div className="fm-chat-empty"><MessageSquare size={28} strokeWidth={1.5}/><h2>{compact?'想怎样修改这段文字？':'从一个想法开始'}</h2><p>{compact?'回复完成后更新节点文字，可撤销。':'构思故事、打磨文案，或整理下一支视频的提示词。'}</p><div className="fm-chat-starters">{(compact?['润色这段文字','改写成视频提示词']:['帮我构思一段视频脚本','把灵感整理成拍摄提纲']).map(s=><button type="button" key={s} onClick={()=>applyPresetDraft(s)}>{s}<ArrowUp size={14}/></button>)}</div></div>):data.messages.map((m,index)=><article key={m.id} className={'fm-chat-message '+m.role}>
      {m.role==='user'?<><div className="fm-chat-author">{m.author_name||'你'}</div><div className="fm-chat-bubble">{m.content}</div>{JSON.parse(m.context||'{}').node&&<small className="fm-chat-context-tag"><FileText size={13}/>含节点文字</small>}</>:<><div className="fm-chat-author">{config?.models[m.model]?.label||({'deepseek-flash':'DeepSeek Flash','gpt-4.1':'GPT-4.1'}[m.model]||m.model)}</div>{m.content?<Markdown text={m.content}/>:m.state==='running'?<p className="fm-chat-wait fm-state-change" role="status"><LoaderCircle size={15} className="fm-chat-spinner"/>正在回复</p>:null}{m.state!=='running'&&m.state!=='complete'&&<p className="fm-chat-incomplete fm-state-change">{m.error||(m.state==='stopped'?'已停止，积分已退回':'回复中断，积分已退回')}</p>}
       <div className="fm-chat-message-actions">{m.content&&<button type="button" aria-label="复制回答" title={copied===m.id?'已复制':'复制回答'} onClick={()=>void copy(m)}>{copied===m.id?<Check className="fm-state-change" size={16}/>:<Copy className="fm-state-change" size={16}/>}</button>}{m.state==='complete'&&<>{updatedMessage===m.id&&<span className="fm-chat-written fm-state-change"><Check size={14}/>已更新文字</span>}{props.onApply&&(()=>{const src=data.messages.find(item=>item.id===m.reply_to);let ctx:any={};try{ctx=JSON.parse(src?.context||'{}')}catch{}return Boolean(ctx.node&&typeof ctx.text==='string'&&(!project||!ctx.project||ctx.project===project))?<button type="button" disabled={busy||applying} onClick={()=>void adopt(m,'replace')}>替换文字</button>:null})()}<button type="button" disabled={busy} onClick={()=>void adopt(m,'new')}><Plus size={14}/>{compact?'新建文本节点':'放入画布'}</button>{applied?.message===m.id&&<a href={'/canvas/'+applied.id+'?workspace='+workspace} onClick={props.openCanvas}>打开画布<ExternalLink size={13}/></a>}</>}{index===data.messages.length-1&&['failed','stopped','interrupted'].includes(m.state)&&<button type="button" disabled={!canRetry} onClick={()=>void send(m.id)}><RotateCcw size={14}/>重试{native&&retryOffer.quote&&` · 最高 ${retryOffer.quote.max_charge} 积分`}</button>}</div>{bills.filter(b=>b.message===m.id||(b.superseded&&b.user_message===m.reply_to)).map(b=><ChatBill key={b.turn} bill={b}/>)}</>}
     </article>)}{billError}
    </div>
   </div>
   {newBelow&&<button type="button" className="fm-chat-latest fm-chat-icon" aria-label="查看最新回复" onClick={()=>{follow.current=true;scroll.current?.scrollTo({top:scroll.current.scrollHeight,behavior:scrollMotion()});setNewBelow(false)}}><ArrowDown size={18}/></button>}
   <div className="fm-chat-compose-area">
    {picker&&<section className="fm-chat-canvas-picker fm-reveal" aria-label="放入画布"><header><strong>放入画布</strong><button type="button" className="fm-chat-icon" aria-label="取消放入画布" onClick={()=>setPicker(null)}><X size={16}/></button></header><select aria-label="选择画布" value={target} onChange={e=>setTarget(e.target.value)}><option value="">新建画布</option>{projects.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select>{!target&&<input aria-label="画布名称" value={canvasName} maxLength={80} onChange={e=>setCanvasName(e.target.value)}/>}<button type="button" className="fm-chat-primary" disabled={busy} onClick={()=>void confirmCanvas()}>添加文本节点</button></section>}
    {deleted&&<div className="fm-chat-notice" role="status">对话已删除<button type="button" disabled={busy} onClick={()=>void restore()}>撤销</button><button type="button" className="fm-chat-icon" aria-label="关闭删除提示" onClick={()=>setDeleted('')}><X size={14}/></button></div>}
    {notice&&<div className="fm-chat-notice" role="status">{notice}</div>}
    {!!data?.messages.length&&noModelBanner}
    {network&&<div className="fm-chat-notice" role="status">正在重新连接，回复会在后台继续</div>}
    {error&&<div className="fm-chat-error" role="alert"><span>{error}</span><button type="button" className="fm-chat-icon" aria-label="关闭错误提示" onClick={()=>setError('')}><X size={16}/></button></div>}
    {draftConfirmBanner}
    <form className="fm-chat-composer" onSubmit={e=>{e.preventDefault();if(canSend)void send()}}>
     <textarea ref={input} aria-label="发送消息" placeholder={model?(compact?'说说你的修改想法…':'发送消息…'):'暂无可用模型'} value={draft} maxLength={DRAFT_LIMIT} rows={2} onChange={e=>updateDraft(e.target.value,(e.nativeEvent as InputEvent).inputType==='insertFromPaste')} onPaste={measurePaste} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(canSend&&draft.trim())void send()}}}/>
     {(model||running)&&<div className="fm-chat-composer-bottom">{model&&config&&<><ModelSelect models={config.models} value={model} disabled={busy||applying||running} onChange={setModel}/>{cost}</>}{running?<button type="button" className="fm-chat-send" aria-label="停止回复" onClick={()=>void stop()} disabled={busy}><Square className="fm-state-change" size={15} fill="currentColor"/></button>:<button type="submit" className="fm-chat-send" aria-label="发送" disabled={!canSend||!draft.trim()}><ArrowUp className="fm-state-change" size={21}/></button>}</div>}
    </form>
    {draftLimit}
    {confirmSend}{!waiting&&creditNotice}
   </div>
  </section>
 </div>;
}
