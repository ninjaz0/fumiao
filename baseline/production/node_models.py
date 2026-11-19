"""Shared, versioned contracts for independently installable GPU model adapters."""
import json,hashlib

GPU_MODELS = {
    'MiniMax H3': {'label':'MiniMax H3','slug':'minimax-h3','kind':'video','adapter':'h3','backends':['cuda','rocm'],
        'min_vram_gib':96,'min_ram_gib':128,'disk_gib':155,'min_python':[3,12],
        'manifest':'engine/assets/models.lock.json','cache_env':'H3_CACHE','cache_dir':'fumiao-h3','model_subdir':'models','persistence_priority':0,
        'precision':'bf16','workflow':'h3-v3-rocm-qkv-safe'},
    'breeze-tts-2': {'label':'Breeze TTS 2','slug':'breeze-tts-2','kind':'audio','adapter':'breeze','backends':['cuda','rocm'],
        'min_vram_gib':12,'min_ram_gib':16,'disk_gib':20,'min_python':[3,10],
        'manifest':'breeze.lock.json','cache_env':'BREEZE_HOME','cache_dir':'fumiao-breeze','model_subdir':'checkpoint','persistence_priority':10,
        'precision':'bf16','workflow':'breeze-tts-2-eager-v1'},
}
LEGACY_MODELS = ['MiniMax H3']
VIDEO_SAMPLING_STEPS = (4,16,20,32,50)
H3_LEGACY_TURBO_WORKFLOW = 'h3-v5-rocm-qkv-safe-turbo4'
H3_TURBO_WORKFLOW = 'h3-v6-native-inputs-turbo4'
H3_FAST_WORKFLOWS = (H3_LEGACY_TURBO_WORKFLOW,H3_TURBO_WORKFLOW)


def h3_input_metadata(job):
    value=job.get('h3_inputs') or {}
    if isinstance(value,str):
        try:value=json.loads(value)
        except ValueError:return {}
    return value if isinstance(value,dict) else {}


def h3_needs_native_worker(job):
    meta=h3_input_metadata(job)
    if not meta:return False
    return True  # Explicit input roles require the native-input worker and receipt contract.



def h3_reference_files(job):
    refs=job.get('refs',[])
    if isinstance(refs,str):refs=json.loads(refs)
    meta=h3_input_metadata(job)
    if not meta:return [{'id':key,'kind':'image','suffix':'png'} for key in refs]
    files=meta.get('files',[])
    if meta.get('version')!=1 or [f.get('id') for f in files]!=refs:raise ValueError('H3 reference manifest differs from the job')
    if any(f.get('kind') not in ('image','video','audio') for f in files):raise ValueError('Unknown H3 reference type')
    return [dict(f,suffix={'image':'png','video':'mp4','audio':'wav'}[f['kind']]) for f in files]


def h3_input_fingerprint(job):
    meta=h3_input_metadata(job)
    return hashlib.sha256(json.dumps(meta,sort_keys=True,separators=(',',':')).encode()).hexdigest() if meta else ''


def h3_keyframe_indices(job):
    refs=job.get('refs',[])
    if isinstance(refs,str):refs=json.loads(refs)
    meta=h3_input_metadata(job)
    if not meta:return {'first':0} if len(refs)==1 else {}
    if meta.get('mode')!='frames':return {}
    return {role:refs.index(meta[role+'_frame']) for role in ('first','last') if meta.get(role+'_frame')}


def h3_fast_preset(job):
    refs=job.get('refs',[])
    if isinstance(refs,str):refs=json.loads(refs)
    count=refs if isinstance(refs,int) else len(refs)
    meta=h3_input_metadata(job)
    reference=(meta.get('mode')=='reference' and count>0) if meta else count>1
    if reference:
        return {'id':'ref2v-v01','lora':'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors','shift_video':12.0,'shift_audio':3.0}
    if int(job.get('quality',480))==768:
        return {'id':'fl2v-768-v10','lora':'minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors','shift_video':6.0,'shift_audio':3.0}
    # The v1 mixed-resolution checkpoint officially supports both 8 and 4 NFEs.
    return {'id':'fl2v-low-v10','lora':'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors','shift_video':12.0,'shift_audio':3.0}


def h3_pipeline_id(job):
    refs=job.get('refs',[])
    if isinstance(refs,str):refs=json.loads(refs)
    count=refs if isinstance(refs,int) else len(refs)
    meta=h3_input_metadata(job)
    if meta.get('mode')=='frames':
        mode='fl2v' if meta.get('first_frame') and meta.get('last_frame') else 'l2v' if meta.get('last_frame') else 'i2v' if meta.get('first_frame') else 't2v'
    elif meta.get('mode')=='reference':
        mode='r2v' if count else 't2v'
        for kind in ('video','audio'):
            if any(f.get('kind')==kind for f in meta.get('files',[])):mode+='+'+kind
    else:mode=job.get('video_mode') or ('r2v' if count>1 else 'i2v' if count else 't2v')
    if job.get('sampling_steps',job.get('steps',20))!=4:return mode
    workflow=job.get('workflow','')
    variant=workflow if workflow.startswith('h3-turbo4-') else 'h3-turbo4-'+h3_fast_preset(job)['id'] if workflow in ('',*H3_FAST_WORKFLOWS) else 'legacy-fast4:'+workflow
    return mode+'|'+variant


def model_list(value, default=None):
    if value is None:return list(LEGACY_MODELS if default is None else default)
    if isinstance(value,str):value=json.loads(value)
    if not isinstance(value,list) or not value or any(m not in GPU_MODELS for m in value):
        raise ValueError('请选择至少一个支持的模型')
    return list(dict.fromkeys(value))


def ready_models(node):
    node=dict(node)
    value=node.get('ready_models')
    if value is None:return list(LEGACY_MODELS)
    try:return [m for m in json.loads(value) if m in GPU_MODELS]
    except (ValueError,TypeError):return []


def can_run(node, model):
    return model in ready_models(node)


def can_run_job(node,job):
    node,job=dict(node),dict(job)
    if not can_run(node,job['model']):return False
    if job['model']!='MiniMax H3':return True
    if h3_needs_native_worker(job) and node.get('workflow')!=H3_TURBO_WORKFLOW:return False
    # Legacy workers only implement the old 20-step graph. Never silently send
    # a different requested count to an instance that would ignore it.
    if node.get('workflow')=='h3-v3-rocm-qkv-safe-fast4-i2v768':return False
    if job.get('sampling_steps',20)==4 and node.get('workflow') not in H3_FAST_WORKFLOWS:return False
    try:
        supported=node.get('video_steps','[20]')
        if isinstance(supported,str):supported=json.loads(supported)
        return job.get('sampling_steps',20) in supported
    except (ValueError,TypeError):return False


def plan(hardware, selected, check_disk=True):
    """A model occupies one device; multiple cards are never summed as VRAM."""
    selected=model_list(selected)
    devices=hardware.get('devices',[])
    reports=[]
    for model in selected:
        spec=GPU_MODELS[model];issues=[]
        candidates=[g for g in devices if g.get('backend') in spec['backends']
                    and g.get('vram_gib',0)>=spec['min_vram_gib']]
        if not devices:issues.append('未检测到可用的 AMD 或 NVIDIA 显卡')
        elif not candidates:issues.append(f"需要单卡至少 {spec['min_vram_gib']} GiB 显存")
        if hardware.get('ram_gib',0)<spec['min_ram_gib']:issues.append(f"需要至少 {spec['min_ram_gib']} GiB 系统内存")
        if tuple(hardware.get('python',[]))<tuple(spec['min_python']):issues.append('需要 Python '+'.'.join(map(str,spec['min_python']))+' 或更高版本')
        reports.append({'model':model,'label':spec['label'],'compatible':not issues,'issues':issues,
                        'device_ids':[g['index'] for g in candidates]})
    # One serial worker uses a common physical device for its selected adapters.
    common=set.intersection(*(set(r['device_ids']) for r in reports)) if reports else set()
    problems=[f"{r['label']}：{'；'.join(r['issues'])}" for r in reports if r['issues']]
    if not common and not problems:problems.append('所选模型没有共同可用的单卡设备，请分开接入实例')
    disk=sum(GPU_MODELS[m]['disk_gib'] for m in selected)
    if check_disk and hardware.get('disk_free_gib',0)<disk:problems.append(f'模型与运行环境需要至少 {disk} GiB 可用磁盘')
    chosen=max((g for g in devices if g['index'] in common),key=lambda g:g.get('free_gib',g['vram_gib']),default=None)
    return {'ok':not problems,'models':reports,'issues':problems,'device':chosen,'disk_required_gib':disk}


def execution_plan(hardware,selected):
    """Two independent model lanes only with an explicit per-device memory budget."""
    import itertools,math
    selected=model_list(selected)
    base={'mode':'serial','policy':'gpu-budget-v1','lanes':{},'devices':hardware.get('devices',[]),'ram_total_gib':hardware.get('ram_gib',0),'reserve_ram_gib':16,'reserve_vram_gib':{}}
    if set(selected)!={'MiniMax H3','breeze-tts-2'}:return base
    devices=hardware.get('devices',[])
    options={m:[g for g in devices if g.get('backend') in GPU_MODELS[m]['backends'] and g.get('vram_gib',0)>=GPU_MODELS[m]['min_vram_gib']] for m in selected}
    choices=[]
    for h3,speech in itertools.product(options['MiniMax H3'],options['breeze-tts-2']):
        shared=h3['index']==speech['index'];ram_reserve=32 if shared else 16
        if hardware.get('ram_gib',0)<128+16+ram_reserve:continue
        if shared:
            reserve=16;voice=12;video=math.floor(h3['vram_gib']-voice-reserve)
            if video<128:continue
            reserves={str(h3['index']):reserve}
        else:
            video=math.floor(h3['vram_gib']-8);voice=min(12,math.floor(speech['vram_gib']-2))
            if video<88 or voice<10:continue
            reserves={str(h3['index']):8,str(speech['index']):2}
        lanes={m:{'device':g['index'],'backend':g['backend'],'gpu_budget_gib':budget,'ram_budget_gib':ram,'gpu_total_gib':g['vram_gib']} for m,g,budget,ram in [('MiniMax H3',h3,video,128),('breeze-tts-2',speech,voice,16)]}
        minimum={h3['index']:(128 if shared else 88)+(12 if shared else 0),speech['index']:140 if shared else 10}
        usable=all(next(g for g in (h3,speech) if g['index']==index).get('free_gib',next(g for g in (h3,speech) if g['index']==index)['vram_gib'])>=needed for index,needed in minimum.items())
        choices.append((usable,not shared,video,base|{'mode':'parallel','initial_available':usable,'shared_gpu':shared,'lanes':lanes,'reserve_ram_gib':ram_reserve,'reserve_vram_gib':reserves}))
    return max(choices,key=lambda x:(x[0],x[1],x[2]))[3] if choices else base
