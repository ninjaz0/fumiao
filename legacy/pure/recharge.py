"""Workspace recharge via the shop's ZPay and EPusdt merchant accounts.

Amounts are integer CNY fen. Only verified gateway results settle orders;
settlement and ledger insertion share a single immediate SQLite transaction.
"""
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import threading
import uuid
from contextlib import asynccontextmanager
from decimal import Decimal, InvalidOperation
from urllib.parse import urlencode, urlsplit, parse_qsl
from urllib.request import Request as URLRequest, build_opener, HTTPRedirectHandler

from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import PlainTextResponse, RedirectResponse
from pydantic import BaseModel, Field, StrictInt
from starlette.concurrency import run_in_threadpool
from core import DATA, SITE, actor, db, now
from workspace_access import active_workspace, require_workspace

router = APIRouter()
log = logging.getLogger('fumiao.recharge')
METHODS = {'alipay': '支付宝', 'usdt_plasma': 'USDT-Plasma'}


def configuration():
    try:
        raw = json.loads((DATA / 'payments.json').read_text())
        return {k: v for k, v in raw.items() if k in METHODS and v.get('pid') and v.get('key')
                and urlsplit(v.get('gateway', '')).scheme == 'https'}
    except (OSError, ValueError, TypeError, AttributeError):
        return {}


def merchant(config):
    return hashlib.sha256((config['gateway'] + '|' + config['pid']).encode()).hexdigest()


def order_config(order):
    c = configuration().get(order['method'])
    if not c or merchant(c) != order['merchant']:
        raise HTTPException(503, '此订单的支付通道暂不可用，请联系管理员')
    return c


def scalar(value):
    if isinstance(value, bool) or not isinstance(value, (str, int, Decimal)):
        raise ValueError('Invalid signed value')
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise ValueError('Invalid signed number')
        return format(value.normalize(), 'f')
    return str(value)


def signature(values, key, epusdt=False):
    excluded = {'signature'} if epusdt else {'sign', 'sign_type'}
    canonical = '&'.join(k + '=' + scalar(v) for k, v in sorted(values.items())
                         if k not in excluded and v is not None and v != '')
    if epusdt:
        return hmac.new(key.encode(), canonical.encode(), hashlib.sha256).hexdigest()
    return hashlib.md5((canonical + key).encode()).hexdigest()


def fen(value):
    try:
        amount = Decimal(str(value)) * 100
        if not amount.is_finite() or amount != amount.to_integral_value() or amount <= 0:
            raise ValueError('Invalid amount')
        return int(amount)
    except (InvalidOperation, TypeError):
        raise ValueError('Invalid amount') from None


def money(order):
    return f"{order['amount'] // 100}.{order['amount'] % 100:02}"


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def gateway_json(url, payload=None):
    # Never forward merchant credentials through a redirected request.
    # ZPay's API returns an escaped JSON string when Accept is application/json.
    # Its legacy API (and the shop's client) requires the ordinary */* response.
    request = URLRequest(url, data=urlencode(payload).encode() if payload is not None else None,
                         headers={'Accept': '*/*', 'User-Agent': 'Fumiao-Payments/1.0'})
    try:
        with build_opener(NoRedirect()).open(request, timeout=4) as response:
            result = json.loads(response.read(131072), parse_float=Decimal)
            if not isinstance(result, dict):
                raise ValueError('Invalid gateway response')
            return result
    except Exception:
        # Provider URLs can contain keys; do not put exception URLs in logs/API responses.
        raise HTTPException(502, '支付通道暂时无法连接，请稍后查询订单') from None


def public_order(row):
    state = row['state']
    if state == 'pending' and row['expires'] <= now():
        state = 'expired'
    return {k: row[k] for k in ('id', 'workspace', 'method', 'amount', 'credits', 'created', 'expires', 'paid')} | {
        'state': state, 'can_pay': state == 'pending' and bool(row['checkout']),
        'payment_url': '/api/recharge/orders/' + row['id'] + '/pay',
    }


def owned_order(con, user, oid):
    row = con.execute('SELECT * FROM recharge_orders WHERE id=? AND owner=?', (oid, user['id'])).fetchone()
    if not row:
        raise HTTPException(404, '充值订单不存在')
    require_workspace(con, user, row['workspace'])
    return dict(row)


def settle(oid, trade_id):
    if not isinstance(trade_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', trade_id):
        raise ValueError('Invalid gateway order')
    with db(True) as con:
        row = con.execute('SELECT * FROM recharge_orders WHERE id=?', (oid,)).fetchone()
        if not row or (row['trade_id'] and row['trade_id'] != trade_id):
            raise ValueError('Gateway order mismatch')
        if row['state'] == 'paid':
            return
        duplicate = con.execute('SELECT id FROM recharge_orders WHERE method=? AND trade_id=? AND id<>?',
                                (row['method'], trade_id, oid)).fetchone()
        if duplicate:
            raise ValueError('Gateway order already used')
        con.execute('UPDATE credit_accounts SET balance=balance+? WHERE workspace=?', (row['credits'], row['workspace']))
        wallet = con.execute('SELECT * FROM credit_accounts WHERE workspace=?', (row['workspace'],)).fetchone()
        con.execute('''INSERT INTO credit_ledger(workspace,actor,action,amount,balance,reserved,note,uid,created)
                       VALUES(?,?,'recharge',?,?,?,?,?,?)''',
                    (row['workspace'], row['owner'], row['credits'], wallet['balance'], wallet['reserved'],
                     f"{METHODS[row['method']]} ¥{money(row)} · {oid}", 'recharge:' + oid, now()))
        con.execute("UPDATE recharge_orders SET state='paid',trade_id=?,paid=? WHERE id=?", (trade_id, now(), oid))


def verify_paid(order, config, expected_trade=None):
    if order['method'] == 'alipay':
        result = gateway_json(config['gateway'] + '/api.php?' + urlencode({
            'act': 'order', 'pid': config['pid'], 'key': config['key'], 'out_trade_no': order['id']}))
        if str(result.get('code')) != '1' or str(result.get('status')) != '1':
            return False
        if (str(result.get('pid')) != config['pid'] or result.get('out_trade_no') != order['id']
                or result.get('type') != 'alipay' or fen(result.get('money')) != order['amount']):
            raise ValueError('Gateway result mismatch')
        trade_id = str(result.get('trade_no', ''))
        if expected_trade and expected_trade != trade_id:
            raise ValueError('Gateway trade mismatch')
    else:
        trade_id = order['trade_id'] or expected_trade
        if not trade_id or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', trade_id):
            return False
        result = gateway_json(config['gateway'] + '/pay/check-status/' + trade_id)
        data = result.get('data') or {}
        if not isinstance(data, dict):
            raise ValueError('Invalid gateway data')
        if str(result.get('status_code')) != '200' or data.get('trade_id') != trade_id or data.get('status') != 2:
            return False
        # For polling the trade ID came from the server-to-server creation response.
        # For callback recovery it came from a verified HMAC with the exact local amount/order.
        if order['trade_id'] and expected_trade and expected_trade != order['trade_id']:
            raise ValueError('Gateway trade mismatch')
    settle(order['id'], trade_id)
    return True


def reconcile(oid):
    with db(True) as con:
        row = con.execute('SELECT * FROM recharge_orders WHERE id=?', (oid,)).fetchone()
        if not row or row['state'] == 'paid' or row['checked'] > now() - 10:
            return
        order = dict(row)
        con.execute('UPDATE recharge_orders SET checked=? WHERE id=?', (now(), oid))
    verify_paid(order, order_config(order))


@router.get('/api/recharge')
def listing(request: Request, before: str | None = None):
    user = actor(request)
    with db() as con:
        wid = active_workspace(con, user, request)
        rows = con.execute('SELECT * FROM recharge_orders WHERE owner=? AND workspace=? AND id<? ORDER BY id DESC LIMIT 30',
                           (user['id'], wid, before or 'z')).fetchall()
        return {'methods': [{'id': k, 'label': METHODS[k]} for k in configuration()],
                'credits_per_yuan': 10, 'min_yuan': 1, 'max_yuan': 10000,
                'orders': [public_order(r) for r in rows]}


class CreateOrder(BaseModel):
    yuan: StrictInt = Field(ge=1, le=10000)
    workspace: StrictInt
    method: str
    uid: uuid.UUID


@router.post('/api/recharge/orders')
def create(body: CreateOrder, request: Request):
    user = actor(request)
    config = configuration().get(body.method)
    if not config:
        raise HTTPException(503, '此付款方式暂不可用')
    with db(True) as con:
        require_workspace(con, user, body.workspace)
        old = con.execute('SELECT * FROM recharge_orders WHERE uid=?', (str(body.uid),)).fetchone()
        if old:
            if (old['owner'], old['workspace'], old['method'], old['amount']) != (user['id'], body.workspace, body.method, body.yuan * 100):
                raise HTTPException(409, '订单编号已使用，请重新打开充值')
            return public_order(old)
        if con.execute("SELECT count(*) FROM recharge_orders WHERE owner=? AND state!='paid' AND expires>?",
                       (user['id'], now())).fetchone()[0] >= 3:
            raise HTTPException(409, '最多保留 3 笔待付订单，请先完成已有订单或等待过期')
        oid = 'FM' + str(now()) + secrets.token_hex(8)
        con.execute('''INSERT INTO recharge_orders(id,uid,owner,workspace,method,merchant,amount,credits,created,expires)
                       VALUES(?,?,?,?,?,?,?,?,?,?)''',
                    (oid, str(body.uid), user['id'], body.workspace, body.method, merchant(config), body.yuan * 100, body.yuan * 10, now(), now() + 1800))
        order = dict(con.execute('SELECT * FROM recharge_orders WHERE id=?', (oid,)).fetchone())
    if body.method == 'alipay':
        payload = {'pid': config['pid'], 'type': 'alipay', 'out_trade_no': oid,
                   'name': f"弗淼AIGC {order['credits']}积分", 'money': money(order),
                   'notify_url': SITE + '/api/recharge/notify/alipay', 'return_url': SITE + '/payments/return'}
        if config.get('cid'):
            payload['cid'] = config['cid']
        payload.update(sign=signature(payload, config['key']), sign_type='MD5')
        checkout = config['gateway'] + '/submit.php?' + urlencode(payload)
        trade_id, expires = None, order['expires']
    else:
        payload = {'pid': config['pid'], 'order_id': oid, 'currency': 'cny', 'token': 'usdt', 'network': 'plasma',
                   'amount': money(order), 'notify_url': SITE + '/api/recharge/notify/usdt_plasma',
                   'redirect_url': SITE + '/payments/return?order=' + oid, 'name': f"弗淼AIGC {order['credits']}积分"}
        payload['signature'] = signature(payload, config['key'], True)
        try:
            result = gateway_json(config['gateway'] + '/payments/gmpay/v1/order/create-transaction', payload)
            data = result.get('data', {})
            checkout, trade_id = data.get('payment_url', ''), data.get('trade_id', '')
            if (str(result.get('status_code')) != '200' or data.get('order_id') != oid
                    or fen(data.get('amount')) != order['amount'] or str(data.get('currency', '')).lower() != 'cny'
                    or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', trade_id)
                    or urlsplit(checkout).scheme != 'https' or urlsplit(checkout).netloc != urlsplit(config['gateway']).netloc):
                raise ValueError('Invalid creation response')
            expires = int(data['expiration_time'])
            if expires > 10**12:
                expires //= 1000
        except Exception:
            # A timed-out request may have created a payable order; never replay it.
            with db(True) as con:
                con.execute("UPDATE recharge_orders SET state='unconfirmed' WHERE id=? AND state!='paid'", (oid,))
                return public_order(con.execute('SELECT * FROM recharge_orders WHERE id=?', (oid,)).fetchone())
    with db(True) as con:
        con.execute('UPDATE recharge_orders SET checkout=?,trade_id=COALESCE(trade_id,?),expires=? WHERE id=?',
                    (checkout, trade_id, expires, oid))
        return public_order(con.execute('SELECT * FROM recharge_orders WHERE id=?', (oid,)).fetchone())


@router.get('/api/recharge/orders/{oid}')
def detail(oid: str, request: Request):
    user = actor(request)
    with db() as con:
        owned_order(con, user, oid)
    warning = ''
    try:
        reconcile(oid)
    except (HTTPException, ValueError):
        warning = '暂时无法查询支付结果，请稍后刷新；已付款请勿重复支付'
    with db() as con:
        return public_order(owned_order(con, user, oid)) | {'warning': warning}


@router.get('/api/recharge/orders/{oid}/pay')
def checkout(oid: str, request: Request):
    user = actor(request)
    with db() as con:
        order = owned_order(con, user, oid)
    if not public_order(order)['can_pay']:
        raise HTTPException(409, '订单已支付、已过期或仍在确认中，请返回积分页面查询')
    order_config(order)
    return RedirectResponse(order['checkout'], status_code=303)


def callback(method, values):
    oid = values.get('out_trade_no' if method == 'alipay' else 'order_id')
    with db() as con:
        row = con.execute('SELECT * FROM recharge_orders WHERE id=? AND method=?', (oid, method)).fetchone()
    if not row:
        raise ValueError('Unknown order')
    order = dict(row)
    config = order_config(order)
    epusdt = method == 'usdt_plasma'
    provided = values.get('signature' if epusdt else 'sign', '')
    expected = signature(values, config['key'], epusdt)
    if not isinstance(provided, str) or not hmac.compare_digest(provided.lower(), expected):
        raise ValueError('Signature mismatch')
    if str(values.get('pid')) != config['pid'] or fen(values.get('amount' if epusdt else 'money')) != order['amount']:
        raise ValueError('Amount or merchant mismatch')
    if epusdt:
        if str(values.get('status')) != '2' or str(values.get('token', '')).lower() != 'usdt':
            raise ValueError('Not paid')
    elif values.get('trade_status') != 'TRADE_SUCCESS' or values.get('type') != 'alipay':
        raise ValueError('Not paid')
    tid = values.get('trade_id' if epusdt else 'trade_no')
    if not isinstance(tid, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', tid):
        raise ValueError('Invalid trade')
    if order['state'] == 'paid' and order['trade_id'] == tid:
        return
    if not verify_paid(order, config, tid):
        raise ValueError('Payment not confirmed')


def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate field')
        result[key] = value
    return result


@router.api_route('/api/recharge/notify/{method}', methods=['GET', 'POST'])
async def notify(method: str, request: Request):
    if method not in METHODS:
        return PlainTextResponse('fail', 400)
    try:
        if request.method == 'GET':
            values = unique_pairs(request.query_params.multi_items())
        else:
            raw = bytearray()
            async for chunk in request.stream():
                raw.extend(chunk)
                if len(raw) > 16384:
                    raise ValueError('Oversize callback')
            if 'application/json' in request.headers.get('content-type', ''):
                values = json.loads(raw, parse_float=Decimal, object_pairs_hook=unique_pairs)
            else:
                values = unique_pairs(parse_qsl(raw.decode(), keep_blank_values=True, max_num_fields=50))
        if not isinstance(values, dict) or len(values) > 50:
            raise ValueError('Invalid callback')
        await run_in_threadpool(callback, method, values)
        return PlainTextResponse('success' if method == 'alipay' else 'ok')
    except Exception:
        return PlainTextResponse('fail', 400)


@router.get('/payments/return')
def return_page(request: Request):
    # Browser returns are navigation only, never proof of payment. The next same-site
    # request restores the Strict session cookie and authenticates the order lookup.
    oid = request.query_params.get('order') or request.query_params.get('out_trade_no', '')
    return RedirectResponse('/studio?recharge=' + (oid if re.fullmatch(r'FM[0-9a-f]{26}', oid) else 'history'), 303)


@asynccontextmanager
async def lifespan(app):
    from image_api import lifespan as original
    stop = threading.Event()
    def poll():
        while not stop.wait(20):
            try:
                with db() as con:
                    ids = [r[0] for r in con.execute("SELECT id FROM recharge_orders WHERE state!='paid' AND created>? AND checked<? ORDER BY checked LIMIT 12", (now()-7*86400, now()-60))]
                for oid in ids:
                    if stop.is_set():
                        return
                    try:
                        reconcile(oid)
                    except (HTTPException, ValueError):
                        pass
            except Exception:
                log.warning('Recharge reconciliation deferred')
    async with original(app):
        thread = None
        if os.getenv('FUMIAO_PAYMENT_AUTOSTART', '1') != '0':
            thread = threading.Thread(target=poll, name='recharge-reconcile', daemon=True)
            thread.start()
        try:
            yield
        finally:
            stop.set()
            if thread:
                await run_in_threadpool(thread.join, 5)
