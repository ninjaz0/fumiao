import {useEffect,useRef,useState} from 'react';
import {Download,Film} from 'lucide-react';
import {mediaDownloadFilename} from '@fumiao/plugin-sdk/media-filename';
import {api,ApiError} from './api';
type Exporter={key:string;title:string};
type Result={id:string;state:string;result:string|null;error:string;revision:number;created:number};
export function CompositionDownloadLink({result}:{result:string}){
 return <a className="secondary" href={'/media/'+result+'?download=true'} download={mediaDownloadFilename(result,'video/mp4')}><Download size={15}/>MP4</a>;
}
export function Composition({project,getRevision,ready,waitingReason}:{project:string;getRevision:()=>Promise<number>;ready:boolean;waitingReason:string}){
 const [results,setResults]=useState<Result[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[pollError,setPollError]=useState(''),[preview,setPreview]=useState<string|null>(null);
 const [exporters,setExporters]=useState<Exporter[]|undefined>(),[selected,select]=useState("");
 const reload=useRef<(()=>Promise<void>)|null>(null);
 const chosen=exporters?.find(x=>x.key===selected)??exporters?.find(x=>x.key==="storyboard/mp4")??exporters?.[0];
 useEffect(()=>{
  let active=true, requested=0, applied=0;
  const load=async()=>{
   if(!active)return;
   const request=++requested;
   try{
    const data=await api<{exports:Result[];exporters?:Exporter[]}>(`/api/canvases/${project}/exports`);
    if(!active||request<applied)return;
    applied=request;
    setResults(data.exports);
    setExporters(data.exporters);
    setPollError('');
   }catch(e){
    if(!active||request<applied)return;
    applied=request;
    setPollError((e as Error).message);
   }
  };
  reload.current=load;
  void load();
  const timer=setInterval(()=>void load(),5000);
  return()=>{active=false;reload.current=null;clearInterval(timer)};
 },[project]);
 const pending=results.some(r=>['queued','running'].includes(r.state));
 const submit=async()=>{
  const refresh=reload.current;
  setBusy(true);setError('');setPollError('');const key='fm-compose-'+project;
  try{
   const revision=await getRevision();let body;
   try{body=JSON.parse(localStorage.getItem(key)||'null')}catch{}
   if(!body){body={uid:crypto.randomUUID(),expected_revision:revision,...(chosen?{exporter:chosen.key}:{})};localStorage.setItem(key,JSON.stringify(body))}
   try{await api(`/api/canvases/${project}/exports`,body);localStorage.removeItem(key)}catch(e){if(e instanceof ApiError&&e.status<500)localStorage.removeItem(key);throw e}
   await refresh?.();
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 };
 return <section className="shot-composition" aria-label="成片预览与导出">
  {exporters && exporters.length>1&&<label>导出器 <select value={chosen?.key} onChange={e=>select(e.target.value)}>{exporters.map(x=><option key={x.key} value={x.key}>{x.title}</option>)}</select></label>}
  <div className="composition-heading"><h3>成片</h3><button className="primary" disabled={busy||pending||!ready||exporters?.length===0} onClick={()=>void submit()}><Film size={16}/>{pending?'合成中…':busy?'提交中…':'合成预览'}</button></div>
  <p>旁白替换对应镜头的原音轨，较长的旁白会延长尾帧停留。字幕按句分配时间，可下载调整。</p>
  {exporters?.length===0&&<p role="status">请管理员在设置中安装并启用画布导出器。</p>}
  {!ready&&waitingReason&&<p role="status">{waitingReason}</p>}
  {(error||pollError)&&<p className="error" role="alert">{error||pollError}</p>}
  <div className="composition-results">{results.slice(0,5).map(r=><div key={r.id}>
   <div className="composition-result"><span>{new Date(r.created*1000).toLocaleString()}<small>版本 {r.revision}</small></span>
    {r.state==='done'&&r.result?<><button className="secondary" onClick={()=>setPreview(preview===r.id?null:r.id)}>{preview===r.id?'收起预览':'预览'}</button><CompositionDownloadLink result={r.result}/><a className="secondary" href={'/api/storyboard-exports/'+r.id+'/subtitles'}>字幕 SRT</a></>:<span>{r.state==='queued'?'等待合成':r.state==='running'?'正在合成':r.state==='failed'?r.error:'成片已删除'}</span>}
   </div>
   {preview===r.id&&r.result&&<video className="composition-preview" src={'/media/'+r.result} controls playsInline><track kind="captions" label="旁白字幕" srcLang="zh" src={'/api/storyboard-exports/'+r.id+'/subtitles?format=vtt'} default/></video>}
  </div>)}</div>
 </section>
}
