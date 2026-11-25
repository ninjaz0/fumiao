import {useEffect,useRef,useState} from 'react';
import {Check,Plus,Pencil,Trash2,ArrowLeft,Upload,ChevronRight} from 'lucide-react';
import {mergeAssetPackAssets} from '../studio/state';
export type Pack = {id:string;name:string;purpose:string;description:string;media:string[];revision:number;owner:number};
type Ref = {id:string;revision:number};
export type AssetPacksProps = {
 workspace:number;userId:number;admin?:boolean;selected?:Ref[];imageRefs?:string[];
 onImportImages:(ids:string[],pack:Pack)=>void|Promise<void>;
 onImportPack:(pack:Pack)=>void|Promise<void>;
 onRemovePack:(id:string)=>void|Promise<void>;
 onDeletePack?:(id:string)=>void|Promise<void>;
};
const purposes:Record<string,string>={subject:'人物外观',outfit:'服装',scene:'场景',style:'风格',product:'产品细节'};
const blank=()=>({name:'',purpose:'subject',description:'',media:[] as string[]});
export function AssetPacks(props:AssetPacksProps){
 return <WorkspaceAssetPacks key={props.workspace} {...props}/>;
}
function WorkspaceAssetPacks({workspace,userId,admin=false,selected=[],imageRefs=[],onImportImages,onImportPack,onRemovePack,onDeletePack}:AssetPacksProps){
 const [packs,setPacks]=useState<Pack[]>([]),[assets,setAssets]=useState<{id:string}[]>([]),[opened,setOpened]=useState<string|null>(null),[chosen,setChosen]=useState<string[]>([]),[editing,setEditing]=useState<Pack|null|undefined>(),[draft,setDraft]=useState(blank),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[removing,setRemoving]=useState<string|null>(null);
 const [confirmDiscard,setConfirmDiscard]=useState(false);
 const [uploading,setUploading]=useState(false);
 const newDraft=useRef(draft);
 const mountedRef=useRef(true);
 const fileRef=useRef<HTMLInputElement>(null);
 const backRef=useRef<HTMLButtonElement>(null);
 const continueRef=useRef<HTMLButtonElement>(null);
 const loadSeqRef=useRef(0);
 const uploadSeqRef=useRef(0);
 const recentUploadsRef=useRef<{seq:number;asset:{id:string}}[]>([]);
 useEffect(()=>{mountedRef.current=true;return()=>{mountedRef.current=false;++loadSeqRef.current}},[]);
 const request=async(path:string,body?:unknown,method=body===undefined?'GET':'POST',signal?:AbortSignal)=>{
  const r=await fetch(path,{method,signal,headers:{'X-Workspace-Id':String(workspace),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await r.json();if(!r.ok)throw new Error(typeof data.detail==='string'?data.detail:'请求失败，请重试');return data;
 };
 const load=async(signal?:AbortSignal)=>{
  const seq=++loadSeqRef.current;
  const snapshotUploadSeq=uploadSeqRef.current;
  setLoading(true);setError('');
  try{
   const [p,s]=await Promise.all([request('/api/asset-packs',undefined,'GET',signal),request('/api/state',undefined,'GET',signal)]);
   if(!mountedRef.current||signal?.aborted||seq!==loadSeqRef.current)return;
   const loaded=s.assets.filter((a:{kind?:string})=>!a.kind||a.kind==='ref') as {id:string}[];
   const loadedIds=new Set(loaded.map(a=>a.id));
   const pending=recentUploadsRef.current.filter(entry=>entry.seq>snapshotUploadSeq).map(entry=>entry.asset);
   recentUploadsRef.current=recentUploadsRef.current.filter(entry=>entry.seq>snapshotUploadSeq&&!loadedIds.has(entry.asset.id));
   setPacks(p.packs);
   setAssets(mergeAssetPackAssets(loaded,pending));
  }catch(e){
   if(mountedRef.current&&!signal?.aborted&&seq===loadSeqRef.current)setError((e as Error).message);
  }finally{
   if(mountedRef.current&&!signal?.aborted&&seq===loadSeqRef.current)setLoading(false);
  }
 };
 useEffect(()=>{const controller=new AbortController();void load(controller.signal);return()=>{++loadSeqRef.current;controller.abort()}},[workspace]);
 useEffect(()=>{if(confirmDiscard)continueRef.current?.focus()},[confirmDiscard]);
 const leaveEditor=()=>{
  setEditing(undefined);setError('');setConfirmDiscard(false);
 };
 const returnToPacks=()=>{
  if(editing===null)newDraft.current=draft;
  else if(editing){
   const dirty=draft.name!==editing.name||draft.purpose!==editing.purpose||draft.description!==editing.description||
    draft.media.length!==editing.media.length||draft.media.some((id,index)=>id!==editing.media[index]);
   if(dirty){setConfirmDiscard(true);return}
  }
  leaveEditor();
 };
 const save=async()=>{
  setBusy(true);setError('');try{
   await request('/api/asset-packs'+(editing?'/'+editing.id:''),{...draft,expected_revision:editing?.revision},editing?'PUT':'POST');
   if(!mountedRef.current)return;
   if(editing===null)newDraft.current=blank();
   leaveEditor();await load();
  }catch(e){if(mountedRef.current)setError((e as Error).message)}finally{if(mountedRef.current)setBusy(false)}
 };
 const upload=async(file?:File)=>{
  if(!file)return;
  setBusy(true);setUploading(true);setError('');try{
   const r=await fetch('/api/assets',{method:'POST',headers:{'X-Workspace-Id':String(workspace)},body:file});const a=await r.json();
   if(!r.ok)throw new Error(typeof a.detail==='string'?a.detail:'上传失败');
   if(!mountedRef.current)return;
   const seq=++uploadSeqRef.current;
   recentUploadsRef.current=[{seq,asset:a},...recentUploadsRef.current.filter(entry=>entry.asset.id!==a.id)];
   setAssets(items=>mergeAssetPackAssets(items,[a]));
   setDraft(d=>({...d,media:d.media.includes(a.id)?d.media:[...d.media,a.id].slice(0,9)}));
  }catch(e){if(mountedRef.current)setError((e as Error).message)}finally{if(mountedRef.current){setBusy(false);setUploading(false)}}
 };
 const apply=async(action:()=>void|Promise<void>)=>{setBusy(true);setError('');try{await action()}catch(e){if(mountedRef.current)setError((e as Error).message)}finally{if(mountedRef.current)setBusy(false)}};
 const toggle=(id:string)=>setDraft(d=>({...d,media:d.media.includes(id)?d.media.filter(m=>m!==id):d.media.length<9?[...d.media,id]:d.media}));
 const pack=packs.find(p=>p.id===opened), imported=selected.find(p=>p.id===opened);
 return <div className="fm-packs" aria-busy={busy||loading}>
  {error&&<p role="alert" className="fm-pack-error">{error}</p>}
  {editing!==undefined?<>
   <button ref={backRef} className="fm-pack-button" disabled={busy} onClick={returnToPacks}><ArrowLeft size={16}/>返回素材包</button>
   {confirmDiscard&&<div className="fm-pack-delete" role="group" aria-label="未保存的素材包修改">
    <span>返回后会丢失这次修改。</span>
    <button ref={continueRef} className="fm-pack-button" onClick={()=>{setConfirmDiscard(false);backRef.current?.focus()}}>继续编辑</button>
    <button className="fm-pack-button" disabled={busy} onClick={leaveEditor}>放弃修改</button>
   </div>}
   <div className="fm-pack-fields">
    <label>名称<input value={draft.name} maxLength={60} placeholder="例如：主角 A、展台场景" onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
    <fieldset><legend>用途</legend><div className="fm-pack-purpose">{Object.entries(purposes).map(([key,label])=><button key={key} aria-pressed={draft.purpose===key} onClick={()=>setDraft({...draft,purpose:key})}>{label}</button>)}</div></fieldset>
    <label>说明<textarea value={draft.description} maxLength={2000} rows={3} placeholder="人物特征、服装或场景中需要保留的细节" onChange={e=>setDraft({...draft,description:e.target.value})}/></label>
   </div>
   <div className="fm-pack-heading"><span>参考图片 · {draft.media.length}/9</span><button className="fm-pack-button" disabled={busy||draft.media.length>=9} onClick={()=>fileRef.current?.click()}><Upload size={16}/>{uploading?'正在上传…':'上传图片'}</button><input ref={fileRef} type="file" hidden accept="image/*,.heic,.heif" onChange={e=>{const file=e.target.files?.[0];e.currentTarget.value='';void upload(file)}}/></div>
   {draft.media.length>=9&&<p role="status">已选满 9 张，移除一张后可继续添加。</p>}
   <div className="fm-pack-images">{assets.map(a=><button key={a.id} disabled={busy||draft.media.length>=9&&!draft.media.includes(a.id)} aria-label={'选择参考图 '+a.id.slice(0,6)} aria-pressed={draft.media.includes(a.id)} onClick={()=>toggle(a.id)}><img loading="lazy" src={'/media/'+a.id} alt="参考图"/>{draft.media.includes(a.id)&&<span>{draft.media.indexOf(a.id)+1}</span>}</button>)}</div>
   {!assets.length&&<p>上传图片，建立这个素材包。</p>}
   <div className="fm-pack-footer"><button className="fm-pack-primary" disabled={busy||!draft.name.trim()||!draft.media.length} onClick={()=>void save()}>{busy&&!uploading?'保存中…':'保存素材包'}</button></div>
  </>:pack?<>
   <div className="fm-pack-detail-heading"><button className="fm-pack-button" disabled={busy} aria-label="返回素材包列表" onClick={()=>{setOpened(null);setChosen([]);setError('')}}><ArrowLeft size={18}/></button><div><h3>{pack.name}</h3><p>{purposes[pack.purpose]} · {pack.media.length} 张图片</p></div></div>
   {pack.description&&<p className="fm-pack-description">{pack.description}</p>}
   <div className="fm-pack-images fm-pack-pick-images" role="group" aria-label="选择素材包图片">{pack.media.map((id,index)=>{
    const added=imageRefs.includes(id),checked=chosen.includes(id);
    return <button key={id} disabled={busy||added} aria-label={`${pack.name} · 图片 ${index+1}${added?'，已添加':''}`} aria-pressed={added||checked} onClick={()=>{setError('');setChosen(ids=>checked?ids.filter(k=>k!==id):[...ids,id])}}><img loading="lazy" src={'/media/'+id} alt={`${pack.name} · 图片 ${index+1}`}/>{(added||checked)&&<span>{added?<Check size={14}/>:chosen.indexOf(id)+1}</span>}{added&&<small>已添加</small>}</button>
   })}</div>
   <div className="fm-pack-import-footer"><div className="fm-pack-whole-actions"><button className="fm-pack-button" disabled={busy||loading||imported?.revision===pack.revision} onClick={()=>void apply(()=>onImportPack(pack))}>{imported?imported.revision===pack.revision?'已导入整包':'更新整包引用':'导入整个素材包'}</button>{imported&&<button className="fm-pack-button" disabled={busy} onClick={()=>void apply(()=>onRemovePack(pack.id))}>移除整包引用</button>}</div><button className="fm-pack-primary" disabled={busy||!chosen.length} onClick={()=>void apply(()=>onImportImages(chosen,pack))}>导入所选图片{chosen.length?` · ${chosen.length}`:''}</button></div>
  </>:<>
   <div className="fm-pack-heading"><span>选择素材包</span><button className="fm-pack-button" disabled={busy||loading} onClick={()=>{setDraft(newDraft.current);setEditing(null);setError('')}}><Plus size={16}/>新建素材包</button></div>
   {loading?<p role="status">正在加载素材包…</p>:packs.length===0?<p className="fm-pack-empty">暂无素材包</p>:<div className="fm-pack-list">{packs.map(pack=><article key={pack.id}>
    <button className="fm-pack-select" disabled={busy} aria-label={'打开素材包 '+pack.name} onClick={()=>{setOpened(pack.id);setChosen([]);setRemoving(null);setError('')}}>
     <img loading="lazy" src={'/media/'+pack.media[0]} alt=""/><span><strong>{pack.name}</strong><small>{purposes[pack.purpose]} · {pack.media.length} 张图片{selected.some(p=>p.id===pack.id)?' · 已导入整包':''}</small>{pack.description&&<p>{pack.description}</p>}</span><ChevronRight size={18}/>
    </button>
    <div className="fm-pack-row-actions"><button className="fm-pack-button" disabled={busy} aria-label={'编辑 '+pack.name} onClick={()=>{setEditing(pack);setDraft({name:pack.name,purpose:pack.purpose,description:pack.description,media:pack.media});setError('')}}><Pencil size={16}/></button>
     {(admin||pack.owner===userId)&&<button className="fm-pack-button" disabled={busy} aria-label={'删除 '+pack.name} onClick={()=>setRemoving(pack.id)}><Trash2 size={16}/></button>}</div>
    {removing===pack.id&&<div className="fm-pack-delete"><span>删除“{pack.name}”？原图片会保留。</span><button disabled={busy} onClick={async()=>{setBusy(true);setError('');try{const wasSelected=selected.some(p=>p.id===pack.id);await request('/api/asset-packs/'+pack.id,undefined,'DELETE');if(!mountedRef.current)return;setRemoving(null);if(onDeletePack)await onDeletePack(pack.id);else if(wasSelected)await onRemovePack(pack.id);if(mountedRef.current)await load()}catch(e){if(mountedRef.current)setError((e as Error).message)}finally{if(mountedRef.current)setBusy(false)}}}>删除素材包</button><button disabled={busy} onClick={()=>setRemoving(null)}>取消</button></div>}
   </article>)}</div>}
  </>}
 </div>
}
