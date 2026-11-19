import {useEffect, useRef, type ReactNode, type ButtonHTMLAttributes} from 'react';
import {LoaderCircle} from 'lucide-react';
import type {Tone} from '../lib/status';

/** 弗淼标识（current/mark.svg），颜色固定，不作为界面强调色。 */
export function Mark({size=22}:{size?:number}){
  return <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className="mark">
    <path fill="#a9eee4" d="M7 33 18 7h8L15 33z"/><path fill="#6db6fb" d="m18 39 12-29h8L26 39z"/><path fill="#b7a9fc" d="m31 36 6-15h7l-6 15z"/>
  </svg>;
}

export function Dot({tone}:{tone:Tone}){return <span className={'dot tone-'+tone} aria-hidden="true"/>}

export function StatusPill({tone,children}:{tone:Tone;children:ReactNode}){
  return <span className={'pill tone-'+tone}><Dot tone={tone}/>{children}</span>;
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {variant?:'primary'|'secondary'|'ghost'|'danger'|'danger-ghost'; size?:'sm'|'md'; busy?:boolean; icon?:ReactNode};
export function Button({variant='secondary',size='md',busy,icon,children,className='',type='button',...rest}:BtnProps){
  return <button type={type} className={`btn btn-${variant} btn-${size} ${className}`} aria-busy={busy||undefined} {...rest}>
    {busy?<LoaderCircle className="spin" size={size==='sm'?13:15} aria-hidden="true"/>:icon}{children}
  </button>;
}

export function Switch({checked,onChange,label,disabled}:{checked:boolean;onChange:(v:boolean)=>void;label:string;disabled?:boolean}){
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
    className="switch" onClick={()=>onChange(!checked)}><span/></button>;
}

export function Progress({value,label}:{value:number|'indeterminate';label:string}){
  const det = typeof value==='number';
  return <div className={'progress'+(det?'':' indeterminate')} role="progressbar" aria-label={label}
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={det?Math.round(value*100):undefined}>
    <span style={det?{width:`${Math.max(2,value*100)}%`}:undefined}/>
  </div>;
}

export function Card({title,icon,badge,children,className='',actions}:{title?:ReactNode;icon?:ReactNode;badge?:ReactNode;actions?:ReactNode;children:ReactNode;className?:string}){
  return <section className={'card '+className}>
    {(title||actions)&&<header className="card-head">{icon&&<span className="card-icon">{icon}</span>}<h3>{title}</h3>{badge&&<span className="badge">{badge}</span>}<span className="grow"/>{actions}</header>}
    {children}
  </section>;
}

/** 简单模态确认框：Esc 取消，初始焦点在「取消」，Tab 在框内循环。 */
export function Confirm({open,title,body,confirmLabel,danger,onConfirm,onCancel}:{open:boolean;title:string;body:ReactNode;confirmLabel:string;danger?:boolean;onConfirm:()=>void;onCancel:()=>void}){
  const ref = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(onCancel);
  useEffect(()=>{cancelRef.current=onCancel},[onCancel]);
  useEffect(()=>{
    if(!open) return;
    const prev = document.activeElement as HTMLElement|null;
    ref.current?.querySelector<HTMLButtonElement>('[data-cancel]')?.focus();
    const onKey=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){e.preventDefault();cancelRef.current()}
      if(e.key==='Tab'&&ref.current){
        const items=[...ref.current.querySelectorAll<HTMLElement>('button')];
        const first=items[0],last=items[items.length-1];
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
      }
    };
    window.addEventListener('keydown',onKey);
    return ()=>{window.removeEventListener('keydown',onKey);prev?.focus()};
  },[open]);
  if(!open) return null;
  return <div className="scrim" onMouseDown={e=>{if(e.target===e.currentTarget)onCancel()}}>
    <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" aria-describedby="dlg-body" ref={ref}>
      <h2 id="dlg-title">{title}</h2>
      <div id="dlg-body" className="dialog-body">{body}</div>
      <div className="dialog-actions">
        <Button data-cancel onClick={onCancel}>取消</Button>
        <Button variant={danger?'danger':'primary'} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </div>
  </div>;
}

export function KeyValue({label,children,mono}:{label:string;children:ReactNode;mono?:boolean}){
  return <div className="kv"><dt>{label}</dt><dd className={mono?'num':''}>{children}</dd></div>;
}
