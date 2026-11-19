import {useEffect,useRef} from 'react';
import type {Asset} from './types';
import {h3MediaType,h3TokenKey} from './h3References';
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function H3Prompt({value,ids,assets,frames,onChange,onFocus,onBlur}:{value:string;ids:string[];assets:Asset[];frames:boolean;onChange:(s:string)=>void;onFocus:()=>void;onBlur:()=>void}) {
 const editor=useRef<HTMLDivElement>(null),signature=useRef('');
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
 useEffect(()=>{
  const el=editor.current;if(!el)return;const key=JSON.stringify([ids,frames]);if(read()===value&&signature.current===key)return;
  let cursor=0,html='';for(const match of value.matchAll(/<(Picture|Video|Audio) (\d+)>/g)){
   html+=escape(value.slice(cursor,match.index)).replace(/\n/g,'<br>');const id=h3TokenKey(match[1],Number(match[2]),ids,assets);
   html+=id&&!frames?`<span class="cv-reference-token" contenteditable="false" data-ref="${escape(id)}">${match[1]==='Picture'?`<img src="/media/${escape(id)}" alt="">`:''}<span>${({Picture:'图片',Video:'视频',Audio:'音频'} as Record<string,string>)[match[1]]}${match[2]}</span></span>`:escape(match[0]);cursor=match.index!+match[0].length;
  }
  el.innerHTML=html+escape(value.slice(cursor)).replace(/\n/g,'<br>');signature.current=key;
 },[value,ids.join(','),frames,assets]);
 return <div ref={editor} className="composer-prompt cv-h3-prompt" contentEditable suppressContentEditableWarning role="textbox" aria-label="生成提示词" aria-multiline="true" data-placeholder={frames?'描述画面的运动与首尾帧之间的过渡':'描述想生成的视频，点击素材下方的引用插入参考'} onFocus={onFocus} onBlur={onBlur} onInput={()=>onChange(read().slice(0,12000))} onPaste={e=>{
  e.preventDefault();const text=e.clipboardData.getData('text/plain'),selection=getSelection();if(!selection?.rangeCount)return;const range=selection.getRangeAt(0);range.deleteContents();const node=document.createTextNode(text);range.insertNode(node);range.setStartAfter(node);range.collapse(true);selection.removeAllRanges();selection.addRange(range);onChange(read().slice(0,12000));
 }}/>;
}
