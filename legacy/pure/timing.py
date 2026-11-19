import model_policy
from node_models import GPU_MODELS, can_run, can_run_job, H3_TURBO_WORKFLOW, H3_LEGACY_TURBO_WORKFLOW, h3_input_metadata, h3_fast_preset, h3_pipeline_id
"""Measured per-attempt timing and conservative estimates; no prompts or credentials."""
import hashlib
import json
import math
import statistics
import time

WORKFLOW = "h3-v3-rocm-qkv-safe-standard20"
ESTIMATOR_VERSION = 4
PHASES = ("preparing", "generating", "finalizing", "uploading", "validating")


def loads(value, default=None):
    try:
        return json.loads(value) if isinstance(value, str) else value
    except (ValueError, TypeError):
        return default if default is not None else {}


def hardware_signature(profile):
    if not str(profile.get("gpu_name", "")).strip():
        return ""
    # Capacity and actual per-task GPU count are distinct; spare cards do not accelerate a task.
    keys = ('backend','gpu_name','vram_gib','used_gpus','runtime','driver','torch_version','precision','attention','memory_mode')
    normalized = {k: str(profile.get(k, "")).strip().lower() for k in keys}
    return hashlib.sha256(json.dumps(normalized,sort_keys=True).encode()).hexdigest()[:32]


def video_mode(value):
    if value.get('kind')=='audio':return 'tts'
    if value.get('video_mode'):
        return value['video_mode']
    refs = value.get('refs', [])
    count = refs if isinstance(refs, int) else len(loads(refs, []))
    return 'r2v' if count > 1 else 'i2v' if count else 't2v'


def workflow_family(value):
    # The standard 20-step graph is unchanged by making the count configurable.
    return 'h3-native-qkv-safe' if value in ('h3-v3-rocm-qkv-safe-standard20','h3-v4-rocm-qkv-safe-configurable',H3_LEGACY_TURBO_WORKFLOW,H3_TURBO_WORKFLOW) else value


def pipeline_mode(value):
    return h3_pipeline_id(value) if value.get('model','MiniMax H3')=='MiniMax H3' else video_mode(value)


from flow_catalog import MODELS as FLOW_MODELS

def features(job, con=None, node=None):
    job, node = dict(job), dict(node or {})
    refs = loads(job.get("refs", []), [])
    pixels = 0
    if con:
        for key in refs:
            row = con.execute("SELECT w,h FROM media WHERE id=?", (key,)).fetchone()
            if row:
                pixels += row[0] * row[1]
    kind = job.get("kind", "video")
    if job.get('model') in FLOW_MODELS:
        spec=FLOW_MODELS[job['model']]
        return {'kind':kind,'executor':'flow-api','model':job['model'],'workflow':'flow2api-v1',
                'width':0,'height':0,'native_ratio':spec['ratio'],'seconds':spec['seconds'],
                'steps':0,'video_mode':spec['mode'],'quality':spec['resolution'],'refs':len(refs),
                'ref_pixels':pixels,'hardware':'flow-api','profile':{},'runtime_id':'','cold':None}
    if job.get('model') in ('muse-image','muse-video'):
        return {'kind':kind,'executor':'muse-api','model':job['model'],'workflow':'muse2api-native-v1',
                'width':0,'height':0,'native_ratio':job['ratio'],'seconds':job.get('seconds',0) if kind=='video' else 0,
                'steps':0,'video_mode':'i2v' if kind=='video' and refs else 't2v' if kind=='video' else 'image',
                'quality':'native','refs':len(refs),'ref_pixels':pixels,'hardware':'muse-api','profile':{},'runtime_id':'','cold':None}
    profile = (loads(node.get('model_profiles','{}')) or {}).get(job.get('model')) or loads(node.get("profile", "{}")) or {}
    if kind=='audio':
        text=job.get('prompt','');length=job.get('text_chars') or max(1,len(text))
        language=job.get('language') or ('zh' if any('\u4e00'<=c<='\u9fff' for c in text) else 'en')
        voice=(loads(job.get('audio_settings','{}')) or {}).get('instruction','')
        quality=language+'|'+hashlib.sha256(voice.encode()).hexdigest()[:12]
        return {'kind':'audio','executor':'gpu','model':job['model'],'workflow':GPU_MODELS[job['model']]['workflow'],
                'width':length,'height':1,'seconds':0,'steps':0,'video_mode':'tts','quality':quality,
                'refs':0,'ref_pixels':0,'hardware':hardware_signature(profile) if profile else node.get('hardware',''),
                'profile':profile,'runtime_id':node.get('runtime_id',''),'cold':None}

    executor = job.get("executor") or ("gpu" if kind == "video" else "openai-api")
    cold = None
    if con and kind == "video" and node.get("runtime_id") and node.get("id"):
        parallel=loads(node.get('execution_plan','{}')).get('mode')=='parallel'
        previous=con.execute("SELECT features FROM job_runs WHERE node=? AND status='done' AND (? IS NULL OR model=?) ORDER BY id DESC LIMIT 1",(node['id'],job.get('model') if parallel else None,job.get('model') if parallel else None)).fetchone()
        old = loads(previous[0]) if previous else {}
        cold = not (old.get("runtime_id") == node["runtime_id"] and pipeline_mode(old) == pipeline_mode(job))
    return {"kind": kind, "executor": executor, "model": job.get("model", "MiniMax H3"),
            "workflow": ('h3-turbo4-'+h3_fast_preset(job)['id'] if job.get('sampling_steps')==4 else (node.get("workflow") or WORKFLOW)) if kind == "video" else "openai-images-png-v1",
            "width": job["width"], "height": job["height"], "seconds": job.get("seconds", 0),
            "steps": job.get('sampling_steps',4 if len(refs)==1 and int(job["quality"])==768 and node.get("workflow")=="h3-v3-rocm-qkv-safe-fast4-i2v768" else 20) if kind == "video" else 0,
            "video_mode": (h3_pipeline_id(dict(job)).split("|")[0] if h3_input_metadata(dict(job)) else "r2v" if len(refs)>1 else "i2v" if refs else "t2v") if kind=="video" else "image",
            "quality": str(job.get("image_quality", "medium")) if kind == "image" else str(job["quality"]),
            "refs": len(refs), "ref_pixels": pixels,
            "hardware": (hardware_signature(profile) if profile else node.get("hardware", "")) if kind == "video" else "openai-api",
            "profile": profile,
            "runtime_id": node.get("runtime_id", ""), "cold": cold}


def import_legacy(con):
    for row in con.execute("SELECT * FROM jobs WHERE status='done' AND NOT EXISTS(SELECT 1 FROM job_runs r WHERE r.job=jobs.id)").fetchall():
        j = dict(row)
        legacy_features = features(j, con)
        if j['kind'] == 'video':
            legacy_features['workflow'] = 'legacy-unverified'
        con.execute("""INSERT OR IGNORE INTO job_runs(job,run_key,attempt,node,kind,model,features,created,finished,status,phase,valid)
          VALUES(?,?,?,?,?,?,?,?,?,'legacy','done',0)""", (j['id'], 'legacy:'+str(j['id']), j['attempts'], j['node'],
          j['kind'], j['model'], json.dumps(legacy_features), j['created'], j['updated']))


def weighted_quantile(rows, q):
    rows = sorted(rows)
    cutoff, sofar = sum(weight for _, weight in rows) * q, 0
    for value, weight in rows:
        sofar += weight
        if sofar >= cutoff:
            return value
    return rows[-1][0]


class Estimator:
    def __init__(self, con):
        self.samples = [dict(r) for r in con.execute("""SELECT * FROM job_runs
          WHERE status='legacy' OR (status='done' AND valid=1 AND started IS NOT NULL)
          ORDER BY id DESC LIMIT 500""")]
        for row in self.samples:
            row['f'] = loads(row['features'])

    def estimate(self, target, node_id=None):
        matches = []
        cold_references = []
        for row in self.samples:
            f = row['f']
            if any(f.get(k) != target.get(k) for k in ('kind', 'executor', 'model', 'quality', 'video_mode')) or workflow_family(f.get('workflow'))!=workflow_family(target.get('workflow')):
                continue
            # Never infer a video length multiplier from just one observed length.
            if target['kind'] == 'audio' and abs(math.log(max(1,f['width'])/max(1,target['width'])))>math.log(1.8):continue
            if target['kind'] == 'video' and f['seconds'] != target['seconds']:
                continue
            if bool(f['refs']) != bool(target['refs']):
                continue
            if target.get('executor') == 'gpu':
                if target.get('hardware'):
                    if f.get('hardware') != target['hardware']:
                        continue
                elif not node_id or row['node'] != node_id or f.get('hardware'):
                    # Unreported legacy hardware can inform only the same instance.
                    continue
            cold_reference = f.get('cold') is True and target.get('cold') is False
            if f.get('cold') is not None and target.get('cold') is not None and f['cold'] != target['cold'] and not cold_reference:
                continue
            if target.get('executor') in ('muse-api','flow-api'):
                if f.get('native_ratio')!=target.get('native_ratio'):continue
                distance=0
            else:
                distance = abs(math.log((f['width'] * f['height']) / (target['width'] * target['height'])))
                distance += .25 * abs(math.log((f['width'] / f['height']) / (target['width'] / target['height'])))
            distance += .15 * abs(f['refs'] - target['refs'])
            if f.get('ref_pixels') and target.get('ref_pixels'):
                distance += .1 * abs(math.log(f['ref_pixels'] / target['ref_pixels']))
            if distance > 1.5:
                continue
            actual = row['finished'] - (row['started'] if row['started'] is not None else row['created'])
            if actual <= 0:
                continue
            scaled=False
            if target['kind']=='video' and target.get('executor')=='gpu' and f.get('steps',20)!=target.get('steps',20):
                generated=loads(row.get('details')).get('generate_s')
                if not isinstance(generated,(int,float)) or not 0<generated<=actual or f.get('steps',0)<=0:continue
                actual=actual-generated+generated*target['steps']/f['steps']
                distance+=.35*abs(math.log(target['steps']/f['steps']))
                scaled=True
            row=dict(row,step_scaled=scaled)
            (cold_references if cold_reference else matches).append((distance, actual, row))
        # With no warm sample yet, retain the full measured cold duration as a
        # conservative reference. Never infer an unobserved cold-load cost from warm runs.
        cold_fallback = not matches and bool(cold_references)
        if cold_fallback:
            matches = cold_references
        # Accurate new samples displace legacy end-to-end waiting records.
        precise = [x for x in matches if x[2]['status'] == 'done']
        if precise:
            matches = precise
        if not matches:
            return {"source": "none", "samples": 0, "confidence": "none", "version": ESTIMATOR_VERSION}
        exact_steps=[x for x in matches if not x[2].get('step_scaled')]
        if exact_steps:matches=exact_steps
        local = [x for x in matches if node_id and x[2]['node']==node_id and x[2]['status']=='done' and x[2]['f'].get('runtime_id','')==target.get('runtime_id','')]
        calibrated = len(local) >= 3
        if calibrated:
            matches = local
        matches.sort(key=lambda x: (x[0], -x[2]['id']))
        nearest = matches[0][0]
        chosen = [x for x in matches if x[0] <= nearest + .45][:30]
        weighted = [(value, math.exp(-distance)) for distance, value, row in chosen]
        median = weighted_quantile(weighted, .5)
        count = len(chosen)
        legacy = chosen[0][2]['status'] == 'legacy'
        unknown_cohort = target.get('executor')=='gpu' and any(not x[2]['f'].get('hardware') or x[2]['f'].get('cold') is None for x in chosen)
        step_scaled=any(x[2].get('step_scaled') for x in chosen)
        confidence = 'low' if count < 5 or nearest > .05 or legacy or unknown_cohort or cold_fallback or step_scaled else 'medium' if count < 15 else 'high'
        spread = .6 if confidence == 'low' else .3 if confidence == 'medium' else .2
        low = max(1, min(weighted_quantile(weighted, .15), median * (1-spread)))
        high = max(weighted_quantile(weighted, .85), median * (1+spread))
        tails = []
        for _, _, row in chosen:
            if row.get('finalizing') and row.get('finished'):
                tails.append(row['finished'] - row['finalizing'])
            elif row.get('uploading') and row.get('finished'):
                measured_finish = loads(row['details']).get('finalize_s')
                tails.append(row['finished'] - row['uploading'] + (measured_finish if measured_finish is not None else 12))
        return {"low": round(low), "median": max(1,round(median)), "high": max(2, round(high)),
                "source": 'legacy' if legacy else 'step_scaled' if step_scaled else 'cold_reference' if cold_fallback else 'history' if nearest <= .05 else 'similar',
                "samples": count, "confidence": confidence, "calibrated": calibrated, "tail": statistics.median(tails) if tails else None,
                "version": ESTIMATOR_VERSION}


def current_run(con, jid):
    row = con.execute('SELECT * FROM job_runs WHERE job=? ORDER BY id DESC LIMIT 1', (jid,)).fetchone()
    return dict(row) if row else None


def run_key(job):
    job = dict(job)
    value = job.get('ticket') or f"image:{job['id']}:{job.get('attempts',0)}"
    return hashlib.sha256(value.encode()).hexdigest()


def start_run(con, job, node=None, timestamp=None):
    j = dict(job)
    stamp = time.time() if timestamp is None else timestamp
    f = features(j, con, node)
    if j['model'] in GPU_MODELS and f['runtime_id']:
        parallel=loads(dict(node or {}).get('execution_plan','{}')).get('mode')=='parallel'
        previous=con.execute("SELECT features FROM job_runs WHERE node=? AND status='done' AND (? IS NULL OR model=?) ORDER BY id DESC LIMIT 1",(j.get('node'),j['model'] if parallel else None,j['model'] if parallel else None)).fetchone()
        old = loads(previous[0]) if previous else {}
        f['cold'] = not (old.get('runtime_id') == f['runtime_id'] and pipeline_mode(old) == pipeline_mode(f))
    prediction = Estimator(con).estimate(f, j.get('node'))
    previous = current_run(con, j['id'])
    queued_at = max(j['created'], previous['finished']) if previous and previous['finished'] else j['created']
    con.execute("""INSERT OR IGNORE INTO job_runs(job,run_key,attempt,node,kind,model,features,created,queued,started,status,phase,predicted,steps)
      VALUES(?,?,?,?,?,?,?,?,?,?,'running','preparing',?,?)""", (j['id'],run_key(j),j['attempts'],j.get('node'),j['kind'],j['model'],json.dumps(f),j['created'],queued_at,stamp,json.dumps(prediction),f['steps']))
    return current_run(con, j['id'])


def mark_phase(con, job, phase, timestamp=None):
    if phase not in PHASES:
        return
    row = current_run(con, dict(job)['id'])
    if not row or row['status'] not in ('running','interrupted'):
        return
    stamp = time.time() if timestamp is None else timestamp
    if row['started'] is None:
        return
    phase = max((row['phase'], phase), key=lambda p: PHASES.index(p) if p in PHASES else -1)
    column = {'generating':'generating','finalizing':'finalizing','uploading':'uploading','validating':'validating'}.get(phase)
    if column:
        con.execute(f'UPDATE job_runs SET {column}=coalesce({column},?),phase=? WHERE id=?', (max(stamp,row['started']),phase,row['id']))


def observe(con, job, beat, timestamp=None):
    row = current_run(con, dict(job)['id'])
    if not row or row['run_key'] != run_key(job):
        return
    stamp = time.time() if timestamp is None else timestamp
    if row['status'] == 'interrupted':
        con.execute("UPDATE job_runs SET status='running',finished=NULL,valid=0 WHERE id=?", (row['id'],))
        row['status'],row['finished'],row['valid'] = 'running',None,0
    phase = beat.get('job_phase') or ('uploading' if beat.get('uploading') else None)
    step, steps = beat.get('step'), beat.get('steps')
    advanced = False
    expected_steps = loads(row['features']).get('steps', 20)
    if step is not None and steps == expected_steps and 0 <= step <= steps <= 100:
        progress = loads(row['progress'], [])
        if not progress or step > progress[-1][0]:
            advanced = True
            progress.append([step, stamp])
            con.execute('UPDATE job_runs SET step=?,steps=?,progress=? WHERE id=?', (step,steps,json.dumps(progress[-16:]),row['id']))
        if step < steps:
            phase = phase or 'generating'
        else:
            phase = phase or 'finalizing'
    if phase:
        mark_phase(con, job, phase, stamp)
    telemetry = beat.get('timing')
    if telemetry:
        apply_telemetry(con, row, telemetry, stamp)
    if advanced:
        updated = current_run(con, dict(job)['id'])
        estimate = remaining(updated, stamp)
        if estimate.get('high') is not None:
            detail = loads(updated['details'])
            history = detail.get('eta_history', [])
            history.append({'at': stamp, 'low': estimate['low'], 'median': estimate['median'], 'high': estimate['high'], 'source': estimate['source']})
            detail['eta_history'] = history[-32:]
            con.execute('UPDATE job_runs SET details=? WHERE id=?', (json.dumps(detail),updated['id']))


def apply_telemetry(con, row, telemetry, stamp):
    allowed = ('prepare_s','generate_s','finalize_s')
    detail = loads(row['details'])
    for key in ('peak_vram_bytes','peak_allocated_vram_bytes'):
        if type(telemetry.get(key)) is int and 0<=telemetry[key]<=2**50:detail[key]=telemetry[key]
    values = {k: telemetry[k] for k in allowed if isinstance(telemetry.get(k),(int,float)) and math.isfinite(telemetry[k]) and 0 <= telemetry[k] <= 172800}
    # Worker monotonic intervals cannot exceed the server-observed attempt duration.
    if sum(values.values()) <= max(0, stamp-row['started']) + 45:
        detail.update(values)
        if values:
            detail['source'] = 'worker'
    f = loads(row['features'])
    if isinstance(telemetry.get('cold'),bool):
        f['cold'] = telemetry['cold']
    valid = row['valid'] and not telemetry.get('recovered',False)
    con.execute('UPDATE job_runs SET details=?,features=?,valid=? WHERE id=?', (json.dumps(detail),json.dumps(f),int(valid),row['id']))


def end_run(con, job, status, timestamp=None, telemetry=None):
    j = dict(job)
    stamp = time.time() if timestamp is None else timestamp
    row = current_run(con, j['id'])
    if row and row['status'] == 'done':
        return
    if not row or (status=='cancelled' and j['status']=='queued' and row['finished'] is not None):
        if status == 'cancelled':
            con.execute("""INSERT OR IGNORE INTO job_runs(job,run_key,attempt,node,kind,model,features,created,finished,status,phase,valid)
              VALUES(?,?,?,?,?,?,?,?,?,'cancelled','queued',0)""", (j['id'],'cancel:'+str(j['id']),0,None,j['kind'],j['model'],json.dumps(features(j,con)),j['created'],stamp))
        return
    if telemetry:
        apply_telemetry(con, row, telemetry, stamp)
    if row['status'] == 'interrupted' and status == 'done':
        con.execute('UPDATE job_runs SET valid=0 WHERE id=?', (row['id'],))
    con.execute('UPDATE job_runs SET finished=?,status=?,phase=? WHERE id=?', (stamp,status,'done' if status=='done' else row['phase'],row['id']))


def elapsed_detail(row, stamp):
    if not row:
        return None
    end = row['finished'] or stamp
    if row['started'] is None:
        return {'source':'queued' if row['status']=='running' and row['phase']=='queued' else 'legacy' if row['status']=='legacy' else 'cancelled', 'total':max(0,round(end-row['created']))}
    start = row['started']
    details = loads(row['details'])
    result = {'source':'measured','elapsed':max(0,round(end-start)), 'queue':max(0,round(start-(row.get('queued') or row['created']))),
              'total':max(0,round(end-row['created'])), 'attempt':row['attempt'], 'phase_source':details.get('source','observed'),
              'prediction': loads(row['predicted'])}
    marks = [('prepare',start),('generation',row['generating']),('finalize',row['finalizing']),('upload',row['uploading']),('validation',row['validating'])]
    for index, (name, value) in enumerate(marks):
        if name == 'prepare' and row['generating'] is None:
            continue
        if value is not None:
            next_time = next((mark for _,mark in marks[index+1:] if mark is not None),end)
            result[name] = max(0,round(next_time-value))
    for field, name in [('prepare_s','prepare'),('generate_s','generation'),('finalize_s','finalize')]:
        if field in details:
            result[name] = round(details[field])
    if row['status']=='done' and result['prediction'].get('median'):
        result['prediction_error'] = result['elapsed'] - result['prediction']['median']
    return result


def remaining(row, stamp):
    if not row or row['started'] is None:
        return {'phase':'generating','source':'none','elapsed':None}
    prediction = loads(row['predicted'])
    elapsed = max(0,stamp-row['started'])
    out = {'phase':row['phase'], 'source':prediction.get('source','none'), 'elapsed':round(elapsed)}
    if prediction.get('high'):
        out.update(low=max(0,prediction['low']-elapsed),median=max(0,prediction['median']-elapsed),high=max(0,prediction['high']-elapsed),overdue=elapsed>prediction['high'])
    progress = loads(row['progress'], [])
    rates = [(b[1]-a[1])/(b[0]-a[0]) for a,b in zip(progress,progress[1:]) if a[0]>=1 and b[0]>a[0] and b[1]>a[1]]
    if row['phase']=='generating' and len(rates)>=2 and row['step'] < row['steps']:
        rate = statistics.median(rates[-5:])
        tail = prediction.get('tail')
        # Small conservative finishing allowance until real finishing samples exist.
        tail = max(15, tail) if tail is not None else 60
        left = (row['steps']-row['step'])*rate
        last = progress[-1][1]
        high = last+left*1.3+tail-stamp
        out.update(low=max(0,last+left*.8+tail*.5-stamp), median=max(0,last+left+tail-stamp),
                   high=max(0,high), overdue=high<0,source='progress')
    elif row['phase'] in ('finalizing', 'uploading', 'validating') and row.get('finalizing') is not None:
        # Sampling is complete, but encoding and delivery still occupy the worker.
        # Keep a bounded finishing allowance even on its first measured task.
        tail = max(15, prediction.get('tail') or 60)
        tail_elapsed = max(0, stamp-row['finalizing'])
        out.update(low=max(0,tail*.5-tail_elapsed), median=max(0,tail-tail_elapsed),
                   high=max(0,tail*1.8-tail_elapsed), overdue=tail_elapsed>tail*1.8,
                   source='finishing', confidence='low')
    return out


def all_nodes(con):
    nodes=[dict(r) for r in con.execute("SELECT * FROM nodes WHERE control!='removed'")]
    for node in nodes:
        node['lanes']=[dict(r) for r in con.execute('SELECT * FROM node_lanes WHERE node=?',(node['id'],))]
    return nodes


def planning_prediction(estimator, target, node_id, live_runs, stamp):
    prediction = estimator.estimate(target, node_id)
    if prediction.get('high') is not None and prediction['source'] != 'legacy':
        return prediction
    for row in live_runs.values():
        f = loads(row['features'])
        if not row.get('valid', 1) or row.get('status') != 'running':
            continue
        keys = ('kind','executor','model','workflow','quality','video_mode','width','height','seconds','refs','steps')
        if any(f.get(k) != target.get(k) for k in keys):
            continue
        if target.get('executor') == 'gpu':
            if target.get('hardware'):
                if f.get('hardware') != target['hardware']:
                    continue
            elif row.get('node') != node_id or f.get('hardware'):
                continue
        if target.get('cold') is True and f.get('cold') is not True:
            continue
        eta = remaining(row, stamp)
        if eta.get('source') not in ('progress', 'finishing') or eta.get('overdue'):
            continue
        # A provisional total from this exact workload is distinct from completed samples.
        elapsed = max(0, stamp-row['started'])
        return {k: max(1, round(elapsed+eta[k])) for k in ('low','median','high')} | {
            'source':'live_progress','samples':0,'confidence':'low','provisional':True,
            'version':ESTIMATOR_VERSION}
    return {'source':'none','samples':0,'confidence':'none','version':ESTIMATOR_VERSION}


def local_queue_estimates(con, jobs, nodes, runs, estimator, stamp):
    """FIFO list scheduling over real worker slots, with uncertain assignments preserved.

    Each branch follows a possible next claimant. Slot intervals and model-cache
    states advance after every simulated job. Bound merging keeps all workers and
    possible modes when branches grow; it widens uncertainty instead of dropping it.
    """
    expanded=[]
    for node in nodes:
        if loads(node.get('execution_plan','{}')).get('mode')=='parallel':
            for lane in node.get('lanes',[]):
                if lane['stage'] not in ('ready','busy') or stamp-lane['lastseen']>75:continue
                expanded.append(dict(node,stage=lane['stage'],lastseen=lane['lastseen'],runtime_id=lane['runtime_id'],ready_models=json.dumps([lane['model']]),_lane_model=lane['model'],_can_accept=bool(lane['can_accept'])))
        else:expanded.append(node)
    nodes=expanded
    dispatch_grace = 5
    max_states = 32
    alive = [n for n in nodes if n['stage'] in ('ready','busy') and stamp-n['lastseen'] <= 75]
    active = [n for n in alive if n['control'] == 'active']
    alive_ids = {n['id'] for n in alive}
    live_runs = {j['id']: runs[j['id']] for j in jobs if j['status']=='running' and j['id'] in runs
                 and (j['kind']=='image' or j.get('node') in alive_ids)}
    groups = {'gpu':[], 'image':[]}
    for node in active:
        lane_model=node.get('_lane_model')
        previous=con.execute("SELECT features,finished FROM job_runs WHERE node=? AND status='done' AND (? IS NULL OR model=?) ORDER BY id DESC LIMIT 1",(node['id'],lane_model,lane_model)).fetchone()
        old = loads(previous['features']) if previous else {}
        mode = pipeline_mode(old) if old and old.get('runtime_id') == node.get('runtime_id') else None
        running = next((j for j in jobs if j.get('node')==node['id'] and j['status']=='running' and (not lane_model or j['model']==lane_model)),None)
        if running:
            row = runs.get(running['id'])
            mode = pipeline_mode(loads(row['features'])) if row and row.get('features') else pipeline_mode(running)
            eta = remaining(row, stamp)
            bounded = eta.get('high') is not None and not eta.get('overdue')
            slot = {k: eta.get(k,0) if bounded else 0 if k=='low' else None for k in ('low','median','high')}
        elif node['stage'] == 'ready':
            slot = dict(low=0,median=0,high=0) if node.get('_can_accept',True) else dict(low=0,median=None,high=None)
        elif previous and previous['finished'] >= node['lastseen']:
            slot = dict(low=0,median=0,high=dispatch_grace)
        else:
            slot = dict(low=0,median=None,high=None)
        groups['gpu'].append(slot | {'node':node, 'modes':frozenset([mode])})
    image_config = con.execute("SELECT value FROM settings WHERE key='openai_images'").fetchone()
    image_enabled = not image_config or loads(image_config[0]).get('enabled', True)
    if image_enabled:
        running = next((j for j in jobs if j['kind']=='image' and j['status']=='running'), None)
        eta = remaining(runs.get(running['id']),stamp) if running else dict(low=0,median=0,high=0)
        bounded = eta.get('high') is not None and not eta.get('overdue')
        groups['image'] = [{k:eta.get(k,0) if bounded else 0 if k=='low' else None for k in ('low','median','high')} |
                           {'node':{},'modes':frozenset([None])}]
    plans = {}
    for kind, initial in groups.items():
        waiting = sorted((j for j in jobs if j['status']=='queued' and (j['model'] in GPU_MODELS if kind=='gpu' else j['kind']==kind)),key=lambda j:j['id'])
        states = [initial]
        expected = initial
        prediction_cache = {}
        merged = False
        for ahead, job in enumerate(waiting):
            eligible = lambda slot: kind!='gpu' or can_run_job(slot['node'],job)
            if not any(eligible(s) for s in initial):
                update_needed=kind=='gpu' and job.get('model')=='MiniMax H3' and any(can_run(s['node'],job['model']) for s in initial)
                plans[job['id']] = {'source':'none','reason':'worker_update' if update_needed else 'waiting_gpu' if kind=='gpu' else 'service_paused', 'ahead':ahead}
                continue
            def predict(slot):
                node = slot['node']
                key = (job['id'],node.get('id'),tuple(sorted(str(x) for x in slot['modes'])))
                if key not in prediction_cache:
                    f = features(job,con,node)
                    predictions = []
                    for mode in slot['modes']:
                        target = f | {'cold':mode != pipeline_mode(job)} if kind=='gpu' and node.get('runtime_id') else f
                        predictions.append(planning_prediction(estimator,target,node.get('id'),live_runs,stamp))
                    if any(p.get('high') is None for p in predictions):
                        p = {'source':'none','samples':0,'confidence':'none'}
                    else:
                        p = dict(predictions[0])
                        p.update(low=min(v['low'] for v in predictions),median=round(statistics.median(v['median'] for v in predictions)),
                                 high=max(v['high'] for v in predictions))
                    prediction_cache[key] = p
                return prediction_cache[key]
            # The central schedule is a forecast, never a reservation: actual claims remain FIFO.
            known_expected = [i for i,s in enumerate(expected) if eligible(s) and s['median'] is not None]
            expected_start = None
            expected_prediction = None
            if known_expected:
                chosen = min(known_expected,key=lambda i:(expected[i]['median'],expected[i]['node'].get('id',0)))
                slot = expected[chosen]
                expected_start = slot['median']
                p = predict(slot)
                expected_prediction = p
                next_slot = dict(slot, median=expected_start+p['median'] if p.get('median') is not None else None,
                                 modes=frozenset([pipeline_mode(job)]))
                expected = [next_slot if i==chosen else s for i,s in enumerate(expected)]
            waits, durations, completions, next_states, candidates = [], [], [], [], set()
            for slots in states:
                ceiling = min((s['high'] for s in slots if eligible(s) and s['high'] is not None), default=None)
                for index, slot in enumerate(slots):
                    if not eligible(slot):continue
                    if ceiling is not None and slot['low'] > ceiling:
                        continue
                    start = {'low':slot['low'], 'high':None if ceiling is None else ceiling+dispatch_grace}
                    waits.append(start)
                    candidates.add(slot['node'].get('id'))
                    p = predict(slot)
                    durations.append(p)
                    finish = {'low':start['low']+p.get('low',0),
                              'high':start['high']+p['high'] if start['high'] is not None and p.get('high') is not None else None}
                    completions.append(finish)
                    next_slot = dict(slot,low=finish['low'],high=finish['high'],modes=frozenset([pipeline_mode(job)]))
                    next_states.append([next_slot if i==index else dict(s,low=max(s['low'],start['low'])) if eligible(s) else s for i,s in enumerate(slots)])
            high = max(w['high'] for w in waits) if all(w['high'] is not None for w in waits) else None
            low = min(w['low'] for w in waits)
            source = 'queue' if high is not None else 'none'
            plan = {'source':source,'reason':None if high is not None else 'observing','low':round(low),
                    'median':None if expected_start is None else round(max(low,min(expected_start,high if high is not None else expected_start))),
                    'high':None if high is None else round(high), 'ahead':ahead,
                    'node_ids':sorted(n for n in candidates if n is not None), 'confidence':'low', 'merged':merged,
                    'version':ESTIMATOR_VERSION}
            if all(p.get('high') is not None for p in durations):
                point = (expected_prediction or {}).get('median')
                plan['duration'] = {'low':min(p['low'] for p in durations),'high':max(p['high'] for p in durations),
                                    'median':round(point if point is not None else statistics.median(p['median'] for p in durations)),
                                    'source':'live_progress' if any(p.get('provisional') for p in durations) else 'multi_instance' if len(candidates)>1 else durations[0]['source'],
                                    'samples':min(p.get('samples',0) for p in durations), 'confidence':'low' if len(candidates)>1 else durations[0].get('confidence','low'),
                                    'version':ESTIMATOR_VERSION}
            if all(p['high'] is not None for p in completions):
                plan['finish'] = {'low':round(min(p['low'] for p in completions)), 'high':round(max(p['high'] for p in completions))}
            plans[job['id']] = plan
            unique = {}
            for slots in next_states:
                key = tuple((round(s['low'],2),None if s['high'] is None else round(s['high'],2),tuple(sorted(str(x) for x in s['modes']))) for s in slots)
                unique[key] = slots
            states = list(unique.values())
            if len(states)>max_states:
                merged = True
                states = [[dict(initial[i],low=min(s[i]['low'] for s in states),
                                high=max(s[i]['high'] for s in states) if all(s[i]['high'] is not None for s in states) else None,
                                modes=frozenset().union(*(s[i]['modes'] for s in states))) for i in range(len(initial))]]
    return plans

def queue_estimates(con, jobs, nodes, runs, estimator, stamp):
    paused={j['id']:{'source':'none','reason':'model_paused','ahead':0} for j in jobs if j['status']=='queued' and not model_policy.enabled(con,j.get('model','MiniMax H3'),j.get('workspace'))}
    jobs=[j for j in jobs if j['id'] not in paused]
    remote=[dict(j) for j in jobs if j.get('model') in ('muse-image','muse-video')]
    flow=[dict(j) for j in jobs if j.get('model') in FLOW_MODELS]
    local=[j for j in jobs if j.get('model') not in ('muse-image','muse-video') and j.get('model') not in FLOW_MODELS]
    plans=local_queue_estimates(con,local,nodes,runs,estimator,stamp)
    plans.update(paused)
    flow_health=con.execute("SELECT value FROM settings WHERE key='flow_health'").fetchone()
    flow_status=loads(flow_health[0]) if flow_health else {}
    flow_available=flow_status.get('ready') and stamp-flow_status.get('checked',0)<90
    flow_running=[j for j in flow if j['status']=='running']
    flow_ahead=len(flow_running)
    for job in sorted((j for j in flow if j['status']=='queued'),key=lambda j:j['id']):
        prediction=estimator.estimate(features(job,con))
        plans[job['id']]={'source':'none','reason':'flow_busy' if flow_running else 'observing' if flow_available else 'waiting_flow',
                         'ahead':flow_ahead,'duration':prediction}
        flow_ahead+=1
    health=con.execute("SELECT value FROM settings WHERE key='muse_health'").fetchone()
    status=loads(health[0]) if health else {}
    available=status.get('ready') and stamp-status.get('checked',0)<90
    enabled=con.execute("SELECT value FROM settings WHERE key='openai_images'").fetchone()
    image_enabled=not enabled or loads(enabled[0]).get('enabled',True)
    capacity=max(0,min(16,int(status.get('capacity',1))))
    own_ids={r['task_id'] for r in con.execute("SELECT p.task_id FROM provider_tasks p JOIN jobs j ON j.id=p.job WHERE j.status='running' AND j.model IN ('muse-image','muse-video')") if r['task_id']}
    external=sum(t.get('id') not in own_ids for t in status.get('tasks',[]))
    capacity=max(0,capacity-external-int(status.get('maintenance',0)))
    lanes=[dict(low=0,median=0,high=0) for _ in range(max(1,capacity))]
    busy=[j for j in remote if j['status']=='running' and (runs.get(j['id']) or {}).get('phase')!='queued']
    for index,job in enumerate(busy):
        eta=remaining(runs.get(job['id']),stamp)
        lane=lanes[min(index,len(lanes)-1)]
        for name in lane:
            lane[name]=max(lane[name] or 0,eta[name]) if eta.get(name) is not None and not eta.get('overdue') else None
    pending=[j for j in remote if j['status']=='queued' or (j['status']=='running' and (runs.get(j['id']) or {}).get('phase')=='queued')]
    ahead=0
    for job in sorted(pending,key=lambda j:j['id']):
        if job['kind']=='image' and not image_enabled:
            plans[job['id']]={'source':'none','reason':'service_paused','ahead':ahead};continue
        prediction=estimator.estimate(features(job,con))
        lane=min(lanes,key=lambda x:x['median'] if x['median'] is not None else float('inf'))
        if not available or not capacity:
            plans[job['id']]={'source':'none','reason':'waiting_muse' if not available else 'muse_busy','ahead':ahead,'duration':prediction}
        else:
            plans[job['id']]={**lane,'source':'queue' if lane['high'] is not None else 'none',
                              'reason':None if lane['high'] is not None else 'observing','ahead':ahead,'duration':prediction}
        if job['status']=='running':plans[job['id']]['phase']='queued'
        for name in lane:
            lane[name]=lane[name]+prediction[name] if lane[name] is not None and prediction.get(name) is not None else None
        ahead+=1
    return plans


def read_runs(con):
    return {r['job']:dict(r) for r in con.execute('SELECT * FROM job_runs WHERE id IN (SELECT max(id) FROM job_runs WHERE job IS NOT NULL GROUP BY job)')}


def attach(con, jobs, stamp=None):
    stamp = time.time() if stamp is None else stamp
    runs, estimator, nodes = read_runs(con), Estimator(con), all_nodes(con)
    plans = queue_estimates(con,jobs,nodes,runs,estimator,stamp)
    for j in jobs:
        row = runs.get(j['id'])
        j['timing'] = elapsed_detail(row,stamp)
        if j['status']=='running':
            j['eta'] = plans.get(j['id'],{'phase':'queued','source':'none'}) if row and row['phase']=='queued' else remaining(row,stamp)
        elif j['status']=='queued':
            j['eta'] = plans.get(j['id'],{'source':'none','reason':'unknown'})
        j.pop('timing_forecast',None)
    return stamp


def submission_forecast(con, job):
    j = dict(job)
    estimator, nodes = Estimator(con), all_nodes(con)
    eligible = [n for n in nodes if n['control']=='active' and n['stage'] in ('ready','busy') and time.time()-n['lastseen']<=75 and can_run_job(n,j)]
    if j['kind'] == 'image' or j.get('model') in ('muse-image','muse-video') or j.get('model') in FLOW_MODELS:
        return estimator.estimate(features(j,con))
    if not eligible:
        return {"source":"none","samples":0,"confidence":"none","reason":"no_instance","version":ESTIMATOR_VERSION}
    pending = [dict(r) for r in con.execute("SELECT * FROM jobs WHERE status IN ('queued','running') AND id!=?", (j['id'],))]
    plans = queue_estimates(con,pending+[j],nodes,read_runs(con),estimator,time.time())
    return plans.get(j['id'],{}).get('duration') or {
        "source":"none","samples":0,"confidence":"none","reason":"uncalibrated_instance","version":ESTIMATOR_VERSION}


def save_submission_forecast(con, jid):
    row = dict(con.execute('SELECT * FROM jobs WHERE id=?',(jid,)).fetchone())
    con.execute('UPDATE jobs SET timing_forecast=? WHERE id=?',(json.dumps(submission_forecast(con,row)),jid))
