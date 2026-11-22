import {useEffect,useState} from 'react';
import {Download,Film} from 'lucide-react';
import {api,ApiError} from './api';
type Result={id:string;state:string;result:string|null;error:string;revision:number;created:number};
export function Composition({project,getRevision,ready,waitingReason}:{project:string;getRevision:()=>Promise<number>;ready:boolean;waitingReason:string}){
 const [results,setResults]=useState<Result[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[preview,setPreview]=useState<string|null>(null);
 const load=async()=>{const data=await api<{exports:Result[]}>(`/api/canvases/${project}/exports`);setResults(data.exports)};
 useEffect(()=>{let active=true;const poll=async()=>{try{const data=await api<{exports:Result[]}>(`/api/canvases/${project}/exports`);if(active)setResults(data.exports)}catch(e){if(active)setError((e as Error).message)}};void poll();const timer=setInterval(()=>void poll(),5000);return()=>{active=false;clearInterval(timer)}},[project]);
 const pending=results.some(r=>['queued','running'].includes(r.state));
 const submit=async()=>{
  setBusy(true);setError('');const key='fm-compose-'+project;
  try{
   const revision=await getRevision();let body;
   try{body=JSON.parse(localStorage.getItem(key)||'null')}catch{}
   if(!body){body={uid:crypto.randomUUID(),expected_revision:revision};localStorage.setItem(key,JSON.stringify(body))}
   try{await api(`/api/canvases/${project}/exports`,body);localStorage.removeItem(key)}catch(e){if(e instanceof ApiError&&e.status<500)localStorage.removeItem(key);throw e}
   await load();
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 };
 return <section className="shot-composition" aria-label="成片预览与导出">
  <div className="composition-heading"><h3>成片</h3><button className="primary" disabled={busy||pending||!ready} onClick={()=>void submit()}><Film size={16}/>{pending?'合成中…':busy?'提交中…':'合成预览'}</button></div>
  <p>旁白替换对应镜头的原音轨，较长的旁白会延长尾帧停留。字幕按句分配时间，可下载调整。</p>
  {!ready&&waitingReason&&<p role="status">{waitingReason}</p>}
  {error&&<p className="error" role="alert">{error}</p>}
  <div className="composition-results">{results.slice(0,5).map(r=><div key={r.id}>
   <div className="composition-result"><span>{new Date(r.created*1000).toLocaleString()}<small>版本 {r.revision}</small></span>
    {r.state==='done'&&r.result?<><button className="secondary" onClick={()=>setPreview(preview===r.id?null:r.id)}>{preview===r.id?'收起预览':'预览'}</button><a className="secondary" href={'/media/'+r.result+'?download=true'}><Download size={15}/>MP4</a><a className="secondary" href={'/api/storyboard-exports/'+r.id+'/subtitles'}>字幕 SRT</a></>:<span>{r.state==='queued'?'等待合成':r.state==='running'?'正在合成':r.state==='failed'?r.error:'成片已删除'}</span>}
   </div>
   {preview===r.id&&r.result&&<video className="composition-preview" src={'/media/'+r.result} controls playsInline><track kind="captions" label="旁白字幕" srcLang="zh" src={'/api/storyboard-exports/'+r.id+'/subtitles?format=vtt'} default/></video>}
  </div>)}</div>
 </section>
}
