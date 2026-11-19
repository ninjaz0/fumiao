"""Per-model GPU lanes share a node identity, never a job ticket or process state."""
import json,math,time
from fastapi import HTTPException
from node_models import GPU_MODELS


def migrate(con):
    if 'execution_plan' not in {r['name'] for r in con.execute('PRAGMA table_info(nodes)')}:
        con.execute("ALTER TABLE nodes ADD COLUMN execution_plan TEXT NOT NULL DEFAULT '{}' ")
    con.execute('''CREATE TABLE IF NOT EXISTS node_lanes(node INTEGER NOT NULL REFERENCES nodes ON DELETE CASCADE,
        model TEXT NOT NULL,stage TEXT NOT NULL,detail TEXT NOT NULL DEFAULT '',lastseen INTEGER NOT NULL,
        runtime_id TEXT NOT NULL DEFAULT '',can_accept INTEGER NOT NULL DEFAULT 0,
        profile TEXT NOT NULL DEFAULT '{}',PRIMARY KEY(node,model))''')


def read(node):
    try:return json.loads(dict(node).get('execution_plan') or '{}')
    except (ValueError,TypeError):return {}


def validate(value,selected):
    if not isinstance(value,dict) or value.get('mode') not in ('serial','parallel'):raise HTTPException(400,'执行计划无效')
    if value['mode']=='serial':return {'mode':'serial','policy':'gpu-budget-v1'}
    if not isinstance(value.get('lanes'),dict):raise HTTPException(400,'执行通道格式无效')
    if value.get('policy')!='gpu-budget-v1' or set(value.get('lanes',{}))!={'MiniMax H3','breeze-tts-2'} or not set(value['lanes'])<=set(selected):raise HTTPException(400,'并发模型计划与实例授权不符')
    lanes=value['lanes'];used={};ram=0
    if not isinstance(value.get('reserve_vram_gib'),dict):raise HTTPException(400,'显存预算格式无效')
    for field in ('ram_total_gib','reserve_ram_gib'):
        if type(value.get(field)) not in (int,float) or not math.isfinite(value[field]) or not 0<value[field]<=65536:raise HTTPException(400,'系统内存预算无效')
    for model,lane in lanes.items():
        if not isinstance(lane,dict):raise HTTPException(400,'执行通道格式无效')
        if lane.get('backend') not in GPU_MODELS[model]['backends'] or type(lane.get('device')) is not int or not 0<=lane['device']<128:raise HTTPException(400,'并发设备无效')
        for field in ('gpu_budget_gib','ram_budget_gib','gpu_total_gib'):
            if type(lane.get(field)) not in (int,float) or not math.isfinite(lane[field]) or lane[field]<=0:raise HTTPException(400,'资源预算无效')
        if lane['gpu_total_gib']<GPU_MODELS[model]['min_vram_gib'] or lane['ram_budget_gib']<GPU_MODELS[model]['min_ram_gib']:raise HTTPException(400,'模型资源预算不足')
        used.setdefault(str(lane['device']),[]).append(lane);ram+=lane['ram_budget_gib']
    reserves=value.get('reserve_vram_gib',{})
    for device,group in used.items():
        reserve=reserves.get(device,0)
        if type(reserve) not in (int,float) or reserve<2 or not math.isfinite(reserve):raise HTTPException(400,'需要保留显存余量')
        if len({p['gpu_total_gib'] for p in group})!=1 or sum(p['gpu_budget_gib'] for p in group)+reserve>group[0]['gpu_total_gib']:raise HTTPException(400,'同卡资源预算超出显存')
    shared=len(used)==1;min_reserve_ram=32 if shared else 16
    if value.get('reserve_ram_gib',0)<min_reserve_ram or value.get('ram_total_gib',0)<ram+value['reserve_ram_gib']:raise HTTPException(400,'并发系统内存不足')
    if shared and (lanes['MiniMax H3']['gpu_budget_gib']<128 or lanes['breeze-tts-2']['gpu_budget_gib']<12 or next(iter(reserves.values()))<16):raise HTTPException(400,'同卡并发预算不足')
    return {k:value[k] for k in ('mode','policy','lanes','ram_total_gib','reserve_ram_gib','reserve_vram_gib')}|{'shared_gpu':shared}


def set_plan(con,node,value):
    value=validate(value,json.loads(node['models']));old=read(node)
    if value!=old:
        if not (old.get('mode','serial')=='serial' and value['mode']=='serial') and con.execute("SELECT 1 FROM jobs WHERE node=? AND status='running'",(node['id'],)).fetchone():raise HTTPException(409,'请先等待实例任务完成后更改执行方式')
        con.execute('UPDATE nodes SET execution_plan=? WHERE id=?',(json.dumps(value),node['id']))
        con.execute('DELETE FROM node_lanes WHERE node=?',(node['id'],))
    return value


def slot_free(con,node,model):
    parallel=read(node).get('mode')=='parallel'
    sql="SELECT 1 FROM jobs WHERE node=? AND status='running'";args=[node['id']]
    if parallel:sql+=' AND model=?';args.append(model)
    return not con.execute(sql,args).fetchone()


def summarize(con,node,stamp):
    rows=[dict(r) for r in con.execute('SELECT * FROM node_lanes WHERE node=? AND lastseen>?',(node['id'],stamp-75))]
    ready=[r['model'] for r in rows if r['stage'] in ('ready','busy')]
    running=[r[0] for r in con.execute("SELECT model FROM jobs WHERE node=? AND status='running'",(node['id'],))]
    # Before lane workers start, the parent owns installation progress and errors.
    if not rows and not running:return rows
    errors=[r for r in rows if r['stage']=='error']
    stage='busy' if running else 'ready' if ready else 'error' if errors else 'preparing'
    detail='视频与语音生成中' if len(running)>1 else '正在生成语音' if running==['breeze-tts-2'] else '正在生成视频' if running else '就绪' if ready else '正在准备模型'
    blocked=[r for r in rows if r['stage']=='ready' and not r['can_accept']]
    if blocked:detail='；'.join(GPU_MODELS[r['model']]['label']+'：'+r['detail'] for r in blocked)[:300]
    if errors:detail='；'.join(GPU_MODELS[r['model']]['label']+'：'+r['detail'] for r in errors)[:300]
    con.execute('UPDATE nodes SET stage=?,detail=?,ready_models=? WHERE id=?',(stage,detail,json.dumps(ready),node['id']))
    return rows
