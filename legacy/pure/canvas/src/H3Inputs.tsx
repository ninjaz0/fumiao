import {useEffect,useRef,useState} from 'react';
import {Plus,X,ArrowLeftRight,Mic,AtSign} from 'lucide-react';
import {frameAspectMatches} from './h3References';
import {uploadH3} from './api';
import type {Asset,H3Options} from './types';
import './h3.css';
export const mediaType=(a?:Asset)=>a?.kind==='ref_video'?'Video':a?.kind==='ref_audio'?'Audio':'Picture';
export function H3Inputs({options,ids,assets,onChange,onAsset,onMention,onBusy}:{options:H3Options;ids:string[];assets:Asset[];onChange:(options:H3Options,ids:string[])=>void;onAsset:(a:Asset)=>void;onMention:(token:string)=>void;onBusy:(busy:boolean)=>void}) {
 const picker=useRef<HTMLInputElement>(null),target=useRef<'first_frame'|'last_frame'|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[preview,setPreview]=useState<string|null>(null);
 const previewDialog=useRef<HTMLDialogElement>(null),previewReturn=useRef<HTMLElement|null>(null);
 useEffect(()=>{if(preview){previewReturn.current=document.activeElement as HTMLElement;previewDialog.current?.showModal();}return ()=>{previewDialog.current?.close();if(previewReturn.current?.isConnected)previewReturn.current.focus();};},[preview]);
 const asset=(id?:string|null)=>assets.find(a=>a.id===id);
 const frames=options.mode==='frames';
 const label=(id:string)=>({Picture:'图片',Video:'视频',Audio:'音频'})[mediaType(asset(id))]+(ids.filter(k=>mediaType(asset(k))===mediaType(asset(id))).indexOf(id)+1);
 const media=(id:string,controls=false)=>mediaType(asset(id))==='Picture'?<img src={'/media/'+id} alt=""/>:mediaType(asset(id))==='Video'?<video src={'/media/'+id+'#t=0.1'} muted={!controls} controls={controls} preload="metadata" playsInline/>:controls?<audio src={'/media/'+id} controls/>:<Mic size={24}/>;
 const choose=(slot:'first_frame'|'last_frame'|null)=>{target.current=slot;picker.current?.click();};
 const upload=async(files:File[])=>{
  if(busy)return;setBusy(true);onBusy(true);setError('');let nextIds=[...ids],next={...options};const batchAssets=new Map(assets.map(a=>[a.id,a]));
  try {for(const file of files){
   if(frames&&(file.type.startsWith('video/')||file.type.startsWith('audio/')))throw new Error('首尾帧只接收图片');
   if(!frames&&nextIds.length>=12)throw new Error('最多选择 12 个参考素材');
   const a=await uploadH3(file);onAsset(a);batchAssets.set(a.id,a);
   if(frames){const slot=target.current||(!next.first_frame?'first_frame':!next.last_frame?'last_frame':null);if(!slot)throw new Error('两个帧位置已填满，请先移除图片');
    const other=batchAssets.get(next[slot==='first_frame'?'last_frame':'first_frame']||'');if(!frameAspectMatches(other,a))throw new Error('已保留首张图片；请更换为比例相同的另一帧');next={...next,[slot]:a.id};target.current=null;
   }else nextIds.push(a.id);
   onChange(next,nextIds);
  }}catch(e){setError((e as Error).message);}finally{setBusy(false);onBusy(false);}
 };
 return <div className="cv-h3-inputs" aria-busy={busy} onDragOver={e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();}} onDrop={e=>{if(e.dataTransfer.files.length){e.preventDefault();e.stopPropagation();void upload([...e.dataTransfer.files]);}}} onPaste={e=>{if(e.clipboardData.files.length){e.preventDefault();void upload([...e.clipboardData.files]);}}}>
 <input ref={picker} hidden type="file" aria-label="上传 H3 参考素材" accept={frames?'image/*':'image/*,video/mp4,video/webm,video/quicktime,audio/*'} multiple={!frames} onChange={e=>{void upload([...e.target.files||[]]);e.target.value='';}}/>
 {frames?<div className="cv-h3-frames">{(['first_frame','last_frame'] as const).map((slot,i)=><div className="cv-h3-slot-wrap" key={slot}>{i===1&&<button className="cv-h3-swap" disabled={busy||(!options.first_frame&&!options.last_frame)} aria-label="交换首尾帧" onClick={()=>onChange({...options,first_frame:options.last_frame,last_frame:options.first_frame},ids)}><ArrowLeftRight size={18}/></button>}<div className="cv-h3-card"><button disabled={busy} aria-label={(options[slot]?'预览':'上传')+(i?'尾帧':'首帧')} onClick={()=>options[slot]?setPreview(options[slot]!):choose(slot)}>{options[slot]?media(options[slot]!):<Plus size={22}/>}<span>{i?'尾帧':'首帧'}</span></button>{options[slot]&&<button className="cv-h3-remove" disabled={busy} aria-label={'移除'+(i?'尾帧':'首帧')} onClick={()=>onChange({...options,[slot]:null},ids)}><X size={12}/></button>}</div></div>)}</div>:<div className="cv-h3-strip">{ids.map(id=><div className="cv-h3-item" key={id}><div className="cv-h3-card"><button aria-label={'预览'+label(id)} onClick={()=>setPreview(id)}>{media(id)}<span>{label(id)}</span></button><button className="cv-h3-remove" disabled={busy} aria-label={'移除'+label(id)} onClick={()=>onChange({...options,video_audio:options.video_audio?.filter(k=>k!==id)},ids.filter(k=>k!==id))}><X size={12}/></button></div><button className="cv-h3-mention" aria-label={'引用'+label(id)} onClick={()=>onMention(`<${mediaType(asset(id))} ${ids.filter(k=>mediaType(asset(k))===mediaType(asset(id))).indexOf(id)+1}>`)}><AtSign size={12}/>引用</button>{asset(id)?.kind==='ref_video'&&asset(id)?.has_audio&&<label className="cv-h3-sound"><input type="checkbox" checked={options.video_audio?.includes(id)||false} onChange={e=>onChange({...options,video_audio:e.target.checked?[...(options.video_audio||[]),id]:options.video_audio?.filter(k=>k!==id)},ids)}/>声音</label>}</div>)}<button className="cv-h3-add" disabled={busy} onClick={()=>choose(null)}><Plus size={20}/><span>参考内容</span></button></div>}
 {busy&&<p role="status">正在上传素材…</p>}{error&&<p className="error" role="alert">{error}</p>}
 {preview&&<dialog ref={previewDialog} className="cv-h3-preview" aria-label="参考素材预览" onCancel={e=>{e.preventDefault();setPreview(null);}} onKeyDown={e=>{if(e.key==='Escape')e.stopPropagation();}}>{media(preview,true)}<button autoFocus onClick={()=>setPreview(null)}>关闭预览</button></dialog>}
 </div>;
}
