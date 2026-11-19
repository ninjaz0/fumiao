"""Original Pydantic canvas shape/serialization and real FastAPI error oracle."""
import copy,json,os,sys
from pathlib import Path
from fastapi.testclient import TestClient
out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
os.environ.update(FUMIAO_DATA=str(out/'runtime'),FUMIAO_SITE='http://localhost:3000',FUMIAO_MUSE_AUTOSTART='0',FUMIAO_FLOW_AUTOSTART='0',FUMIAO_PAYMENT_AUTOSTART='0')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'legacy/pure'))
from server import app
from canvas_api import Save,NewProject,CandidateRun,Run,Revision
client=TestClient(app,raise_server_exceptions=False)
node=dict(id='node',type='video',x=0,y=0)
base=dict(expected_revision=1,title='画布',document={'nodes':[node],'edges':[]})
cases=[]
def case(name,value,kind='save'):
    models={'save':Save,'new':NewProject,'candidate':CandidateRun,'run':Run,'revision':Revision}
    paths={'save':('PUT','/api/canvases/'+'a'*32+'/document'),'new':('POST','/api/canvases'),'candidate':('POST','/api/canvases/'+'a'*32+'/nodes/node/candidates'),'run':('POST','/api/canvases/'+'a'*32+'/nodes/node/runs'),'revision':('POST','/api/canvases/'+'a'*32+'/shots/download')}
    try:expected=models[kind].model_validate(value).model_dump(mode='json');status=200
    except Exception:
        method,path=paths[kind];r=client.request(method,path,json=value)
        status=r.status_code
        assert status==422,(name,status,r.text)
        expected=r.json()
    cases.append(dict(name=name,kind=kind,value=value,status=status,expected=expected))
def setpath(value,path,replacement):
    x=value
    for key in path[:-1]:
        if key not in x if isinstance(x,dict) else False:x[key]={}
        x=x[key]
    x[path[-1]]=replacement
case('defaults',base);case('empty-document',dict(expected_revision=1,title='画布',document={}))
for kind,value in [('new',{}),('revision',{'expected_revision':1}),('run',{'expected_revision':1,'uid':'00000000-0000-0000-0000-000000000001'}),('candidate',{'expected_revision':1,'uid':'00000000-0000-0000-0000-000000000001'})]:case(kind+'-defaults',value,kind)
for key,values in {
 'x':[True,False,'1.25','-0','+1','1e-5','1_000','1__0','0x10','  1.5  ','\u00851.5\u0085','\ufeff1.5','١٢','１２','NaN','Infinity','-inf','1e1000','',None,{},[],100000,-100000,100000.1,-100000.1],
 'y':['.5','1.','1.e2','1_2.3_4','+nan','\u001c1',0.00000001],
 'width':[159,160,1600,1600.1,'320',None], 'height':[99,100,1600,1601,'240'],
 'id':['', 'a'*80,'a'*81,'node\n','node\r','node\u2028','node\u2029','node-01_',1,None,'😀'],
 'type':['text','image','video','sticky','unknown',1,None],
 'title':['','😀'*80,'😀'*81,'保留\u0000',1,None],
 'text':['','x'*12000,'x'*12001,1,None], 'prompt':['x'*12000,'x'*12001,[],None],
 'color':['none','mint','blue','purple','orange','yellow','red',1,None],
 'media_id':[None,'a'*32,'a'*32+'\n','A'*32,'',1],
 'active_job':[None,0,1,-1,1.5,'1','1_000',True,{},[]],
 'narration_job':[None,0,1,'2.0',False], 'narration_pending':[None,1,0],
 'narration_text':['😀'*300,'😀'*301,1,None], 'narration_instruction':['x'*300,'x'*301,None],
 'use_media':[True,False,0,1,2,'on','off','yes','NO','false','0',' true ',None,{}],
 'params':[None,[],{},False],
}.items():
    for i,v in enumerate(values):
        value=copy.deepcopy(base);setpath(value,['document','nodes',0,key],v);case(key+'-'+str(i),value)
params={
 'h3':[None,{},[],{'mode':'reference'},{'mode':'frames','first_frame':'a'*32},{'mode':'frames','last_frame':'a'*32+'\n'},{'mode':'frames','unknown':1},{'mode':'reference','video_audio':['a'*32]*4}],
 'h3_refs':[[],['a'*32]*12,['a'*32]*13,[1],None],
 'model':['','x'*180,'x'*181,None,1], 'flow_source_job':[None,0,1,'2',False],
 'ratio':['16:9','9:16','1:1','4:3','3:4','21:9','2:1',None], 'quality':[480,768,480.0,'480',True,1],
 'seconds':[0,5,15,16,-1,'5','5.0',True,5.5,None], 'seed':[None,0,-1,2**53-1,2**53,'12',True],
 'sampling_steps':[16,20,32,50,4,'20',None], 'fast_mode':[True,False,'on','off',1,0,None],
 'resolution':['1K','2K','4K','8K',None], 'image_quality':['low','medium','high','standard',None],
}
for key,values in params.items():
    for i,v in enumerate(values):
        value=copy.deepcopy(base);value['document']['nodes'][0]['params']={key:v};case('params-'+key+'-'+str(i),value)
for key,values in {
 'schemaVersion':[1,True,1.0,'1',2,None], 'nodes':[None,{},[None],[{}],[node]*200,[node]*201,[None]*201],
 'edges':[None,{},[None],[{}],[{'id':'e','source':'node','target':'other'}],[{'id':'e\n','source':'node','target':'other'}],[{'id':'e','source':'a'*81,'target':''}]],
 'shots':[None,[],['node'],['x']*200,['x']*201,[1],[None],{}],
}.items():
    for i,v in enumerate(values):
        value=copy.deepcopy(base);value['document'][key]=v;case('document-'+key+'-'+str(i),value)
for v in [[],[{'id':'a'*32,'revision':1}],[{'id':'a'*32,'revision':'2'}],[{'id':'a'*32,'revision':0}],[{'id':'a'*32,'revision':1,'extra':1}],[{'id':'a'*32,'revision':1}]*10,[None]*10,None]:
    value=copy.deepcopy(base);value['document']['nodes'][0]['asset_packs']=v;case('packs-'+str(len(cases)),value)
for path in [[],['document'],['document','nodes',0],['document','nodes',0,'params']]:
    for key in ['extra','constructor','toString','__proto__']:
        value=copy.deepcopy(base);setpath(value,path+[key],{'bad':True});case('extra-'+str(path)+'-'+key,value)
for key in ['expected_revision','title','document']:
    value=copy.deepcopy(base);del value[key];case('missing-'+key,value)
for kind in ['new','candidate','run','revision']:
    seed={} if kind=='new' else {'expected_revision':1,'uid':'00000000-0000-0000-0000-000000000001'} if kind in ['run','candidate'] else {'expected_revision':1}
    for key,values in ({'title':['',None,'😀'*81],'template':[None,'event','product','portrait','bad'],'ratio':['16:9','9:16','1:1']} if kind=='new' else {'expected_revision':[0,'2',True,1.5],'price_revision':[None,0,1],'count':[1,2,True,False,3,'1']}).items():
        for i,v in enumerate(values):value=copy.deepcopy(seed);value[key]=v;case(kind+'-'+key+'-'+str(i),value,kind)
client.close();(out/'manifest.json').write_text(json.dumps(cases,ensure_ascii=True))
