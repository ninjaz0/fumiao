"""Real FFmpeg preview/export with narration, preserved order, captions and permissions.
Uses tiny synthetic media; does not claim GPU model inference coverage.
"""
import json,os,sys,tempfile,uuid,subprocess
from pathlib import Path
sandbox=tempfile.TemporaryDirectory()
os.environ.update(FUMIAO_DATA=sandbox.name,FUMIAO_SITE='http://testserver',FUMIAO_MUSE_AUTOSTART='0')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
import core,storyboard_export as export
from server import app
from credit_fixtures import fund_test_accounts
fund_test_accounts()
def okay(r):
    assert r.is_success,(r.status_code,r.text[:500]);return r.json()
def account(name):
    code=core.token()
    with core.db(True) as con:con.execute("INSERT INTO registration_codes(code,role,expires) VALUES(?,'member',?)",(code,core.now()+60))
    c=TestClient(app);okay(c.post('/api/register',json={'name':name,'nickname':name,'password':'storyboard-export-test-2026','code':code}));return c
c=account('合成甲');other=account('合成乙');p=okay(c.post('/api/canvases',json={'template':'event'}));url=f"/api/canvases/{p['id']}"
doc=p['document'];doc['shots']=['shot-2','shot-1'];nodes={n['id']:n for n in doc['nodes']}
def fixture(color):
    path=Path(sandbox.name)/(color+'.mp4')
    subprocess.run(['ffmpeg','-v','error','-y','-f','lavfi','-i',f'color=c={color}:s=320x180:r=24:d=0.5','-c:v','libx264','-pix_fmt','yuv420p',str(path)],check=True)
    return path

def media(path,kind):
    key=uuid.uuid4().hex
    core.store.path(key).write_bytes(path.read_bytes())
    with core.db(True) as con:con.execute('INSERT INTO media(id,kind,size,mime,w,h,owner,workspace) VALUES(?,?,?,?,?,?,?,?)',
      (key,kind,path.stat().st_size,'video/mp4' if kind=='video' else 'audio/wav',320 if kind=='video' else 0,180 if kind=='video' else 0,p['owner'],p['workspace']))
    return key
nodes['shot-1']['media_id']=media(fixture('red'),'video');nodes['shot-1']['use_media']=True
nodes['shot-2']['media_id']=media(fixture('blue'),'video');nodes['shot-2']['use_media']=True
nodes['shot-2']['narration_text']='第一句。第二句。'
def save():
    p['revision']=okay(c.put(url+'/document',json={'expected_revision':p['revision'],'title':p['title'],'document':doc}))['revision']
save()
voicebody={'uid':str(uuid.uuid4()),'expected_revision':p['revision']}
jid=okay(c.post(url+'/nodes/shot-2/narration',json=voicebody))['id']
assert okay(c.post(url+'/nodes/shot-2/narration',json=voicebody))['id']==jid
assert other.post(url+'/nodes/shot-2/narration',json=voicebody).status_code==404
assert c.post(url+'/exports',json={'uid':str(uuid.uuid4()),'expected_revision':p['revision']}).status_code==409
voice=Path(sandbox.name)/'voice.wav'
subprocess.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','sine=frequency=440:sample_rate=24000:duration=1.25','-ac','1',str(voice)],check=True)
voicekey=media(voice,'audio')
bad=json.loads(json.dumps(doc));bad['nodes'][0]['media_id']=voicekey
assert c.put(url+'/document',json={'expected_revision':p['revision'],'title':p['title'],'document':bad}).status_code==400
with core.db(True) as con:con.execute("UPDATE jobs SET status='done',result=? WHERE id=?",(voicekey,jid))
nodes['shot-2']['narration_job']=jid;save()
clone=okay(c.post(url+'/duplicate',json={}))
assert next(n for n in clone['document']['nodes'] if n['id']=='shot-2')['narration_job']==jid
replacement=okay(c.post(url+'/nodes/shot-2/narration',json={'uid':str(uuid.uuid4()),'expected_revision':p['revision']}))['id']
nodes['shot-2']['narration_pending']=replacement;save()
assert nodes['shot-2']['narration_job']==jid
assert c.post(url+'/exports',json={'uid':str(uuid.uuid4()),'expected_revision':p['revision']}).status_code==409
with core.db(True) as con:con.execute("UPDATE jobs SET status='failed',note='test replacement failure' WHERE id=?",(replacement,))
request={'uid':str(uuid.uuid4()),'expected_revision':p['revision']}
r=okay(c.post(url+'/exports',json=request));assert okay(c.post(url+'/exports',json=request))['id']==r['id']
assert c.post(url+'/exports',json={**request,'uid':str(uuid.uuid4())}).status_code==409
# Document changes cannot alter the accepted ordered composition.
doc['shots'].reverse();save()
with core.db(True) as con:
    con.execute("UPDATE storyboard_exports SET state='running' WHERE id=?",(r['id'],))
    row=dict(con.execute('SELECT * FROM storyboard_exports WHERE id=?',(r['id'],)).fetchone())
export.process_export(row)
out=okay(c.get(url+'/exports'))['exports'][0];assert out['state']=='done',out
path=core.store.path(out['result']);info=export.probe(path)
assert abs(export.duration_unbounded(info)-1.75)<.1
assert any(s['codec_type']=='audio' and s['channels']==2 for s in info['streams'])
assert any(s['codec_type']=='subtitle' and s['codec_name']=='mov_text' for s in info['streams'])
# Blue then red: extract one pixel from each segment after full decoding.
def pixel(at):
    return subprocess.check_output(['ffmpeg','-v','error','-ss',str(at),'-i',str(path),'-vf','scale=1:1','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'])
a,b=pixel(.7),pixel(1.5);assert a[2]>a[0]+100 and b[0]>b[2]+100,(a,b)
srt=c.get('/api/storyboard-exports/'+out['id']+'/subtitles');assert srt.status_code==200 and '第一句。' in srt.text and '00:00:01,250' in srt.text
vtt=c.get('/api/storyboard-exports/'+out['id']+'/subtitles?format=vtt');assert vtt.text.startswith('WEBVTT') and '00:00:01.250' in vtt.text
assert other.get('/api/storyboard-exports/'+out['id']+'/subtitles').status_code==404
assert other.get('/media/'+out['result']).status_code==404
assert c.get('/media/'+out['result']+'?download=true').content==path.read_bytes()
with core.db() as con:
    assert con.execute('SELECT count(*) FROM credit_charges').fetchone()[0]==2
    assert [r[0] for r in con.execute('SELECT state FROM credit_charges ORDER BY job')]==['spent','refunded']
    assert con.execute('SELECT count(*) FROM storyboard_export_refs').fetchone()[0]==0
    result_job=con.execute('SELECT id FROM jobs WHERE result=?',(out['result'],)).fetchone()[0]
# Changed narration blocks another composition; existing output remains immutable.
nodes['shot-2']['narration_text']='改过但还没有重新生成的文字';save()
assert c.post(url+'/exports',json={'uid':str(uuid.uuid4()),'expected_revision':p['revision']}).status_code==409
# Deleting source canvas keeps the final video and captions; deleting the asset removes both.
okay(c.delete(url))
assert c.get('/api/storyboard-exports/'+out['id']+'/subtitles').status_code==200
assert c.get('/media/'+out['result']).status_code==200
okay(c.post('/api/assets/batch-delete',json={'keys':['job:'+str(result_job)]}))
assert c.get('/api/storyboard-exports/'+out['id']+'/subtitles').status_code==404
# ffprobe rounds 124/24 to 5.166667; it must not add a silent extra frame.
fractional=Path(sandbox.name)/'fractional.mp4'
subprocess.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','color=c=green:s=320x180:r=24:d=6','-frames:v','124','-c:v','libx264','-pix_fmt','yuv420p',str(fractional)],check=True)
key=media(fractional,'video');folder=Path(sandbox.name)/'fractional-render';folder.mkdir()
rendered,_,_,_=export.compose([{'video':key,'voice':None,'text':'','title':'Frame count','node':'n'}],folder)
assert int(next(s for s in export.probe(rendered)['streams'] if s['codec_type']=='video')['nb_frames'])==124
print('PASS actual H264/AAC composition, longer narration freeze-frame, stable order, exact preview/download bytes, SRT/VTT timing, credit reuse, workspace access and deletion')
