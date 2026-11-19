"""Offline signed payments: no real merchant calls, charges or balances."""
import hashlib,hmac,json,os,sys,tempfile,uuid
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
sandbox=tempfile.TemporaryDirectory()
os.environ.update(FUMIAO_DATA=sandbox.name,FUMIAO_SITE='http://testserver',FUMIAO_MUSE_AUTOSTART='0',FUMIAO_FLOW_AUTOSTART='0',FUMIAO_PAYMENT_AUTOSTART='0')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import core,recharge
from server import app
configs={'alipay':{'gateway':'https://zpayz.cn','pid':'123','key':'zpay-test-only'},'usdt_plasma':{'gateway':'https://pay.example.com','pid':'1000','key':'usdt-test-only'}}
(core.DATA/'payments.json').write_text(json.dumps(configs))

def ok(r):
 assert r.is_success,(r.status_code,r.text[:350]);return r.json()
def user(name,role='member'):
 code=core.token()
 with core.db(True) as con:con.execute('INSERT INTO registration_codes(code,role,expires) VALUES(?,?,?)',(code,role,core.now()+600))
 c=TestClient(app);ok(c.post('/api/register',json={'name':name,'nickname':name,'password':'payments-test-only','code':code}));return c
admin=user('admin','admin');alice=user('alice');bob=user('bob')
def state(c):return ok(c.get('/api/state'))
wid=state(alice)['workspace_id'];bw=state(bob)['workspace_id'];au=state(alice)['me']['id']
team=ok(admin.post('/api/workspaces',json={'name':'充值团队','members':[au]}))['id']
def order(c=alice,method='alipay',workspace=wid,yuan=10,uid=None):return c.post('/api/recharge/orders',json={'method':method,'workspace':workspace,'yuan':yuan,'uid':uid or str(uuid.uuid4())})
def balance(w):
 with core.db() as con:return con.execute('SELECT balance FROM credit_accounts WHERE workspace=?',(w,)).fetchone()[0]
def row(oid):
 with core.db() as con:return dict(con.execute('SELECT * FROM recharge_orders WHERE id=?',(oid,)).fetchone())
def paid_result(o,tid='trade'+uuid.uuid4().hex):return {'code':1,'status':1,'pid':'123','out_trade_no':o['id'],'type':'alipay','money':str(Decimal(o['amount'])/100),'trade_no':tid}
def notice(o,tid):
 p={'pid':'123','out_trade_no':o['id'],'type':'alipay','money':str(Decimal(o['amount'])/100),'trade_status':'TRADE_SUCCESS','trade_no':tid}
 # Independent signing implementation to catch excluded fields/order/encoding mistakes.
 canonical='&'.join(k+'='+p[k] for k in sorted(p))
 p['sign']=hashlib.md5((canonical+'zpay-test-only').encode()).hexdigest();p['sign_type']='MD5';return p
anon=TestClient(app)
assert anon.get('/api/recharge').status_code==401
assert anon.post('/api/recharge/orders',json={}).status_code in (401,422)
assert order(bob,workspace=wid).status_code==403
for value in (0,-1,1.5,True,10001,'10'):assert order(yuan=value).status_code==422
assert order(method='wxpay').status_code==503
u=str(uuid.uuid4());a=ok(order(uid=u));assert ok(order(uid=u))['id']==a['id'];assert order(yuan=11,uid=u).status_code==409
assert a['credits']==100 and a['amount']==1000 and balance(wid)==0
assert bob.get('/api/recharge/orders/'+a['id']).status_code==404
assert bob.get('/api/recharge/orders/'+a['id']+'/pay').status_code==404
assert alice.get('/api/recharge/orders/'+a['id']+'/pay',follow_redirects=False).status_code==303
url=alice.get('/api/recharge/orders/'+a['id']+'/pay',follow_redirects=False).headers['location'];assert 'zpay-test-only' not in url
assert 'zpay-test-only' not in alice.get('/api/recharge').text
print('PASS authentication, workspace ownership, integer amounts, rate, idempotent creation and secret isolation')

p=notice(a,'t001')
for change in ({'sign':'bad'},{'money':'1.00'},{'pid':'other'},{'trade_status':'WAIT_BUYER_PAY'},{'type':'wxpay'}):
 bad=p|change
 if 'sign' not in change:bad['sign']=recharge.signature(bad,'zpay-test-only')
 with patch.object(recharge,'gateway_json',side_effect=AssertionError('must reject before querying')):assert anon.get('/api/recharge/notify/alipay',params=bad).status_code==400
with patch.object(recharge,'gateway_json',return_value=paid_result(a,'t001')|{'money':'9.00'}):assert anon.get('/api/recharge/notify/alipay',params=p).status_code==400
with patch.object(recharge,'gateway_json',return_value=paid_result(a,'t001')|{'status':0}):assert anon.get('/api/recharge/notify/alipay',params=p).status_code==400
assert balance(wid)==0
with patch.object(recharge,'gateway_json',return_value=paid_result(a,'t001')):
 with ThreadPoolExecutor(6) as pool:results=list(pool.map(lambda _:anon.get('/api/recharge/notify/alipay',params=p),range(12)))
assert all(r.text=='success' for r in results);assert balance(wid)==100
with core.db() as con:assert con.execute("SELECT count(*) FROM credit_ledger WHERE action='recharge'").fetchone()[0]==1
assert alice.get('/api/recharge/orders/'+a['id']+'/pay',follow_redirects=False).status_code==409
assert anon.get('/payments/return',params=p,follow_redirects=False).headers['location']=='/studio?recharge='+a['id']
assert balance(wid)==100
print('PASS invalid signature/merchant/type/amount/status rejection, independent query, concurrent duplicate callbacks and untrusted return')

b=ok(order(workspace=team,yuan=1));alice.headers['X-Workspace-Id']=str(bw)
with patch.object(recharge,'gateway_json',return_value=paid_result(b,'t002')):assert ok(alice.get('/api/recharge/orders/'+b['id']))['state']=='paid'
assert balance(team)==10 and balance(wid)==100 and balance(bw)==0
alice.headers.pop('X-Workspace-Id')
c=ok(order(yuan=2))
with core.db(True) as con:con.execute('UPDATE recharge_orders SET expires=? WHERE id=?',(core.now()-1,c['id']))
with patch.object(recharge,'gateway_json',return_value=paid_result(c,'t003')):assert anon.get('/api/recharge/notify/alipay',params=notice(c,'t003')).text=='success'
assert balance(wid)==120
# Replay another local order's gateway trade ID cannot fund a new order.
d=ok(order(yuan=2));p=notice(d,'t003')
with patch.object(recharge,'gateway_json',return_value=paid_result(d,'t003')):assert anon.get('/api/recharge/notify/alipay',params=p).status_code==400
assert balance(wid)==120
print('PASS original workspace retention, late paid notifications, missing callback polling, gateway transaction uniqueness')

calls=[]
def usdt_create(url,payload=None):
 calls.append((url,payload));assert payload['currency']=='cny' and payload['token']=='usdt' and payload['network']=='plasma'
 assert 'signature' in payload
 return {'status_code':200,'data':{'order_id':payload['order_id'],'trade_id':'usdt001','amount':Decimal(payload['amount']),'currency':'CNY','payment_url':'https://pay.example.com/checkout/usdt001','expiration_time':core.now()+600}}
with patch.object(recharge,'gateway_json',side_effect=usdt_create):e=ok(order(method='usdt_plasma',yuan=3))
assert e['can_pay'] and len(calls)==1
payload={'pid':'1000','order_id':e['id'],'trade_id':'usdt001','amount':Decimal('3.0'),'actual_amount':Decimal('0.41234'),'receive_address':'0xexample','token':'USDT','block_transaction_id':'0xabc','status':2}
canonical='actual_amount=0.41234&amount=3&block_transaction_id=0xabc&order_id='+e['id']+'&pid=1000&receive_address=0xexample&status=2&token=USDT&trade_id=usdt001'
payload['signature']=hmac.new(b'usdt-test-only',canonical.encode(),hashlib.sha256).hexdigest()
assert recharge.signature(payload,'usdt-test-only',True)==payload['signature']
wire={k:float(v) if isinstance(v,Decimal) else v for k,v in payload.items()}
with patch.object(recharge,'gateway_json',return_value={'status_code':200,'data':{'trade_id':'usdt001','status':2}}):
 assert anon.post('/api/recharge/notify/usdt_plasma',json=wire).text=='ok'
 assert anon.post('/api/recharge/notify/usdt_plasma',json=wire).text=='ok'
assert balance(wid)==150
# Existing PHP independent HMAC test vector, with form values preserved.
vector={'pid':'1000','order_id':'ACGTEST001','currency':'cny','token':'usdt','network':'tron','amount':'1.00','notify_url':'https://example.com/notify','redirect_url':'https://example.com/return','name':'ACG-Faka ACGTEST001'}
assert recharge.signature(vector,'0123456789abcdef'*4,True)=='ee3675293403af5961446d2f51256973ae63dbf82449f5c3b25867b69d91b8db'
print('PASS EPusdt exact form signing, independent PHP vector, numeric JSON callback signing, Plasma checkout and one-time settlement')

uid=str(uuid.uuid4())
with patch.object(recharge,'gateway_json',side_effect=recharge.HTTPException(502,'test timeout')) as mock:
 f=ok(order(method='usdt_plasma',uid=uid));assert f['state']=='unconfirmed' and not f['can_pay']
 assert ok(order(method='usdt_plasma',uid=uid))['id']==f['id'];assert mock.call_count==1
# Recovery from a lost create response uses a signed callback and server query.
recovery=wire|{'order_id':f['id'],'trade_id':'usdt002','amount':10}
recovery['signature']=recharge.signature({k:Decimal(str(v)) if isinstance(v,float) else v for k,v in recovery.items()},'usdt-test-only',True)
with patch.object(recharge,'gateway_json',return_value={'status_code':200,'data':{'trade_id':'usdt002','status':2}}):assert anon.post('/api/recharge/notify/usdt_plasma',json=recovery).text=='ok'
assert balance(wid)==250
core.init_db();assert balance(wid)==250 and row(f['id'])['state']=='paid'
assert anon.post('/api/recharge/notify/usdt_plasma',content='{"pid":"a","pid":"b"}',headers={'content-type':'application/json'}).status_code==400
assert anon.get('/api/recharge/notify/alipay?pid=a&pid=b').status_code==400
assert anon.post('/api/recharge/notify/usdt_plasma',content='x'*17000).status_code==400
# Remove team membership: no new checkout or disclosure; verified funds still go to original team.
g=ok(order(workspace=team))
with core.db(True) as con:con.execute('DELETE FROM workspace_members WHERE workspace=? AND user=?',(team,au))
assert alice.get('/api/recharge/orders/'+g['id']).status_code==403
assert order(workspace=team).status_code==403
with patch.object(recharge,'gateway_json',return_value=paid_result(g,'t004')):assert anon.get('/api/recharge/notify/alipay',params=notice(g,'t004')).text=='success'
assert balance(team)==110
print('PASS ambiguous create never replayed, signed recovery, restart migration, malformed callbacks and revoked membership')
# Limits and gateway errors cannot create more payable orders or grant credits.
charlie=user('charlie');cw=state(charlie)['workspace_id']
for _ in range(3):ok(order(charlie,workspace=cw))
assert order(charlie,workspace=cw).status_code==409
with core.db(True) as con:con.execute('UPDATE recharge_orders SET expires=? WHERE workspace=?',(core.now()-1,cw))
old=ok(charlie.get('/api/recharge'))['orders'][0]
assert old['state']=='expired' and not old['can_pay']
h=ok(order(charlie,workspace=cw));assert h['can_pay']
with patch.object(recharge,'gateway_json',side_effect=recharge.HTTPException(502,'test outage')):
 result=ok(charlie.get('/api/recharge/orders/'+h['id']));assert result['state']=='pending' and result['warning']
assert balance(cw)==0
assert anon.get('/payments/return?out_trade_no='+h['id']+'&trade_status=TRADE_SUCCESS',follow_redirects=False).status_code==303
assert balance(cw)==0
print('PASS pending-order limit, expired checkout rejection, outage preservation and return forgery')
# Some gateways return a JSON string for orders not yet opened in the cashier.
from io import BytesIO
for raw in (b'"order not found"', b'null', b'[]'):
 with patch.object(recharge,'build_opener') as opener:
  opener.return_value.open.return_value.__enter__.return_value=BytesIO(raw)
  try:recharge.gateway_json('https://zpayz.cn/api.php')
  except recharge.HTTPException as e:
   assert e.status_code==502
   assert opener.return_value.open.call_args.args[0].get_header('Accept')=='*/*'
  else:raise AssertionError('non-object gateway response accepted')
print('PASS non-object upstream responses remain recoverable errors')
print('All recharge tests passed')
