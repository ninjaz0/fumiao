"""FIFO wait estimates under mixed hardware, model changes and incomplete telemetry."""
import itertools,json,os,sys,tempfile,time
from pathlib import Path
sandbox=tempfile.TemporaryDirectory()
os.environ.update(FUMIAO_DATA=sandbox.name,FUMIAO_SITE='http://testserver')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import core,timing
stamp=10000.

def node(i,**extra):
    return dict(id=i,hardware=f'gpu-{i}',workflow=timing.WORKFLOW,runtime_id='boot',lastseen=stamp,stage='ready',control='active')|extra

def job(i,**extra):
    return dict(id=i,node=None,status='queued',kind='video',model='MiniMax H3',refs=[],width=864,height=480,seconds=5,quality=480)|extra

def exact_run(seconds,**extra):
    return dict(started=stamp-100,phase='generating',predicted=json.dumps(dict(source='history',low=100+seconds,median=100+seconds,high=100+seconds)),progress='[]',step=0,steps=20)|extra

class Fixed:
    def __init__(self, costs):self.costs=costs;self.calls=[]
    def estimate(self,f,node_id=None):
        self.calls.append((node_id,f['video_mode'],f['cold']))
        value=self.costs.get((node_id,f['seconds']),self.costs.get(node_id))
        if value is None:return dict(source='none',samples=0)
        return dict(low=value,median=value,high=value,source='history',samples=8)

with core.db(True) as con:
    # One worker: every predecessor's own duration advances the wait, including mixed lengths.
    active=job(1,status='running',node=1)
    pending=[job(2),job(3,seconds=10),job(4)]
    p=timing.queue_estimates(con,[active]+pending,[node(1,stage='busy')],{1:exact_run(30)},Fixed({(1,5):80,(1,10):120}),stamp)
    assert [p[i]['median'] for i in (2,3,4)]==[30,110,230],p
    assert [p[i]['high'] for i in (2,3,4)]==[35,120,245],p
    assert p[4]['finish']['high']==325
    # Future jobs use the previous task's model state, not the current database state.
    engine=Fixed({1:100})
    active=job(1,status='running',node=1,refs=['image'])
    row=exact_run(30,features=json.dumps(timing.features(active,con,node(1))))
    timing.queue_estimates(con,[active,job(2),job(3),job(4,refs=['a','b'])],[node(1,stage='busy')],{1:row},engine,stamp)
    assert (1,'t2v',True) in engine.calls and (1,'t2v',False) in engine.calls and (1,'r2v',True) in engine.calls
    # Each instance is one actual execution slot; an 8-card machine is not assumed 8-way concurrent.
    n=node(1,profile=json.dumps({'gpu_name':'Test GPU','used_gpus':1,'available_gpus':8}))
    p=timing.queue_estimates(con,[job(i) for i in range(1,4)],[n],{},Fixed({1:100}),stamp)
    assert [p[i]['median'] for i in (1,2,3)]==[0,100,200]
    # Distinct per-worker rates: fast GPU gets additional FIFO work while the slow GPU stays busy.
    jobs=[job(i) for i in range(1,9)]
    p=timing.queue_estimates(con,jobs,[node(1),node(2)],{},Fixed({1:100,2:400}),stamp)
    assert [p[i]['median'] for i in range(1,9)]==[0,0,100,200,300,400,400,500],p
    assert p[1]['node_ids']==[1,2]
    # An uncalibrated instance is kept in the state space; no invented processing speed.
    p=timing.queue_estimates(con,[job(i) for i in range(1,5)],[node(1)],{},Fixed({}),stamp)
    assert p[1]['high']==5 and all(p[i]['reason']=='observing' for i in (2,3,4))
    p=timing.queue_estimates(con,[job(i) for i in range(1,5)],[node(1),node(2)],{},Fixed({1:100}),stamp)
    assert p[3]['high'] is not None and p[3]['high']>=100
    # Offline, paused and draining instances cannot take future jobs.
    inactive=[node(1,lastseen=stamp-76),node(2,control='paused'),node(3,control='draining')]
    p=timing.queue_estimates(con,[job(1)],inactive,{},Fixed({1:1,2:1,3:1}),stamp)
    assert p[1]['reason']=='waiting_gpu'
    # Finishing occupies the worker too, even when the run had no historical forecast.
    finishing=exact_run(30,predicted='{}',phase='finalizing',finalizing=stamp-5,step=20)
    eta=timing.remaining(finishing,stamp);assert eta['source']=='finishing' and eta['median']>0
    p=timing.queue_estimates(con,[job(1,status='running',node=1),job(2)],[node(1,stage='busy')],{1:finishing},Fixed({1:100}),stamp)
    assert p[2]['median']==eta['median']
    overdue=exact_run(30,predicted=json.dumps({'low':1,'median':1,'high':1,'source':'history'}))
    p=timing.queue_estimates(con,[job(1,status='running',node=1),job(2)],[node(1,stage='busy')],{1:overdue},Fixed({1:100}),stamp)
    assert p[2]['reason']=='observing' and p[2]['high'] is None
    # First task of a workload: sampling progress can provisionally bound later same-spec tasks.
    active=job(1,status='running',node=1)
    f=timing.features(active,con,node(1));f['cold']=True
    running=exact_run(30,predicted='{}',features=json.dumps(f),node=1,status='running',valid=1,
                      progress=json.dumps([[1,stamp-60],[2,stamp-50],[3,stamp-40]]),step=3)
    p=timing.queue_estimates(con,[active,job(2),job(3)],[node(1,stage='busy')],{1:running},Fixed({}),stamp)
    assert p[2]['duration']['source']=='live_progress' and p[3]['high']>p[2]['high']
    different=timing.features(job(4),con,node(2))
    assert timing.planning_prediction(Fixed({}),different,2,{1:running},stamp)['source']=='none'
    # Image requests have their own serialized API slot, not GPU capacity.
    image=job(1,kind='image',model='gpt-image-2.6-sunburst',status='running')
    qimage=job(2,kind='image',model='gpt-image-2.6-sunburst')
    p=timing.queue_estimates(con,[image,qimage,job(3)],[node(1)],{1:exact_run(40)},Fixed({None:60,1:100}),stamp)
    assert p[2]['median']==40 and p[3]['median']==0
    con.execute("INSERT INTO settings VALUES('openai_images',?)",(json.dumps({'enabled':False}),))
    assert timing.queue_estimates(con,[qimage],[node(1)],{},Fixed({None:60}),stamp)[2]['reason']=='service_paused'
    # Mixed durations and two simultaneous idle claimants: every actual tie order is inside bounds.
    jobs=[job(i,seconds=5 if i%2 else 10) for i in range(1,9)]
    costs={(1,5):80,(1,10):250,(2,5):180,(2,10):90}
    p=timing.queue_estimates(con,jobs,[node(1),node(2)],{},Fixed(costs),stamp)
    paths=[([0,0],[])]
    for j in jobs:
        next_paths=[]
        for available,history in paths:
            start=min(available)
            for idx,value in enumerate(available):
                if value!=start:continue
                changed=available.copy();changed[idx]+=costs[(idx+1,j['seconds'])]
                next_paths.append((changed,history+[(j['id'],start)]))
        paths=next_paths
    for _,history in paths:
        for jid,start in history:assert p[jid]['low']<=start<=p[jid]['high'],(jid,start,p[jid])
    # Cancellation/removal changes subsequent waits on the next state read.
    before=timing.queue_estimates(con,[job(1),job(2),job(3)],[node(1)],{},Fixed({1:100}),stamp)
    after=timing.queue_estimates(con,[job(1,status='cancelled'),job(2),job(3)],[node(1)],{},Fixed({1:100}),stamp)
    assert before[3]['median']==200 and after[3]['median']==100
    start=time.perf_counter()
    large=timing.queue_estimates(con,[job(i) for i in range(1,101)],[node(i) for i in range(1,9)],{},Fixed({i:100*i for i in range(1,9)}),stamp)
    assert len(large)==100 and all(v['high'] is not None for v in large.values())
    print('100 jobs / 8 heterogeneous instances:',round(time.perf_counter()-start,3),'seconds')
print('PASS FIFO accumulation, mode transitions, actual GPU slots, heterogeneous speeds, unknown/overdue workers, live progress fallback, finalization, independent API slot, claim-order uncertainty and cancellation')
