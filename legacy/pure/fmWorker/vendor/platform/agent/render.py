"""Execute a leased platform job with the pinned native H3 graphs."""

import json
import sys
import time
from pathlib import Path
import requests
from reference_image import normalize_reference
from job_progress import sampling_steps
from sampler_progress import SamplerProgress
from video_quality import check_first_frame, VideoQualityError
from node_models import h3_fast_preset,h3_input_metadata,h3_reference_files,h3_keyframe_indices,h3_input_fingerprint

ROOT = Path(__file__).resolve().parent
ENGINE = ROOT / "engine"
sys.path.insert(0, str(ENGINE / "scripts"))
import generate as h3


def build_graph(job, input_folder):
    native=h3_input_metadata(job);files=h3_reference_files(job)
    mode = ('r2v' if native.get('mode')=='reference' and files else 't2v') if native else "r2v" if len(job["refs"]) > 1 else "t2v"
    paths={f['id']:f"fumiao/{input_folder}/{i}.{f['suffix']}" for i,f in enumerate(files)}
    refs = [{"server_name":paths[f['id']]} for f in files if f['kind']=='image']
    prompt = job["prompt"]
    if not native and len(refs) == 1:
        prompt = prompt.replace("<Picture 1>", "the first frame")
    if native.get('mode')=='frames':
        for index,ref in enumerate(files,1):
            role='first and last frame' if ref['id']==native.get('first_frame')==native.get('last_frame') else 'first frame' if ref['id']==native.get('first_frame') else 'last frame'
            prompt=prompt.replace(f'<Picture {index}>', 'the '+role)
    graph = h3.make_graph(mode, prompt, job["seed"], str(job["quality"]) + "p",
                          job["seconds"], sampling_steps(job), refs if mode == "r2v" else [], False, "unused")
    graph["5"]["inputs"].update(width=job["width"],height=job["height"],length={5:124,10:243,15:362}[job["seconds"]])
    if not native and len(refs) == 1:
        graph["21"] = {"class_type":"LoadImage","inputs":{"image":refs[0]["server_name"]}}
        graph["22"] = {"class_type":"ImageScale","inputs":{"image":["21",0],"upscale_method":"lanczos","width":job["width"],"height":job["height"],"crop":"center"}}
        graph["5"]["inputs"]["first_frame"] = ["22",0]
    if native.get('mode')=='frames':
        for i,role in enumerate(('first_frame','last_frame')):
            key=native.get(role)
            if not key:continue
            load,resize=str(30+i*2),str(31+i*2)
            graph[load]={'class_type':'LoadImage','inputs':{'image':paths[key]}}
            graph[resize]={'class_type':'ImageScale','inputs':{'image':[load,0],'upscale_method':'lanczos','width':job['width'],'height':job['height'],'crop':'center'}}
            graph['5']['inputs'][role]=[resize,0]
    if native.get('mode')=='reference':
        for i,ref in enumerate(f for f in files if f['kind']=='video'):
            load,split=str(40+i*2),str(41+i*2)
            graph[load]={'class_type':'LoadVideo','inputs':{'file':paths[ref['id']]}}
            graph[split]={'class_type':'GetVideoComponents','inputs':{'video':[load,0]}}
            graph['5']['inputs'][f'ref_videos.ref_video_{i}']=[split,0]
            if ref['id'] in native.get('video_audio',[]):graph['5']['inputs'][f'ref_video_audios.ref_video_audio_{i}']=[split,1]
        for i,ref in enumerate(f for f in files if f['kind']=='audio'):
            key=str(70+i);graph[key]={'class_type':'LoadAudio','inputs':{'audio':paths[ref['id']]}}
            graph['5']['inputs'][f'ref_audios.ref_audio_{i}']=[key,0]
    if sampling_steps(job) == 4:
        preset = h3_fast_preset(job)
        graph["16"] = {"class_type": "LoraLoaderModelOnly", "inputs": {
            "model": ["1", 0], "strength_model": 1.0,
            "lora_name": preset['lora']}}
        graph['17'] = {'class_type':'MiniMaxH3SigmaShift','inputs':{
            'model':['16',0],'shift_video':preset['shift_video'],'shift_audio':preset['shift_audio']}}
        graph['8']['inputs']['sampler_name'] = 'euler'
        for key in ("7", "9"):
            graph[key]["inputs"]["model"] = ["17", 0]
    graph["14"]["inputs"]["filename_prefix"] = "fumiao/fm-" + str(job["id"])
    return graph


def verify_keyframes(job,inputs,report,folder):
    targets=h3_keyframe_indices(job);checks={}
    for role,index in targets.items():
        frame=Path(report['first_frame'])
        if role=='last':
            import av
            frame=folder/'last-frame.png'
            with av.open(report['path']) as media:
                for number,picture in enumerate(media.decode(video=0),1):
                    if number==report['frames']:
                        picture.to_image().save(frame);break
                else:raise VideoQualityError('无法检查尾帧，结果未发布')
        checks[role]=check_first_frame(inputs/f'{index}.png',frame)
    if h3_input_metadata(job):
        report['h3_input_fingerprint']=h3_input_fingerprint(job)
        report['keyframe_checks']={'version':1,**checks}
    elif 'first' in checks:report['quality_check']=checks['first']


def run(folder):
    job = json.loads((folder / "job.json").read_text())
    requested_steps=sampling_steps(job)
    saved_graph=folder/'api.json'
    if h3_input_metadata(job) and saved_graph.exists() and json.loads(saved_graph.read_text())!=build_graph(job,folder.name):
        raise RuntimeError('已有任务记录与当前输入模式不一致，请核对任务')
    if saved_graph.exists() and json.loads(saved_graph.read_text()).get('9',{}).get('inputs',{}).get('steps')!=requested_steps:
        raise RuntimeError('已有生成记录的采样步数与当前任务不一致')
    expected_fast=build_graph(job,folder.name) if requested_steps==4 else None
    if saved_graph.exists() and expected_fast:
        existing=json.loads(saved_graph.read_text())
        if any(existing.get(k)!=expected_fast[k] for k in ('7','8','9','16','17')):
            raise RuntimeError('已有快速模式记录与当前工作流不一致，请重新提交')
    url = h3.server()
    dest = ENGINE / "state/outputs"
    inputs = ENGINE / "state/inputs/fumiao" / folder.name
    for index,ref in enumerate(h3_reference_files(job)):
        if ref['kind']=='image':normalize_reference(inputs / f"{index}.png")
    expected = {
        "width": job["width"],
        "height": job["height"],
        "length": {5: 124, 10: 243, 15: 362}[job["seconds"]],
    }
    # Recover an already finished local MP4 before attempting a new sample.
    for path in sorted((dest / "fumiao").glob(f"fm-{job['id']}_*.mp4"), reverse=True):
        if not saved_graph.exists():raise RuntimeError('缺少生成参数记录，无法恢复成片')
        try:
            report = h3.verify(path, expected, folder / "first.png")
            verify_keyframes(job,inputs,report,folder)
        except Exception:
            continue
        report['sampling_steps']=requested_steps
        report['fast_mode']=requested_steps==4
        h3.save(folder / "verified.json", report)
        return
    graph = build_graph(job, folder.name)
    h3.save(folder / "api.json", graph)
    listener = SamplerProgress(url, "fumiao-" + folder.name, folder, sampling_steps(job))
    listener.start()
    try:
        if not (folder / "submission.json").exists():
            # Recover an acknowledgement lost between enqueue and writing the ticket.
            client = "fumiao-" + folder.name
            history = requests.get(
                url + "/history", params={"max_items": 128}, timeout=30
            ).json()
            queue = requests.get(url + "/queue", timeout=20).json()
            entries = (
                [x.get("prompt", []) for x in history.values()]
                + queue["queue_running"]
                + queue["queue_pending"]
            )
            prompt_id = next(
                (
                    x[1]
                    for x in entries
                    if len(x) > 3 and (x[3] or {}).get("client_id") == client
                ),
                None,
            )
            if not prompt_id:
                resp = requests.post(
                    url + "/prompt", json={"prompt": graph, "client_id": client}, timeout=90
                )
                resp.raise_for_status()
                prompt_id = resp.json()["prompt_id"]
            h3.save(
                folder / "submission.json",
                {"prompt_id": prompt_id, "submitted_at": time.time()},
            )
        h3.finish(url, folder, 8 * 3600)
    finally:
        listener.close()
    report = json.loads((folder / "validation.json").read_text())
    history=json.loads((folder/'history.json').read_text())
    executed=history.get('prompt') or []
    actual_steps=executed[2].get('9',{}).get('inputs',{}).get('steps') if len(executed)>2 and isinstance(executed[2],dict) else None
    if actual_steps!=requested_steps:raise RuntimeError('实际采样步数与任务不一致')
    if expected_fast and any(executed[2].get(k)!=expected_fast[k] for k in ('7','8','9','16','17')):
        raise RuntimeError('实际快速模式工作流与任务不一致')
    report['sampling_steps']=actual_steps
    report['fast_mode']=requested_steps==4
    verify_keyframes(job,inputs,report,folder)
    h3.save(folder / "validation.json", report)
    (folder / "validation.json").replace(folder / "verified.json")


if __name__ == "__main__":
    folder = Path(sys.argv[1]).resolve()
    (folder / "failure.json").unlink(missing_ok=True)
    try:
        run(folder)
    except VideoQualityError:
        h3.save(folder / "failure.json", {"code": "invalid_video"})
        raise
