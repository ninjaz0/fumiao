import {useEffect,useId,useRef,useState} from 'react';
import {Box,Check,ChevronDown} from 'lucide-react';

export function ModelSelect({models,value,onChange,disabled}:{models:Record<string,{label:string}>;value:string;onChange:(value:string)=>void;disabled:boolean}){
 const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),id=useId();
 const keys=Object.keys(models),unavailable=disabled||!keys.length;
 const close=(restore=false)=>{setOpen(false);if(restore)trigger.current?.focus()};
 useEffect(()=>{if(unavailable)setOpen(false)},[unavailable]);
 useEffect(()=>{
  if(!open)return;
  const options=root.current?.querySelectorAll<HTMLButtonElement>('[role="option"]');
  options?.[Math.max(0,keys.indexOf(value))]?.focus();
  const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false)};
  document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);
 },[open]);
 return <div ref={root} className="fm-chat-model" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOpen(false)}}>
  <button ref={trigger} type="button" className="fm-chat-model-trigger" aria-label={'对话模型：'+(models[value]?.label||'无模型')} aria-haspopup="listbox" aria-expanded={open} aria-controls={open?id:undefined} disabled={unavailable} onClick={()=>setOpen(!open)} onKeyDown={e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();setOpen(true)}}}><Box size={15}/><span>{models[value]?.label||'无模型'}</span><ChevronDown size={14}/></button>
  {open&&<div id={id} className="fm-chat-model-menu" role="listbox" aria-label="对话模型" onKeyDown={e=>{
   if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);return}
   const options=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]')),index=options.indexOf(document.activeElement as HTMLButtonElement);
   const next=e.key==='ArrowDown'?(index+1)%options.length:e.key==='ArrowUp'?(index-1+options.length)%options.length:e.key==='Home'?0:e.key==='End'?options.length-1:-1;
   if(next>=0){e.preventDefault();options[next]?.focus()}
  }}>{keys.map(key=><button key={key} type="button" role="option" aria-selected={key===value} tabIndex={key===value?0:-1} onClick={()=>{onChange(key);close(true)}}><span>{models[key].label}</span>{key===value&&<Check size={17}/>}</button>)}</div>}
 </div>;
}
