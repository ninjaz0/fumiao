import {useState,type ReactNode} from 'react';
import {ArrowDown,ArrowUp,X,Mic,Download} from 'lucide-react';
export type Shot={id:string;title:string;media:string|null;seconds:number;adopted:number|null;status:string};
export function ShotList({shots,onMove,onRemove,onSelect,onExport,renderNarration,composition}:{
 shots:Shot[];onMove:(id:string,offset:number)=>void;onRemove:(id:string)=>void;onSelect:(id:string)=>void;
 onExport:()=>Promise<void>;renderNarration:(shot:Shot)=>ReactNode;composition:ReactNode;
}){
 const [voiceNode,setVoiceNode]=useState<string|null>(null),[exporting,setExporting]=useState(false),[error,setError]=useState('');
 const ready=shots.filter(s=>s.media).length,allReady=!!shots.length&&ready===shots.length;
 return <div className="shot-editor">
  <div className="shot-summary"><span>{shots.length?`${ready} / ${shots.length} 个镜头已有视频 · 约 ${Math.round(shots.reduce((t,s)=>t+s.seconds,0)*10)/10} 秒`:'选中视频节点，加入镜头列表开始编排。'}</span>
   {!!shots.length&&<button className="secondary" disabled={!allReady||exporting} onClick={async()=>{setExporting(true);setError('');try{await onExport()}catch(e){setError((e as Error).message)}finally{setExporting(false)}}}><Download size={15}/>{exporting?'准备中…':'导出镜头包'}</button>}
  </div>
  {!!shots.length&&<ol className="shot-list">{shots.map((shot,index)=><li key={shot.id}>
   <span className="shot-index">{String(index+1).padStart(2,'0')}</span>
   <button className="shot-link" onClick={()=>onSelect(shot.id)}><strong>{shot.title||'未命名镜头'}</strong><small>{Math.round(shot.seconds*10)/10} 秒 · {shot.adopted?`已采用 #${shot.adopted}`:shot.media?'当前视频':shot.status}</small></button>
   <div className="shot-actions">
    <button className="icon-button" title="旁白" aria-label={`镜头 ${index+1} 的旁白`} aria-expanded={voiceNode===shot.id} onClick={()=>setVoiceNode(voiceNode===shot.id?null:shot.id)}><Mic size={16}/></button>
    <button className="icon-button" title="上移" aria-label={`上移镜头 ${index+1}`} disabled={index===0||exporting} onClick={()=>onMove(shot.id,-1)}><ArrowUp size={16}/></button>
    <button className="icon-button" title="下移" aria-label={`下移镜头 ${index+1}`} disabled={index===shots.length-1||exporting} onClick={()=>onMove(shot.id,1)}><ArrowDown size={16}/></button>
    <button className="icon-button" title="从列表移除" aria-label={`移除镜头 ${index+1}`} disabled={exporting} onClick={()=>onRemove(shot.id)}><X size={16}/></button>
   </div>
   {voiceNode===shot.id&&renderNarration(shot)}
  </li>)}</ol>}
  {error&&<p className="error" role="alert">{error}</p>}
  {composition}
 </div>
}
