"""Integer credit wallets, price snapshots and transactional job settlement.

One wallet per workspace (personal wallets follow their owner). Database triggers
cover every provider's terminal state, including recovery and account deletion.
Existing jobs have no charge record and are never charged retrospectively.
"""
import json
import time
from fastapi import HTTPException
from node_models import GPU_MODELS
from chat_models import CHAT_MODELS
from flow_catalog import MODELS as FLOW_MODELS


def catalog():
    rows=[]
    def add(model,kind,tier,label):rows.append({'key':model+'|'+tier,'model':model,'kind':kind,'tier':tier,'label':label})
    for quality in (480,768):
        for seconds in (5,10,15):add('MiniMax H3','video',f'{quality}|{seconds}',f'{quality}P · {seconds}s')
    for seconds in (5,6,8,10):add('muse-video','video',str(seconds),f'原生 · {seconds}s')
    for resolution in ('1K','2K'):
        for quality,label in [('low','草稿'),('medium','标准'),('high','高清')]:
            add('gpt-image-2.6-sunburst','image',resolution+'|'+quality,resolution+' · '+label)
    add('muse-image','image','native','原生')
    for model,spec in GPU_MODELS.items():
        if spec['kind']=='audio':add(model,'audio','standard','语音生成')
    for model in CHAT_MODELS:add(model,'chat','reply','每条完整回复')
    for model,spec in FLOW_MODELS.items():add(model,spec['kind'],'native',spec['label'])
    return rows


def migrate(con):
    # Individual statements preserve init_db's surrounding migration transaction.
    statements=[
        '''CREATE TABLE IF NOT EXISTS credit_accounts(workspace INTEGER PRIMARY KEY REFERENCES workspaces,
           balance INTEGER NOT NULL DEFAULT 0 CHECK(balance>=0),
           reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved>=0 AND reserved<=balance))''',
        '''CREATE TABLE IF NOT EXISTS credit_prices(key TEXT PRIMARY KEY, amount INTEGER CHECK(amount>0))''',
        '''CREATE TABLE IF NOT EXISTS credit_charges(job INTEGER PRIMARY KEY, workspace INTEGER NOT NULL REFERENCES credit_accounts,
           owner INTEGER NOT NULL REFERENCES users, amount INTEGER NOT NULL CHECK(amount>0), price_key TEXT NOT NULL,
           price_revision INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ('held','spent','refunded')), created INTEGER NOT NULL)''',
        '''CREATE TABLE IF NOT EXISTS credit_ledger(id INTEGER PRIMARY KEY AUTOINCREMENT,
           workspace INTEGER NOT NULL REFERENCES credit_accounts, actor INTEGER REFERENCES users, job INTEGER,
           action TEXT NOT NULL, amount INTEGER NOT NULL, balance INTEGER NOT NULL, reserved INTEGER NOT NULL,
           note TEXT NOT NULL DEFAULT '', uid TEXT UNIQUE, created INTEGER NOT NULL)''',
        'CREATE INDEX IF NOT EXISTS credit_ledger_workspace ON credit_ledger(workspace,id)',
        '''CREATE TABLE IF NOT EXISTS recharge_orders(
           id TEXT PRIMARY KEY, uid TEXT NOT NULL UNIQUE,
           owner INTEGER NOT NULL REFERENCES users, workspace INTEGER NOT NULL REFERENCES credit_accounts,
           method TEXT NOT NULL, merchant TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>0),
           credits INTEGER NOT NULL CHECK(credits>0), state TEXT NOT NULL DEFAULT 'pending',
           trade_id TEXT, checkout TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL,
           expires INTEGER NOT NULL, paid INTEGER, checked INTEGER NOT NULL DEFAULT 0,
           UNIQUE(method,trade_id))''',
        'CREATE INDEX IF NOT EXISTS recharge_owner ON recharge_orders(owner,created)',
        '''CREATE TRIGGER IF NOT EXISTS workspace_credit_account AFTER INSERT ON workspaces BEGIN
           INSERT INTO credit_accounts(workspace) VALUES(NEW.id); END''',
        '''CREATE TRIGGER IF NOT EXISTS job_credit_settle AFTER UPDATE OF status ON jobs
           WHEN NEW.status IN ('done','failed','cancelled') AND EXISTS(SELECT 1 FROM credit_charges WHERE job=NEW.id AND state='held') BEGIN
           UPDATE credit_accounts SET
             balance=balance-CASE WHEN NEW.status='done' THEN (SELECT amount FROM credit_charges WHERE job=NEW.id) ELSE 0 END,
             reserved=reserved-(SELECT amount FROM credit_charges WHERE job=NEW.id)
             WHERE workspace=(SELECT workspace FROM credit_charges WHERE job=NEW.id);
           INSERT INTO credit_ledger(workspace,actor,job,action,amount,balance,reserved,created)
             SELECT c.workspace,c.owner,c.job,CASE WHEN NEW.status='done' THEN 'spend' ELSE 'refund' END,c.amount,a.balance,a.reserved,unixepoch()
             FROM credit_charges c JOIN credit_accounts a ON a.workspace=c.workspace WHERE c.job=NEW.id;
           UPDATE credit_charges SET state=CASE WHEN NEW.status='done' THEN 'spent' ELSE 'refunded' END WHERE job=NEW.id;
           END''',
        '''CREATE TRIGGER IF NOT EXISTS job_credit_delete BEFORE DELETE ON jobs
           WHEN EXISTS(SELECT 1 FROM credit_charges WHERE job=OLD.id AND state='held') BEGIN
           SELECT RAISE(ABORT,'Cancel the job before deleting its credit hold'); END''',
    ]
    for statement in statements:con.execute(statement)
    con.execute('INSERT OR IGNORE INTO credit_accounts(workspace) SELECT id FROM workspaces')
    con.execute("INSERT OR IGNORE INTO settings VALUES('credit_price_revision','1')")
    previous_count=con.execute('SELECT count(*) FROM credit_prices').fetchone()[0]
    added=con.executemany('INSERT OR IGNORE INTO credit_prices(key,amount) VALUES(?,?)',[(r['key'],1 if r['model']=='breeze-tts-2' or r['kind']=='chat' or r['model'] in FLOW_MODELS else None) for r in catalog()]).rowcount
    if previous_count and added:con.execute("UPDATE settings SET value=CAST(value AS INTEGER)+1 WHERE key='credit_price_revision'")


def prices(con):
    amounts={r['key']:r['amount'] for r in con.execute('SELECT * FROM credit_prices')}
    return {'revision':int(con.execute("SELECT value FROM settings WHERE key='credit_price_revision'").fetchone()[0]),
            'items':[r|{'amount':amounts.get(r['key'])} for r in catalog()]}


def save_prices(con, values, expected):
    current=prices(con)
    if current['revision']!=expected:raise HTTPException(409,'价格已更新，请刷新后重试')
    if set(values)!={r['key'] for r in current['items']}:raise HTTPException(400,'定价档位不完整')
    for key,amount in values.items():
        if amount is not None and (type(amount) is not int or not 1<=amount<=1_000_000_000):
            raise HTTPException(400,'价格需为正整数，留空表示尚未定价')
        con.execute('UPDATE credit_prices SET amount=? WHERE key=?',(amount,key))
    con.execute("UPDATE settings SET value=? WHERE key='credit_price_revision'",(str(expected+1),))
    return prices(con)


def wallet(con, workspace):
    row=con.execute('SELECT * FROM credit_accounts WHERE workspace=?',(workspace,)).fetchone()
    if not row:raise HTTPException(404,'积分账户不存在')
    return dict(row)|{'available':row['balance']-row['reserved']}


def price_key(job):
    model=job['model']
    if model in FLOW_MODELS:tier='native'
    elif job['kind']=='audio':tier='standard'
    elif model=='MiniMax H3':tier=f"{job['quality']}|{job['seconds']}"
    elif model=='muse-video':tier=str(job['seconds'])
    elif model=='muse-image':tier='native'
    else:tier=('2K' if job['quality']==2048 else '1K')+'|'+job['image_quality']
    return model+'|'+tier


def reserve(con, jid, expected_revision=None):
    job=con.execute('SELECT * FROM jobs WHERE id=?',(jid,)).fetchone()
    if con.execute('SELECT 1 FROM credit_charges WHERE job=?',(jid,)).fetchone():return
    revision=int(con.execute("SELECT value FROM settings WHERE key='credit_price_revision'").fetchone()[0])
    if expected_revision is not None and revision!=expected_revision:
        raise HTTPException(409,'积分价格已更新，请确认新价格后重新提交')
    key=price_key(job)
    price=con.execute('SELECT amount FROM credit_prices WHERE key=?',(key,)).fetchone()
    if not price or price[0] is None:raise HTTPException(409,'这个档位尚未定价，请联系管理员')
    amount=price[0];account=wallet(con,job['workspace'])
    if account['available']<amount:raise HTTPException(409,f'当前空间积分不足，需要 {amount} 积分')
    con.execute('UPDATE credit_accounts SET reserved=reserved+? WHERE workspace=?',(amount,job['workspace']))
    con.execute("INSERT INTO credit_charges VALUES(?,?,?,?,?,?,'held',?)",(jid,job['workspace'],job['owner'],amount,key,revision,int(time.time())))
    from worker_pool import reserve_funds
    reserve_funds(con, jid, job['workspace'], amount, already_reserved=True)
    a=wallet(con,job['workspace'])
    con.execute('''INSERT INTO credit_ledger(workspace,actor,job,action,amount,balance,reserved,created)
        VALUES(?,?,?,'reserve',?,?,?,?)''',(job['workspace'],job['owner'],jid,amount,a['balance'],a['reserved'],int(time.time())))


def adjust(con, workspace, amount, note, uid, actor):
    if type(amount) is not int or amount==0 or abs(amount)>1_000_000_000:raise HTTPException(400,'调整积分需为非零整数')
    note=note.strip()
    if not note:raise HTTPException(400,'请填写调整原因')
    old=con.execute('SELECT * FROM credit_ledger WHERE uid=?',(uid,)).fetchone()
    if old:
        if (old['workspace'],old['amount'],old['note'],old['actor'])!=(workspace,amount,note,actor):raise HTTPException(409,'该操作编号已使用')
        return wallet(con,workspace)
    a=wallet(con,workspace)
    if a['available']+amount<0:raise HTTPException(409,'不能扣减已冻结的积分或使可用积分小于零')
    if a['balance']+amount>1_000_000_000_000:raise HTTPException(400,'积分余额超出上限')
    con.execute('UPDATE credit_accounts SET balance=balance+? WHERE workspace=?',(amount,workspace))
    a=wallet(con,workspace)
    con.execute('''INSERT INTO credit_ledger(workspace,actor,action,amount,balance,reserved,note,uid,created)
        VALUES(?,?,'adjust',?,?,?,?,?,?)''',(workspace,actor,amount,a['balance'],a['reserved'],note,uid,int(time.time())))
    return a


def history(con, workspace, before=None):
    return [dict(r) for r in con.execute('''SELECT l.*,COALESCE(NULLIF(u.nickname,''),u.name) AS actor_name
       FROM credit_ledger l LEFT JOIN users u ON u.id=l.actor WHERE workspace=? AND l.id<? ORDER BY l.id DESC LIMIT 50''',
       (workspace,before or 2**63-1))]


def accounts(con):
    return [dict(r) for r in con.execute('''SELECT a.*,a.balance-a.reserved AS available,w.kind,
       CASE w.kind WHEN 'team' THEN w.name ELSE COALESCE(NULLIF(u.nickname,''),u.name) END AS name,
       u.name AS username FROM credit_accounts a JOIN workspaces w ON w.id=a.workspace LEFT JOIN users u ON u.id=w.owner
       WHERE w.kind='team' OR u.deleted_at IS NULL ORDER BY w.kind,w.id''')]
