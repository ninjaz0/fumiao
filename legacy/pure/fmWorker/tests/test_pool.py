"""Real SQLite transactions and HTTP boundaries for public contribution settlement."""
import json
import os
import secrets
import sys
import tempfile
from pathlib import Path
import pytest

PLATFORM=Path(os.environ.get('FMWORKER_PLATFORM_SOURCE') or Path(__file__).resolve().parents[2])
if not (PLATFORM/'core.py').is_file():
    pytest.skip('平台结算集成检查需要 FMWORKER_PLATFORM_SOURCE 指向弗淼平台源码',allow_module_level=True)

os.environ['FUMIAO_DATA']=tempfile.mkdtemp(prefix='fmworker-pool-test-')
os.environ['FUMIAO_SITE']='http://testserver'
os.environ['FUMIAO_FLOW_AUTOSTART']='0'
os.environ['FUMIAO_MUSE_AUTOSTART']='0'
sys.path.insert(0,str(PLATFORM))
from fastapi.testclient import TestClient
import core,credits,worker_pool
from server import app


def user():
    name='u'+secrets.token_hex(5);session=secrets.token_urlsafe(32)
    with core.db(True) as con:
        uid=con.execute("INSERT INTO users(name,salt,pw,role,nickname) VALUES(?,'00','unused','member',?)",(name,name)).lastrowid
        con.execute('INSERT INTO sessions VALUES(?,?,?)',(core.hashed(session),uid,core.now()+3600))
        wid=con.execute("SELECT id FROM workspaces WHERE owner=? AND kind='personal'",(uid,)).fetchone()[0]
    client=TestClient(app);client.cookies.set('fm_session',session)
    return uid,wid,client


def fund(workspace,amount,source='recharge'):
    with core.db(True) as con:
        con.execute('UPDATE credit_accounts SET balance=balance+? WHERE workspace=?',(amount,workspace))
        balance=con.execute('SELECT balance FROM credit_accounts WHERE workspace=?',(workspace,)).fetchone()[0]
        con.execute('INSERT INTO credit_ledger(workspace,action,amount,balance,reserved,created) VALUES(?,?,?,?,0,?)',(workspace,source,amount,balance,core.now()))


def resource(client,kind='breeze'):
    secret=secrets.token_urlsafe(48)
    result=client.post('/api/fmworker/resources',json={'kind':kind,'name':'worker','secret':secret})
    assert result.status_code==200,result.text
    node=result.json()['id']
    assert client.put(f'/api/fmworker/resources/{node}',json={'enabled':True,'limits':{'daily_tasks':20,'monthly_tasks':300}}).status_code==200
    return node,{'Authorization':'Bearer '+secret}


def job(uid,wid,model='breeze-tts-2',price=1,meta=None,steps=20,quality=480):
    with core.db(True) as con:
        jid=con.execute("""INSERT INTO jobs(uid,owner,workspace,prompt,refs,ratio,quality,seconds,seed,width,height,status,created,updated,kind,model,audio_settings,h3_inputs,sampling_steps)
            VALUES(?,?,?,'test','[]','16:9',?,5,1,864,480,'queued',?,?,'audio',?,'{}',?,?)""",
            (secrets.token_hex(16),uid,wid,quality,core.now(),core.now(),model,json.dumps(meta or {}),steps)).lastrowid
        key=credits.price_key(con.execute('SELECT * FROM jobs WHERE id=?',(jid,)).fetchone())
        con.execute('UPDATE credit_prices SET amount=? WHERE key=?',(price,key))
        credits.reserve(con,jid)
        return jid


def claim(client,headers):
    assert client.post('/fmworker/heartbeat',headers=headers,json={'stage':'ready','capabilities':{'models':['breeze-tts-2']}}).status_code==200
    value=client.post('/fmworker/claim',headers=headers)
    assert value.status_code==200,value.text
    return value.json()['job']


def complete(jid):
    with core.db(True) as con:
        con.execute("UPDATE jobs SET status='done' WHERE id=?",(jid,))
        worker_pool.settle_reward(con,jid)


def test_rewards_accumulate_fraction_and_are_idempotent():
    uid,wid,customer=user();owner,dest,contributor=user();node,headers=resource(contributor)
    fund(wid,3)
    for _ in range(2):
        jid=job(uid,wid);assert claim(contributor,headers)['id']==jid
        complete(jid);complete(jid)
    with core.db() as con:
        assert credits.wallet(con,dest)['balance']==1
        assert con.execute('SELECT units FROM fm_reward_remainders WHERE workspace=?',(dest,)).fetchone()[0]==4000
        assert con.execute('SELECT count(*) FROM fm_rewards WHERE owner=?',(owner,)).fetchone()[0]==2
        assert con.execute('SELECT eligible FROM fm_funds WHERE workspace=?',(dest,)).fetchone()[0]==1
        assert credits.wallet(con,wid)['balance']==1


def test_gifts_and_own_work_do_not_create_rewards():
    uid,wid,client=user();_,headers=resource(client)
    fund(wid,4,'adjust')
    jid=job(uid,wid);assert claim(client,headers)['id']==jid;complete(jid)
    other,otherwid,otherclient=user();_,otherheaders=resource(otherclient)
    jid=job(uid,wid);assert claim(otherclient,otherheaders)['id']==jid;complete(jid)
    with core.db() as con:assert con.execute('SELECT count(*) FROM fm_rewards WHERE job=?',(jid,)).fetchone()[0]==0


def test_mixed_funding_gifts_first_and_failed_hold_released():
    uid,wid,client=user();fund(wid,2,'adjust');fund(wid,5)
    jid=job(uid,wid,price=4)
    with core.db(True) as con:
        assert con.execute('SELECT amount FROM fm_fund_holds WHERE job=?',(jid,)).fetchone()[0]==2
        con.execute("UPDATE jobs SET status='failed' WHERE id=?",(jid,))
        assert con.execute('SELECT eligible,held FROM fm_funds WHERE workspace=?',(wid,)).fetchone()[:]==(5,0)
        assert credits.wallet(con,wid)['balance']==7


def test_resource_ownership_pause_and_input_validation():
    uid,wid,client=user();_,_,other=user();node,headers=resource(client)
    assert other.put(f'/api/fmworker/resources/{node}',json={'enabled':True,'limits':{}}).status_code==404
    assert client.put(f'/api/fmworker/resources/{node}',json={'enabled':'invalid'}).status_code==422
    assert client.put(f'/api/fmworker/resources/{node}',json={'enabled':False,'limits':{}}).status_code==200
    fund(wid,2);jid=job(uid,wid)
    assert claim(client,headers) is None
    with core.db(True) as con:con.execute("UPDATE jobs SET status='cancelled' WHERE id=?",(jid,))
    assert client.delete(f'/api/fmworker/resources/{node}').status_code==200
    assert client.post('/fmworker/claim',headers=headers).status_code==403


def test_legacy_contribution_limits_do_not_restrict_admission():
    uid,wid,customer=user();_,_,client=user();node,headers=resource(client)
    client.put(f'/api/fmworker/resources/{node}',json={'enabled':True,'limits':{'daily_tasks':1}})
    fund(wid,3);jid=job(uid,wid);assert claim(client,headers)['id']==jid;complete(jid)
    with core.db(True) as con:
        con.execute('UPDATE fm_resources SET limits=? WHERE node=?',(json.dumps({'daily_tasks':0,'monthly_tasks':0,'daily_units':0,'monthly_units':0,'start':'23:00','end':'23:01'}),node))
    second=job(uid,wid);assert claim(client,headers)['id']==second;complete(second)


def test_usage_deduplicated_without_contribution_budget():
    _,_,client=user();node,headers=resource(client,'colab')
    client.put(f'/api/fmworker/resources/{node}',json={'enabled':True,'limits':{'daily_units':1}})
    for _ in range(2):
        result=client.post('/fmworker/usage',headers=headers,json={'uid':'meter-1','units':1})
        assert result.json()=={'ok':True}
    with core.db() as con:
        assert con.execute('SELECT sum(units) FROM fm_usage WHERE node=?',(node,)).fetchone()[0]==1
        assert worker_pool.resource(con,node)['enabled']


def test_h3_matrix_rejects_unsupported_reference_and_turbo():
    uid,wid,client=user();node,headers=resource(client,'colab')
    caps={'models':['MiniMax H3'],'h3':{'modes':['text','first_last'],'steps':[20],'quality':[480],'seconds':[5]}}
    result=client.post('/fmworker/heartbeat',headers=headers,json={'stage':'ready','capabilities':caps,'workflow':'h3-v6-native-inputs-turbo4'})
    assert result.status_code==200,result.text
    with core.db() as con:
        n=con.execute('SELECT * FROM nodes WHERE id=?',(node,)).fetchone()
        base={'model':'MiniMax H3','h3_inputs':'{}','refs':'[]','sampling_steps':20,'quality':480,'seconds':5}
        assert worker_pool.can_claim(con,n,base)
        assert not worker_pool.can_claim(con,n,base|{'sampling_steps':4})
        assert not worker_pool.can_claim(con,n,base|{'h3_inputs':json.dumps({'mode':'reference','files':[{'kind':'audio'}]})})


def test_migration_repeat_does_not_reclassify_gifts():
    uid,wid,_=user();fund(wid,10,'adjust')
    with core.db(True) as con:
        worker_pool.migrate(con);worker_pool.migrate(con)
        assert con.execute('SELECT eligible FROM fm_funds WHERE workspace=?',(wid,)).fetchone()[0]==0


def test_binary_audio_validation_then_reward_and_receipt(tmp_path):
    import wave,math,hashlib
    from array import array
    uid,wid,_=user();owner,dest,client=user();_,headers=resource(client)
    fund(wid,10);jid=job(uid,wid,price=10);assignment=claim(client,headers)
    ticket=headers|{'X-Job-Ticket':assignment['ticket']}
    assert client.put(f'/agent/jobs/{jid}/result',headers=ticket|{'X-SHA256':hashlib.sha256(b'bad').hexdigest()},content=b'bad').status_code==422
    with core.db() as con:assert not con.execute('SELECT 1 FROM fm_rewards WHERE job=?',(jid,)).fetchone()
    path=tmp_path/'fixture.wav'
    with wave.open(str(path),'wb') as output:
        output.setnchannels(1);output.setsampwidth(2);output.setframerate(24000)
        output.writeframes(array('h',(int(1000*math.sin(i*.1)) for i in range(24000))).tobytes())
    raw=path.read_bytes();upload=ticket|{'X-SHA256':hashlib.sha256(raw).hexdigest(),'Content-Type':'audio/wav'}
    response=client.put(f'/agent/jobs/{jid}/result',headers=upload,content=raw)
    assert response.status_code==200,response.text
    assert client.put(f'/agent/jobs/{jid}/result',headers=upload,content=raw).json()==response.json()
    assert client.get(f'/agent/jobs/{jid}/receipt',headers=ticket).json()['delivered']
    with core.db() as con:assert credits.wallet(con,dest)['balance']==7


def test_stale_flow_fails_without_automatic_resubmission():
    from flow_catalog import MODELS
    uid,wid,_=user();_,_,client=user();node,headers=resource(client,'flow')
    model=next(k for k in MODELS if k.startswith('flow:veo-3.1-quality'))
    fund(wid,5)
    with core.db(True) as con:
        jid=con.execute("""INSERT INTO jobs(uid,owner,workspace,prompt,refs,ratio,quality,seconds,seed,width,height,status,created,updated,kind,model,node,ticket,lease)
          VALUES(?,?,?,'test','[]','16:9',0,5,1,0,0,'running',?,?,'video',?,?,?,?)""",
          (secrets.token_hex(16),uid,wid,core.now(),core.now(),model,node,'lost-ticket',core.now()-1)).lastrowid
        con.execute('INSERT INTO flow_tasks(job) VALUES(?)',(jid,))
        credits.reserve(con,jid);core.reap(con)
        assert con.execute('SELECT status FROM jobs WHERE id=?',(jid,)).fetchone()[0]=='failed'
        assert con.execute('SELECT state FROM flow_tasks WHERE job=?',(jid,)).fetchone()[0]=='uncertain'
        assert credits.wallet(con,wid)['reserved']==0


def test_only_admin_can_change_reward_rate():
    uid,_,client=user()
    assert client.put('/api/admin/fmworker/config',json={'reward_bps':9000}).status_code==403
    with core.db(True) as con:con.execute("UPDATE users SET role='admin' WHERE id=?",(uid,))
    assert client.put('/api/admin/fmworker/config',json={'reward_bps':10001}).status_code==422
    assert client.put('/api/admin/fmworker/config',json={'reward_bps':7000}).status_code==200


def test_existing_platform_state_accepts_all_new_resource_types():
    uid,_,client=user()
    with core.db(True) as con:con.execute("UPDATE users SET role='admin' WHERE id=?",(uid,))
    for kind in ('flow','breeze','colab'):resource(client,kind)
    result=client.get('/api/state')
    assert result.status_code==200,result.text
    assert client.get('/api/fmworker/account').status_code==200
