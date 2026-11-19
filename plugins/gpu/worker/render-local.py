#!/usr/bin/env python3
"""Bridge to a pre-provisioned Pure H3/Breeze runtime; no downloads on import."""
import hashlib,json,os,secrets,shutil,subprocess,sys
from pathlib import Path

def stage_references(folder, runtime, job):
    inputs=runtime/'engine/state/inputs/fumiao'/folder.name
    inputs.mkdir(parents=True,exist_ok=True,mode=0o700)
    native=job.get('h3_inputs') or {}
    if native:
        files=native.get('files',[])
        if native.get('version')!=1 or [f.get('id') for f in files]!=job['refs']:
            raise ValueError('H3 reference manifest differs from the job')
    else:files=[{'id':key,'kind':'image'} for key in job['refs']]
    for index,ref in enumerate(files):
        kind=ref.get('kind');source=folder/f'input-{index}'
        if kind=='image':
            from PIL import Image
            with Image.open(source) as image:image.convert('RGB').save(inputs/f'{index}.png')
        elif kind in ('video','audio'):
            suffix='mp4' if kind=='video' else 'wav'
            shutil.copyfile(source,inputs/f'{index}.{suffix}')
        else:raise ValueError('Unknown H3 reference type')
    return inputs

def main():
    folder=Path(sys.argv[1]).resolve();request=json.loads((folder/'request.json').read_text())
    runtime=Path(os.environ['FUMIAO_GPU_RUNTIME']).resolve();sys.path.insert(0,str(runtime));sys.path.insert(1,str(runtime.parent))
    params=request['params'];job={**params,'id':request['id'],'prompt':request['prompt'],'model':request['model'],'refs':request['references'],'seed':params.get('seed',secrets.randbelow(2**32))}
    if request['model']=='MiniMax H3':
        ratios={'16:9':(864,480,1344,768),'9:16':(480,864,768,1344),'1:1':(480,480,768,768),'4:3':(640,480,1024,768),'3:4':(480,640,768,1024),'21:9':(1120,480,1568,672)}
        dims=ratios[params.get('ratio','16:9')];job.update(width=dims[2 if params.get('quality',480)==768 else 0],height=dims[3 if params.get('quality',480)==768 else 1],quality=params.get('quality',480),seconds=params.get('seconds',5),sampling_steps=params.get('sampling_steps',20))
        stage_references(folder,runtime,job)
        (folder/'job.json').write_text(json.dumps(job))
        subprocess.run([os.getenv('H3_PYTHON',sys.executable),str(runtime/'render.py'),str(folder)],check=True,cwd=runtime)
        report=json.loads((folder/'verified.json').read_text())
        if job.get('h3_inputs'):
            expected=hashlib.sha256(json.dumps(job['h3_inputs'],sort_keys=True,separators=(',',':')).encode()).hexdigest()
            if report.get('h3_input_fingerprint')!=expected:raise ValueError('Renderer did not verify the frozen H3 input roles')
        target=folder/'output.mp4';shutil.copyfile(report['path'],target)
    elif request['model']=='breeze-tts-2':
        import breeze_adapter
        job['audio_settings']={'instruction':params.get('instruction','自然、清晰地朗读')}
        report=breeze_adapter.render(job,folder,device=int(os.getenv('GPU_DEVICE','0')));target=Path(report['path'])
    else:raise ValueError('Unsupported model')
    fields=('h3_input_fingerprint','sampling_steps','fast_mode','peak_vram_bytes','peak_allocated_vram_bytes','prepare_s','generate_s','finalize_s','cold','recovered')
    (folder/'result.json').write_text(json.dumps({'path':str(target),'report':{k:report[k] for k in fields if k in report}}))
if __name__=='__main__':main()
