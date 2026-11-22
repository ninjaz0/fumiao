import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Check,LoaderCircle,Pencil,Trash2,X} from 'lucide-react';

export type Conversation={id:string;title:string;model:string;revision:number;active_turn:string|null;can_delete:boolean;updated:number};
type Props={items:Conversation[];loading?:boolean;loadError?:string;selected:string;onChoose:(id:string)=>void;onRename:(item:Conversation,title:string)=>Promise<void>;onDelete:(item:Conversation)=>Promise<void>;onRefresh:()=>Promise<void>};

export function ConversationList({items,loading,loadError,selected,onChoose,onRename,onDelete,onRefresh}:Props){
 const [menu,setMenu]=useState<{id:string;x:number;y:number}|null>(null),[editing,setEditing]=useState<{id:string;title:string}|null>(null),[working,setWorking]=useState(''),[error,setError]=useState('');
 const root=useRef<HTMLDivElement>(null),popup=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null),opener=useRef<HTMLElement|null>(null);
 const target=items.find(item=>item.id===menu?.id);
 const close=(restore=false)=>{setMenu(null);if(restore)opener.current?.focus()};
 const open=(item:Conversation,x:number,y:number,element:HTMLElement)=>{if(working||editing)return;opener.current=element;setError('');setMenu({id:item.id,x,y})};
 const focusRow=(id:string)=>root.current?.querySelector<HTMLButtonElement>(`[data-conversation="${CSS.escape(id)}"] .fm-chat-conversation-open`)?.focus();
 useLayoutEffect(()=>{
  if(!menu||!popup.current)return;
  const rect=popup.current.getBoundingClientRect();
  popup.current.style.left=Math.max(8,Math.min(menu.x,window.innerWidth-rect.width-8))+'px';
  popup.current.style.top=Math.max(8,Math.min(menu.y,window.innerHeight-rect.height-8))+'px';
  popup.current.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
 },[menu]);
 useEffect(()=>{
  if(!menu)return;
  const outside=(e:PointerEvent)=>{if(!popup.current?.contains(e.target as Node))close()};
  const moved=()=>close();
  document.addEventListener('pointerdown',outside);window.addEventListener('resize',moved);window.addEventListener('scroll',moved,true);
  return()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',moved);window.removeEventListener('scroll',moved,true)};
 },[menu]);
 useEffect(()=>{if(menu&&!target)close()},[menu,target]);
 useEffect(()=>{if(editing){input.current?.focus();input.current?.select()}},[editing?.id]);
 const rename=async()=>{
  const item=items.find(c=>c.id===editing?.id);if(!item||!editing?.title.trim()||working)return;
  setWorking(item.id);setError('');
  try{await onRename(item,editing.title.trim());setEditing(null);requestAnimationFrame(()=>focusRow(item.id))}
  catch(e){setError((e as Error).message);void onRefresh().catch(()=>{})}
  finally{setWorking('')}
 };
 const remove=async(item:Conversation)=>{
  close();setWorking(item.id);setError('');
  try{await onDelete(item)}catch(e){setError((e as Error).message);void onRefresh().catch(()=>{})}finally{setWorking('')}
 };
 return <div className="fm-chat-history-items" ref={root}>
  {loadError&&<div className="fm-chat-history-error" role="alert"><span>{loadError}</span><button type="button" disabled={!!working} onClick={async()=>{setWorking('refresh');try{await onRefresh()}catch{}finally{setWorking('')}}}>重试</button></div>}
  <div className="fm-chat-list">{loading?<p className="fm-chat-list-empty" role="status">正在载入对话历史…</p>:!items.length?(!loadError&&<p className="fm-chat-list-empty">暂无对话</p>):items.map(item=><div key={item.id} data-conversation={item.id} className={'fm-chat-conversation-row'+(selected===item.id?' selected':'')+(menu?.id===item.id?' menu-open':'')} onContextMenu={e=>{if(editing?.id===item.id)return;e.preventDefault();open(item,e.clientX,e.clientY,e.currentTarget.querySelector('button')!)}}>
   {editing?.id===item.id?<form className="fm-chat-row-rename" onSubmit={e=>{e.preventDefault();void rename()}} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(!working){setEditing(null);setError('');requestAnimationFrame(()=>focusRow(item.id))}}}}>
    <input ref={input} aria-label="对话名称" value={editing.title} maxLength={80} disabled={!!working} onChange={e=>setEditing({...editing,title:e.target.value})}/>
    <button type="submit" aria-label="保存名称" disabled={!!working||!editing.title.trim()}><Check size={15}/></button><button type="button" aria-label="取消改名" disabled={!!working} onClick={()=>{setEditing(null);setError('');requestAnimationFrame(()=>focusRow(item.id))}}><X size={15}/></button>
   </form>:<button type="button" className="fm-chat-conversation-open" aria-current={selected===item.id?'page':undefined} onClick={()=>onChoose(item.id)} onKeyDown={e=>{if(e.key==='ContextMenu'||e.key==='F10'&&e.shiftKey){e.preventDefault();const rect=e.currentTarget.getBoundingClientRect();open(item,rect.left+16,rect.bottom+4,e.currentTarget)}}}><span>{item.title}</span>{item.active_turn&&<LoaderCircle size={14} className="fm-chat-spinner" aria-label="正在回复"/>}</button>}
  </div>)}</div>
  {error&&<div className="fm-chat-history-error" role="alert"><span>{error}</span><button type="button" aria-label="关闭对话操作提示" onClick={()=>setError('')}><X size={14}/></button></div>}
  {menu&&target&&<div ref={popup} role="menu" aria-label="对话操作" className="fm-chat-context-menu" style={{left:menu.x,top:menu.y}} onContextMenu={e=>e.preventDefault()} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))close()}} onKeyDown={e=>{
   if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);return}
   if(e.key==='Tab'){e.preventDefault();close(true);return}
   const choices=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')),index=choices.indexOf(document.activeElement as HTMLButtonElement);
   const next=e.key==='ArrowDown'?(index+1)%choices.length:e.key==='ArrowUp'?(index-1+choices.length)%choices.length:e.key==='Home'?0:e.key==='End'?choices.length-1:-1;
   if(next>=0){e.preventDefault();choices[next]?.focus()}
  }}><button type="button" role="menuitem" onClick={()=>{setEditing({id:target.id,title:target.title});close()}}><Pencil size={16}/>重命名</button>{target.can_delete&&<button type="button" role="menuitem" disabled={!!target.active_turn} title={target.active_turn?'请等待回复结束后删除':undefined} onClick={()=>void remove(target)}><Trash2 size={16}/>删除</button>}</div>}
 </div>;
}
