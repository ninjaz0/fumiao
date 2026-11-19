"""Pinned image queue oracle; private SQLite, synthetic images and fake urllib only."""
import base64, io, json, os, struct, sys, urllib.error, urllib.request, uuid, zlib
from pathlib import Path
from PIL import Image
out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
os.environ['FUMIAO_DATA'] = str(out / 'runtime')
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'legacy/pure'))
import core, credits, timing, image_api as images
core.init_db(); images.api_key = lambda: 'sk-local-fixture'
with core.db(True) as con:
    policy = json.loads(con.execute("SELECT value FROM settings WHERE key='model_policy'").fetchone()[0])
    policy['enabled'][images.DEFAULT_MODEL] = True
    con.execute("UPDATE settings SET value=? WHERE key='model_policy'", (json.dumps(policy),))
current = {}; requests = []; cases = []
class Response(io.BytesIO):
    def __init__(self, raw):
        super().__init__(raw); self.headers = {'x-request-id': current.get('requestId', '')}
def raw_case(c):
    if 'file' in c: return json.dumps({'data':[{'b64_json':base64.b64encode((out/c['file']).read_bytes()).decode()}], 'usage': c.get('usage',{})}).encode()
    if 'repeat' in c: return b'x' * c['repeat']
    if 'hex' in c: return bytes.fromhex(c['hex'])
    return c.get('raw','{}').encode()
def urlopen(req, timeout):
    content_type = req.headers.get('Content-type',''); raw = (req.data or b'').decode()
    boundary = content_type.split('boundary=')[1] if 'boundary=' in content_type else None
    requests.append(dict(path=req.selector,method=req.get_method(),authorization=req.headers.get('Authorization'),idempotency=req.headers.get('Idempotency-key'),contentType=content_type.replace(boundary,'fixture') if boundary else content_type,body=raw.replace(boundary,'fixture') if boundary else json.loads(raw)))
    if current.get('disconnect'): raise OSError('private-sentinel')
    payload = raw_case(current)
    if current.get('status',200) >= 300: raise urllib.error.HTTPError(req.full_url,current['status'],'fixture',{},io.BytesIO(payload))
    return Response(payload)
urllib.request.urlopen = urlopen
prompt = '图 <Picture 1> / <Picture ١> / <Picture ２> 多行\n生成'
def scenario(name, wire, refs=None, missing=False, read_failure=False):
    global current
    current=wire; requests.clear()
    with core.db(True) as con:
        uid=con.execute("INSERT INTO users(name,salt,pw,role,nickname,avatar) VALUES(?,'fixture','fixture','admin','Fixture','')",(uuid.uuid4().hex,)).lastrowid
        wid=con.execute('SELECT default_workspace FROM users WHERE id=?',(uid,)).fetchone()[0]
        con.execute('UPDATE credit_accounts SET balance=10000 WHERE workspace=?',(wid,));con.execute('UPDATE credit_prices SET amount=2')
        references=['missing'] if missing else []
        for mime in refs or []:
            key=uuid.uuid4().hex;path=core.stage_dir/'reference';path.write_bytes(b'private-reference')
            if not read_failure: core.store.put(path,key)
            con.execute("INSERT INTO media(id,kind,size,mime,w,h,owner,workspace) VALUES(?,'ref',17,?,8,6,?,?)",(key,mime,uid,wid));references.append(key)
        jid=con.execute("""INSERT INTO jobs(uid,owner,prompt,refs,ratio,quality,seconds,seed,width,height,status,created,updated,kind,model,image_quality,workspace)
          VALUES(?,?,?,?,?,1024,0,0,1536,864,'queued',?,?,'image',?,'medium',?)""",(uuid.uuid4().hex,uid,prompt,json.dumps(references),'16:9',core.now(),core.now(),images.DEFAULT_MODEL,wid)).lastrowid
        credits.reserve(con,jid)
    try: images.run_one()
    except TypeError:
        if not missing: raise
    with core.db() as con:
        j=dict(con.execute('SELECT * FROM jobs WHERE id=?',(jid,)).fetchone());r=timing.current_run(con,jid);wallet=credits.wallet(con,wid)
        media=dict(con.execute('SELECT * FROM media WHERE id=?',(j['result'],)).fetchone()) if j['result'] else None
        snapshot=dict(state=j['status'],note=j['note'],attempts=j['attempts'],held=wallet['reserved'],balance=wallet['balance'],runStatus=r['status'] if r else None,phase=r['phase'] if r else None,
            output=dict(mime=media['mime'],width=media['w'],height=media['h'],size=media['size']) if media else None,
            providerResponse=dict(version=1,requestId=j['provider_request'],usageJson=j['usage_json']) if media else None)
    cases.append(dict(name=name,wire=wire,refs=refs or [],missing=missing,readFailure=read_failure,prompt=prompt,safety=images.hashed(images.SITE+':'+str(uid)),expected=snapshot,requests=list(requests)))
    if missing:
        with core.db(True) as con:con.execute("UPDATE jobs SET status='cancelled' WHERE id=?",(jid,))

im=Image.new('RGB',(37,29),'blue')
files=[]
def save(name,data): (out/name).write_bytes(data);files.append(name)
for fmt,suffix in [('PNG','png'),('JPEG','jpg'),('WEBP','webp')]:
    for orientation in range(1,9):
        name=f'orientation-{orientation}.{suffix}';exif=Image.Exif();exif[274]=orientation;im.save(out/name,fmt,exif=exif);files.append(name)
for fmt,suffix in [('GIF','gif'),('TIFF','tiff'),('BMP','bmp'),('ICO','ico'),('PPM','ppm'),('PCX','pcx'),('TGA','tga')]:
    name='unsupported.'+suffix;im.save(out/name,fmt);files.append(name)
for mode in ['RGBA','L','LA','P','1','I;16']:
    name='mode-'+mode.replace(';','')+'.png';im.convert(mode).save(out/name);files.append(name)
for default in [False,True]:
    name='animated-'+str(default)+'.png';im.save(out/name,'PNG',save_all=True,default_image=default,append_images=[Image.new('RGB',im.size,'red')],duration=100,loop=0);files.append(name)
raw=(out/'orientation-1.png').read_bytes()
for name,data in [('empty.bin',b''),('random.bin',b'no image'),('no-iend.png',raw[:-12]),('iend-header-only.png',raw[:-4]),('truncated.png',raw[:60]),('trailing.png',raw+b'trailing'),('svg.xml',b'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="48"/>')]:save(name,data)
for name,chunk in [('header-crc.png',b'IHDR'),('idat-crc.png',b'IDAT'),('iend-crc.png',b'IEND')]:
    data=bytearray(raw);pos=data.index(chunk);length=struct.unpack('>I',data[pos-4:pos])[0];data[pos+4+length]^=1;save(name,data)
def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data))
for valid in [False,True]:
    added=bytearray(chunk(b'tEXt',b'fixture\x00hello'))
    if not valid:added[-1]^=1
    save('post-idat-'+str(valid)+'.png',raw[:-12]+added+raw[-12:])
for width,name in [(6400,'pixel-limit.png'),(6401,'pixel-over.png')]:
    big=Image.new('RGB',(width,5000),'blue');big.save(out/name);big.close();files.append(name)
data=bytearray(raw);data[16:24]=struct.pack('>II',20000,20000);data[29:33]=struct.pack('>I',zlib.crc32(data[12:29]));save('pixel-bomb.png',data)
save('oversize.bin',b'x'*(32*1024**2+1))
for name in files:scenario(name,dict(file=name))
for usage in [None,[],[1,'x'],True,0,'text',{'input_tokens':17,'details':{'x':0.25}}]:scenario('usage-'+str(len(cases)),dict(file='orientation-1.png',usage=usage,requestId='fixture-request'))
for value in [None,[],True,0,'x',{}, {'data':None},{'data':{}},{'data':''},{'data':'😀'},{'data':{'0':{'b64_json':base64.b64encode(raw).decode()}}},{'data':0},{'data':[None]},{'data':[1]},{'data':[{}]},{'data':[{'url':'https://example.com/ignored'}]},{'data':[{'b64_json':3}]},{'data':[{},{}]}]:scenario('result-'+str(len(cases)),dict(raw=json.dumps(value)))
for value in ['', '=', '====','AAAA=','AAAA====','AA==','AB==','AAA=','AAB=','AA===','AAA==','AAAAAA==','AA==AA','AAA','AA\n==','AA==\n','é','-AAA','_AAA']:
    scenario('base64-'+str(len(cases)),dict(raw=json.dumps({'data':[{'b64_json':value}]})))
for status in [302,400,401,403,404,408,413,422,429,500,502,503]:
    for error in [{}, {'code':'insufficient_quota','message':'safety verify'}, {'message':'verify SAFETY'},{'code':'content_policy_violation'},{'message':'SAFETY'}, {'message':'private-sentinel'}, [],None]:
        scenario('error-'+str(len(cases)),dict(status=status,raw=json.dumps({'error':error})))
for raw_json in ['invalid','null','[]','{"error":3}','{"error":{"message":["verify"]}}']:
    scenario('error-body-'+str(len(cases)),dict(status=500,raw=raw_json))
for raw_json in ['invalid', '\ufeff{}','{"data":[],"usage":NaN}']:
    scenario('json-'+str(len(cases)),dict(raw=raw_json))
for encoding in ['utf-8-sig','utf-16','utf-16-be','utf-32','utf-32-be']:
    scenario('encoding-'+encoding,dict(hex=json.dumps({'data':[]}).encode(encoding).hex()))
scenario('response-limit',dict(repeat=64*1024**2+1));scenario('disconnect',dict(disconnect=True))
scenario('multipart',dict(file='orientation-1.png'),refs=['image/jpeg','image/png','image/webp'])
scenario('unsupported-ref',dict(file='orientation-1.png'),refs=['image/gif'])
scenario('reference-read-failure',dict(file='orientation-1.png'),refs=['image/png'],read_failure=True)
scenario('missing-reference',dict(file='orientation-1.png'),missing=True)
(out/'manifest.json').write_text(json.dumps({'cases':cases,'imageFiles':len(files)},ensure_ascii=False))
print(json.dumps({'scenarios':len(cases),'imageFiles':len(files)}))
