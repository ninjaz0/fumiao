import {useEffect,useMemo,useRef,useState,type KeyboardEventHandler} from 'react';
import {Globe,Lock} from 'lucide-react';
import type {Asset} from './types';
import type {Pack} from './AssetPacks';
import type {MentionCandidate} from './ReferencePromptInput';
import {h3MediaType,h3TokenKey} from './h3References';
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function H3Prompt({value,ids,assets,frames,packs=[],onChange,onMountPack,onFocus,onBlur,onKeyDown}:{value:string;ids:string[];assets:Asset[];frames:boolean;packs?:Pack[];onChange:(s:string)=>void;onMountPack?:(pack:Pack)=>void;onFocus:()=>void;onBlur:()=>void;onKeyDown:KeyboardEventHandler<HTMLDivElement>}) {
 const editor=useRef<HTMLDivElement>(null),signature=useRef('');
 const [mentionQuery,setMentionQuery]=useState<string|null>(null);
 const [activeIdx,setActiveIdx]=useState(0);
 const read=()=>{
  function text(n:Node):string {
   if(n.nodeType===Node.TEXT_NODE)return n.textContent||'';
   if(!(n instanceof HTMLElement))return '';
   if(n.dataset.ref){const type=h3MediaType(n.dataset.ref,assets),i=ids.filter(k=>h3MediaType(k,assets)===type).indexOf(n.dataset.ref);return i<0?'':`<${type} ${i+1}>`;}
   if(n.tagName==='BR')return '\n';
   const v=[...n.childNodes].map(text).join('');return ['DIV','P'].includes(n.tagName)?v+'\n':v;
  }
  return [...editor.current?.childNodes||[]].map(text).join('').replace(/\n+$/,'');
 };
 const candidates=useMemo<MentionCandidate[]>(()=>{
  if(mentionQuery===null)return [];
  const q=mentionQuery.trim().toLowerCase();
  const list:MentionCandidate[]=[];
  for(const pack of packs){
   if(!q||pack.name.toLowerCase().includes(q)||pack.purpose.toLowerCase().includes(q)){
    list.push({kind:'pack',id:pack.id,label:pack.name,thumb:pack.media[0],pack});
   }
  }
  const picIds=ids.filter(k=>h3MediaType(k,assets)==='Picture');
  for(const [idx,mediaId] of picIds.entries()){
   const label=`图${idx+1}`;
   if(!q||label.includes(q)||`picture ${idx+1}`.includes(q)){
    list.push({kind:'ref',id:mediaId,label,thumb:mediaId,token:`<Picture ${idx+1}>`});
   }
  }
  return list.slice(0,8);
 },[mentionQuery,packs,ids,assets]);
 const detectMention=(raw:string)=>{
  const match=raw.match(/(?:^|[\s，。；、])@([^\s@]{0,24})$/);
  if(!match){setMentionQuery(null);return;}
  setMentionQuery(match[1]);
  setActiveIdx(0);
 };
 const applyCandidate=(cand:MentionCandidate)=>{
  const current=read();
  const atIndex=current.lastIndexOf('@');
  if(atIndex<0){setMentionQuery(null);return;}
  const insertion=cand.kind==='pack'?`@${cand.label} `:`${cand.token} `;
  const next=(current.slice(0,atIndex)+insertion).slice(0,12000);
  setMentionQuery(null);
  onChange(next);
  if(cand.kind==='pack'&&onMountPack)onMountPack(cand.pack);
 };
 useEffect(()=>{
  const el=editor.current;if(!el)return;const key=JSON.stringify([ids,frames]);if(read()===value&&signature.current===key)return;
  let cursor=0,html='';for(const match of value.matchAll(/<(Picture|Video|Audio) (\d+)>/g)){
   html+=escape(value.slice(cursor,match.index)).replace(/\n/g,'<br>');const id=h3TokenKey(match[1],Number(match[2]),ids,assets);
   html+=id&&!frames?`<span class="cv-reference-token" contenteditable="false" data-ref="${escape(id)}">${match[1]==='Picture'?`<img src="/media/${escape(id)}" alt="">`:''}<span>${({Picture:'图片',Video:'视频',Audio:'音频'} as Record<string,string>)[match[1]]}${match[2]}</span></span>`:escape(match[0]);cursor=match.index!+match[0].length;
  }
  el.innerHTML=html+escape(value.slice(cursor)).replace(/\n/g,'<br>');signature.current=key;
 },[value,ids.join(','),frames,assets]);
 return <div className="fm-ref-prompt-wrap">
  <div ref={editor} className="composer-prompt cv-h3-prompt" contentEditable suppressContentEditableWarning role="textbox" aria-label="生成提示词" aria-multiline="true" data-placeholder={frames?'描述画面的运动与首尾帧之间的过渡，键入 @ 引用角色/场景':'描述想生成的视频，键入 @ 引用角色/场景素材包或 @图N'} onFocus={onFocus} onBlur={()=>{setTimeout(()=>setMentionQuery(null),150);onBlur()}} onInput={()=>{const next=read().slice(0,12000);onChange(next);detectMention(next)}} onKeyDown={e=>{
   if(e.nativeEvent.isComposing)return;
   onKeyDown(e);
   if(e.defaultPrevented||mentionQuery===null||!candidates.length)return;
   if(e.key==='ArrowDown'){e.preventDefault();setActiveIdx(i=>(i+1)%candidates.length)}
   else if(e.key==='ArrowUp'){e.preventDefault();setActiveIdx(i=>(i-1+candidates.length)%candidates.length)}
   else if(e.key==='Enter'||e.key==='Tab'){e.preventDefault();applyCandidate(candidates[activeIdx]??candidates[0])}
   else if(e.key==='Escape'){setMentionQuery(null)}
  }} onPaste={e=>{
   e.preventDefault();const text=e.clipboardData.getData('text/plain'),selection=getSelection();if(!selection?.rangeCount)return;const range=selection.getRangeAt(0);range.deleteContents();const node=document.createTextNode(text);range.insertNode(node);range.setStartAfter(node);range.collapse(true);selection.removeAllRanges();selection.addRange(range);const next=read().slice(0,12000);onChange(next);detectMention(next);
  }}/>
  {mentionQuery!==null&&candidates.length>0&&<div className="fm-mention-menu" role="listbox" aria-label="引用角色或参考图">
   {candidates.map((cand,idx)=><button key={`${cand.kind}:${cand.id}`} type="button" role="option" aria-selected={idx===activeIdx} className={'fm-mention-item'+(idx===activeIdx?' active':'')} onMouseDown={e=>{e.preventDefault();applyCandidate(cand)}}>
    {cand.thumb&&<img src={`/media/${cand.thumb}?variant=thumb`} onError={ev=>{ev.currentTarget.src=`/media/${cand.thumb}`}} alt=""/>}
    <span className="fm-mention-label">@{cand.label}{cand.kind==='pack'&&<small>{cand.pack.scope==='global'&&<Globe size={11}/>}{cand.pack.locked&&<Lock size={11}/>}自动挂载 {cand.pack.media.length} 图</small>}</span>
   </button>)}
  </div>}
 </div>;
}
