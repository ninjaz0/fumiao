import {useEffect,useRef,useState} from 'react';
import {Check,Plus,Pencil,Trash2,ArrowLeft,Upload,ChevronRight,Lock,Unlock,Globe,Sparkles} from 'lucide-react';
import {mergeAssetPackAssets} from '../studio/state';
export type PackVoiceProfile = {
  model?: string;
  voice_id?: string;
  instruction?: string;
  emotion?: string;
  rate?: string;
  pitch?: string;
  ref_audio_asset_id?: string | null;
};
export type PackTurnaroundViews = {
  front?: string | null;
  side?: string | null;
  back?: string | null;
  sheet?: string | null;
};
export type Pack = {
  id:string;name:string;purpose:string;description:string;media:string[];revision:number;owner:number;
  voice_profile?:PackVoiceProfile|null;
  turnaround_views?:PackTurnaroundViews|null;
  locked?:boolean;
  scope?:'workspace'|'global';
};
type Ref = {id:string;revision:number};
export type AssetPacksProps = {
 workspace:number;userId:number;admin?:boolean;selected?:Ref[];imageRefs?:string[];
 onImportImages:(ids:string[],pack:Pack)=>void|Promise<void>;
 onImportPack:(pack:Pack)=>void|Promise<void>;
 onRemovePack:(id:string)=>void|Promise<void>;
 onDeletePack?:(id:string)=>void|Promise<void>;
};
const purposes:Record<string,string>={subject:'人物外观',outfit:'服装',scene:'场景',style:'风格',product:'产品细节'};
const turnaroundSlots:[keyof PackTurnaroundViews,string][]=[['front','正面'],['side','侧面'],['back','背面'],['sheet','三视图总表']];
const voicePresets:{id:string;label:string}[]=[
 {id:'',label:'跟随默认音色'},
 {id:'zh-CN-XiaoxiaoNeural',label:'晓晓（女·自然温暖）'},
 {id:'zh-CN-YunxiNeural',label:'云希（男·清亮叙事）'},
 {id:'zh-CN-YunjianNeural',label:'云健（男·沉稳解说）'},
 {id:'zh-CN-XiaoyiNeural',label:'晓伊（女·灵动少女）'},
 {id:'zh-CN-YunyangNeural',label:'云扬（男·新闻播音）'},
 {id:'zh-TW-HsiaoChenNeural',label:'曉臻（女·台湾温柔）'},
 {id:'zh-HK-HiuMaanNeural',label:'曉曼（女·粤语）'},
 {id:'nova',label:'Nova（OpenAI 明快女声）'},
 {id:'onyx',label:'Onyx（OpenAI 低沉男声）'},
];
const blank=()=>({name:'',purpose:'subject',description:'',media:[] as string[],voice_profile:null as PackVoiceProfile|null});
export function AssetPacks({workspace,userId,admin=false,selected=[],imageRefs=[],onImportImages,onImportPack,onRemovePack,onDeletePack}:AssetPacksProps){
 const [packs,setPacks]=useState<Pack[]>([]),[assets,setAssets]=useState<{id:string}[]>([]),[opened,setOpened]=useState<string|null>(null),[chosen,setChosen]=useState<string[]>([]),[editing,setEditing]=useState<Pack|null|undefined>(),[draft,setDraft]=useState(blank),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[removing,setRemoving]=useState<string|null>(null);
 const mountedRef=useRef(true);
 const fileRef=useRef<HTMLInputElement>(null);
 const workspaceRef=useRef(workspace);
 workspaceRef.current=workspace;
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
 useEffect(()=>{const controller=new AbortController();recentUploadsRef.current=[];setOpened(null);setChosen([]);setEditing(undefined);setRemoving(null);setNotice('');void load(controller.signal);return()=>{++loadSeqRef.current;controller.abort()}},[workspace]);
 const save=async()=>{
  setBusy(true);setError('');setNotice('');try{
   const vp=draft.purpose==='subject'&&draft.voice_profile?Object.fromEntries(Object.entries(draft.voice_profile).filter(([,v])=>v!==undefined&&v!==''&&v!==null)):null;
   const hasVp=vp&&Object.keys(vp).length>0;
   const payload:Record<string,unknown>={name:draft.name,purpose:draft.purpose,description:draft.description,media:draft.media,expected_revision:editing?.revision};
   if(hasVp)payload.voice_profile=vp;
   else if(editing?.voice_profile)payload.voice_profile=null;
   await request('/api/asset-packs'+(editing?'/'+editing.id:''),payload,editing?'PUT':'POST');
   if(!mountedRef.current)return;
   setEditing(undefined);await load();
  }catch(e){if(mountedRef.current)setError((e as Error).message)}finally{if(mountedRef.current)setBusy(false)}
 };
 const upload=async(file?:File)=>{
  if(!file)return;
  const targetWorkspace=workspace;
  setBusy(true);setError('');try{
   const r=await fetch('/api/assets',{method:'POST',headers:{'X-Workspace-Id':String(targetWorkspace)},body:file});const a=await r.json();
   if(!r.ok)throw new Error(typeof a.detail==='string'?a.detail:'上传失败');
   if(!mountedRef.current||workspaceRef.current!==targetWorkspace)return;
   const seq=++uploadSeqRef.current;
   recentUploadsRef.current=[{seq,asset:a},...recentUploadsRef.current.filter(entry=>entry.asset.id!==a.id)];
   setAssets(items=>mergeAssetPackAssets(items,[a]));
   setDraft(d=>({...d,media:d.media.includes(a.id)?d.media:[...d.media,a.id].slice(0,9)}));
  }catch(e){if(mountedRef.current&&workspaceRef.current===targetWorkspace)setError((e as Error).message)}finally{if(mountedRef.current&&workspaceRef.current===targetWorkspace)setBusy(false)}
 };
 const toggleLock=async(target:Pack)=>{
  setBusy(true);setError('');setNotice('');try{
   await request(`/api/asset-packs/${target.id}/${target.locked?'unlock':'lock'}`,{},'POST');
   if(!mountedRef.current)return;
   setNotice(target.locked?`已解锁「${target.name}」`:`已锁定「${target.name}」，防止误改误删`);
   await load();
  }catch(e){if(mountedRef.current)setError((e as Error).message)}finally{if(mountedRef.current)setBusy(false)}
 };
 const toggleScope=async(target:Pack)=>{
  setBusy(true);setError('');setNotice('');try{
   const nextScope=target.scope==='global'?'workspace':'global';
   await request(`/api/asset-packs/${target.id}/scope`,{scope:nextScope},'PUT');
   if(!mountedRef.current)return;
   setNotice(nextScope==='global'?`已将「${target.name}」发布为全局只读资产包`:`已将「${target.name}」收回工作区私有`);
   await load();
  }catch(e){if(mountedRef.current)setError((e as Error).message)}finally{if(mountedRef.current)setBusy(false)}
 };
 const generateTurnaround=async(target:Pack)=>{
  setBusy(true);setError('');setNotice('');try{
   const res=await request(`/api/asset-packs/${target.id}/turnaround`,{uid:crypto.randomUUID(),ratio:'16:9',resolution:'2K'},'POST');
   if(!mountedRef.current)return;
   setNotice(`已提交「${target.name}」标准正/侧/背三视图定妆照生成任务 (#${res.job_id})，完成后可在资产库绑定`);
  }catch(e){if(mountedRef.current)setError((e as Error).message)}finally{if(mountedRef.current)setBusy(false)}
 };
 const apply=async(action:()=>void|Promise<void>)=>{setBusy(true);setError('');try{await action()}catch(e){if(mountedRef.current)setError((e as Error).message)}finally{if(mountedRef.current)setBusy(false)}};
 const toggle=(id:string)=>setDraft(d=>({...d,media:d.media.includes(id)?d.media.filter(m=>m!==id):d.media.length<9?[...d.media,id]:d.media}));
 const pack=packs.find(p=>p.id===opened), imported=selected.find(p=>p.id===opened);
 return <div className="fm-packs" aria-busy={busy||loading}>
  {error&&<p role="alert" className="fm-pack-error">{error}</p>}
  {notice&&<p role="status" className="fm-pack-notice">{notice}</p>}
  {editing!==undefined?<>
   <button className="fm-pack-button" disabled={busy} onClick={()=>{setEditing(undefined);setError('')}}><ArrowLeft size={16}/>返回素材包</button>
   <div className="fm-pack-fields">
    <label>名称<input value={draft.name} maxLength={60} placeholder="例如：主角 A、展台场景" onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
    <fieldset><legend>用途</legend><div className="fm-pack-purpose">{Object.entries(purposes).map(([key,label])=><button key={key} aria-pressed={draft.purpose===key} onClick={()=>setDraft({...draft,purpose:key})}>{label}</button>)}</div></fieldset>
    <label>说明<textarea value={draft.description} maxLength={2000} rows={3} placeholder="人物特征、服装或场景中需要保留的细节" onChange={e=>setDraft({...draft,description:e.target.value})}/></label>
    {draft.purpose==='subject'&&<fieldset className="fm-pack-voice">
     <legend>角色专属声线（对白自动匹配）</legend>
     <label>预设音色<select value={draft.voice_profile?.voice_id||''} onChange={e=>setDraft({...draft,voice_profile:{...(draft.voice_profile||{}),voice_id:e.target.value||undefined}})}>{voicePresets.map(v=><option key={v.id} value={v.id}>{v.label}</option>)}</select></label>
     <label>默认语速<select value={draft.voice_profile?.rate||'+0%'} onChange={e=>setDraft({...draft,voice_profile:{...(draft.voice_profile||{}),rate:e.target.value==='+0%'?undefined:e.target.value}})}>
      <option value="-20%">偏慢 (-20%)</option><option value="-10%">稍慢 (-10%)</option><option value="+0%">标准</option><option value="+10%">稍快 (+10%)</option><option value="+20%">偏快 (+20%)</option>
     </select></label>
     <label>语气与声线描述<input maxLength={300} value={draft.voice_profile?.instruction||''} placeholder="例如：冷静克制的低沉男中音" onChange={e=>setDraft({...draft,voice_profile:{...(draft.voice_profile||{}),instruction:e.target.value||undefined}})}/></label>
    </fieldset>}
   </div>
   <div className="fm-pack-heading"><span>参考图片 · {draft.media.length}/9</span><button className="fm-pack-button" disabled={busy||draft.media.length>=9} onClick={()=>fileRef.current?.click()}><Upload size={16}/>上传图片</button><input ref={fileRef} type="file" hidden accept="image/*,.heic,.heif" onChange={e=>{const file=e.target.files?.[0];e.currentTarget.value='';void upload(file)}}/></div>
   <div className="fm-pack-images">{assets.map(a=><button key={a.id} disabled={busy} aria-label={'选择参考图 '+a.id.slice(0,6)} aria-pressed={draft.media.includes(a.id)} onClick={()=>toggle(a.id)}><img loading="lazy" src={'/media/'+a.id+'?variant=thumb'} onError={ev=>{ev.currentTarget.src='/media/'+a.id}} alt="参考图"/>{draft.media.includes(a.id)&&<span>{draft.media.indexOf(a.id)+1}</span>}</button>)}</div>
   {!assets.length&&<p>上传图片，建立这个素材包。</p>}
   <div className="fm-pack-footer"><button className="fm-pack-primary" disabled={busy||!draft.name.trim()||!draft.media.length} onClick={()=>void save()}>{busy?'保存中…':'保存素材包'}</button></div>
  </>:pack?<>
   <div className="fm-pack-detail-heading">
    <button className="fm-pack-button" disabled={busy} aria-label="返回素材包列表" onClick={()=>{setOpened(null);setChosen([]);setError('');setNotice('')}}><ArrowLeft size={18}/></button>
    <div>
     <h3>{pack.name}{pack.locked&&<span className="fm-badge-lock"><Lock size={12}/>已锁定</span>}{pack.scope==='global'&&<span className="fm-badge-global"><Globe size={12}/>全局</span>}</h3>
     <p>{purposes[pack.purpose]} · {pack.media.length} 张图片{pack.voice_profile?.voice_id?` · 声线 ${pack.voice_profile.voice_id}`:''}</p>
    </div>
   </div>
   {pack.description&&<p className="fm-pack-description">{pack.description}</p>}
   <div className="fm-pack-governance-bar">
    {(admin||pack.owner===userId)&&<button type="button" className="fm-pack-button" disabled={busy} onClick={()=>void toggleLock(pack)}>{pack.locked?<><Unlock size={14}/>解锁素材包</>:<><Lock size={14}/>锁定防误改</>}</button>}
    {admin&&!pack.locked&&<button type="button" className="fm-pack-button" disabled={busy} onClick={()=>void toggleScope(pack)}><Globe size={14}/>{pack.scope==='global'?'收回工作区':'发布到全局'}</button>}
    {pack.purpose==='subject'&&!pack.locked&&<button type="button" className="fm-pack-button" disabled={busy} onClick={()=>void generateTurnaround(pack)}><Sparkles size={14}/>一键生成三视图</button>}
   </div>
   {pack.turnaround_views&&Object.values(pack.turnaround_views).some(Boolean)&&<div className="fm-pack-turnaround">
    <strong>标准三视图定妆照</strong>
    <div className="fm-turnaround-strip">{turnaroundSlots.map(([slotKey,slotLabel])=>{
     const assetId=pack.turnaround_views?.[slotKey];
     if(!assetId)return null;
     return <figure key={slotKey}><img src={`/media/${assetId}?variant=thumb`} onError={ev=>{ev.currentTarget.src=`/media/${assetId}`}} alt={slotLabel}/><figcaption>{slotLabel}</figcaption></figure>;
    })}</div>
   </div>}
   <div className="fm-pack-images fm-pack-pick-images" role="group" aria-label="选择素材包图片">{pack.media.map((id,index)=>{
    const added=imageRefs.includes(id),checked=chosen.includes(id);
    return <button key={id} disabled={busy||added} aria-label={`${pack.name} · 图片 ${index+1}${added?'，已添加':''}`} aria-pressed={added||checked} onClick={()=>{setError('');setChosen(ids=>checked?ids.filter(k=>k!==id):[...ids,id])}}><img loading="lazy" src={'/media/'+id+'?variant=thumb'} onError={ev=>{ev.currentTarget.src='/media/'+id}} alt={`${pack.name} · 图片 ${index+1}`}/>{(added||checked)&&<span>{added?<Check size={14}/>:chosen.indexOf(id)+1}</span>}{added&&<small>已添加</small>}</button>
   })}</div>
   <div className="fm-pack-import-footer"><div className="fm-pack-whole-actions"><button className="fm-pack-button" disabled={busy||loading||imported?.revision===pack.revision} onClick={()=>void apply(()=>onImportPack(pack))}>{imported?imported.revision===pack.revision?'已导入整包':'更新整包引用':'导入整个素材包'}</button>{imported&&<button className="fm-pack-button" disabled={busy} onClick={()=>void apply(()=>onRemovePack(pack.id))}>移除整包引用</button>}</div><button className="fm-pack-primary" disabled={busy||!chosen.length} onClick={()=>void apply(()=>onImportImages(chosen,pack))}>导入所选图片{chosen.length?` · ${chosen.length}`:''}</button></div>
  </>:<>
   <div className="fm-pack-heading"><span>选择素材包</span><button className="fm-pack-button" disabled={busy||loading} onClick={()=>{setDraft(blank());setEditing(null);setError('')}}><Plus size={16}/>新建素材包</button></div>
   {loading?<p role="status">正在加载素材包…</p>:packs.length===0?<p className="fm-pack-empty">暂无素材包</p>:<div className="fm-pack-list">{packs.map(pack=><article key={pack.id}>
    <button className="fm-pack-select" disabled={busy} aria-label={'打开素材包 '+pack.name} onClick={()=>{setOpened(pack.id);setChosen([]);setRemoving(null);setError('');setNotice('')}}>
     <img loading="lazy" src={'/media/'+pack.media[0]+'?variant=thumb'} onError={ev=>{ev.currentTarget.src='/media/'+pack.media[0]}} alt=""/><span><strong>{pack.name}{pack.locked?' 🔒':''}{pack.scope==='global'?' 🌐':''}</strong><small>{purposes[pack.purpose]} · {pack.media.length} 张图片{pack.voice_profile?.voice_id?' · 已配声线':''}{selected.some(p=>p.id===pack.id)?' · 已导入整包':''}</small>{pack.description&&<p>{pack.description}</p>}</span><ChevronRight size={18}/>
    </button>
    <div className="fm-pack-row-actions">
     {(admin||pack.owner===userId)&&<button className="fm-pack-button" disabled={busy} title={pack.locked?'解锁':'锁定'} aria-label={(pack.locked?'解锁 ':'锁定 ')+pack.name} onClick={()=>void toggleLock(pack)}>{pack.locked?<Lock size={15}/>:<Unlock size={15}/>}</button>}
     <button className="fm-pack-button" disabled={busy||pack.locked||(pack.scope==='global'&&!admin)} title={pack.locked?'已锁定':undefined} aria-label={'编辑 '+pack.name} onClick={()=>{setEditing(pack);setDraft({name:pack.name,purpose:pack.purpose,description:pack.description,media:pack.media,voice_profile:pack.voice_profile??null});setError('')}}><Pencil size={16}/></button>
     {(admin||pack.owner===userId)&&<button className="fm-pack-button" disabled={busy||pack.locked} title={pack.locked?'已锁定不可删除':undefined} aria-label={'删除 '+pack.name} onClick={()=>setRemoving(pack.id)}><Trash2 size={16}/></button>}
    </div>
    {removing===pack.id&&<div className="fm-pack-delete"><span>删除“{pack.name}”？原图片会保留。</span><button disabled={busy} onClick={async()=>{setBusy(true);setError('');try{const wasSelected=selected.some(p=>p.id===pack.id);await request('/api/asset-packs/'+pack.id,undefined,'DELETE');if(!mountedRef.current)return;setRemoving(null);if(onDeletePack)await onDeletePack(pack.id);else if(wasSelected)await onRemovePack(pack.id);if(mountedRef.current)await load()}catch(e){if(mountedRef.current)setError((e as Error).message)}finally{if(mountedRef.current)setBusy(false)}}}>删除素材包</button><button disabled={busy} onClick={()=>setRemoving(null)}>取消</button></div>}
   </article>)}</div>}
  </>}
 </div>
}