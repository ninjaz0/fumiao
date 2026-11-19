"""Conversation persistence and credit reservations, independent of the media job queue."""
import json,time
from core import fail
from chat_models import CHAT_MODELS
from workspace_access import require_resource


def migrate(con):
    statements=[
        '''CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,workspace INTEGER NOT NULL REFERENCES workspaces,
          owner INTEGER NOT NULL REFERENCES users,title TEXT NOT NULL DEFAULT '新对话',custom_title INTEGER NOT NULL DEFAULT 0,
          model TEXT NOT NULL,created REAL NOT NULL,updated REAL NOT NULL,revision INTEGER NOT NULL DEFAULT 1,deleted_at REAL)''',
        'CREATE INDEX IF NOT EXISTS conversations_space ON conversations(workspace,updated)',
        '''CREATE TABLE IF NOT EXISTS chat_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,conversation TEXT NOT NULL REFERENCES conversations,
          role TEXT NOT NULL CHECK(role IN ('user','assistant')),author INTEGER REFERENCES users,content TEXT NOT NULL DEFAULT '',
          state TEXT NOT NULL,model TEXT NOT NULL DEFAULT '',created REAL NOT NULL,context TEXT NOT NULL DEFAULT '{}',
          reply_to INTEGER REFERENCES chat_messages,superseded INTEGER NOT NULL DEFAULT 0)''',
        'CREATE INDEX IF NOT EXISTS chat_messages_chat ON chat_messages(conversation,id)',
        '''CREATE TABLE IF NOT EXISTS chat_turns(id TEXT PRIMARY KEY,uid TEXT NOT NULL UNIQUE,conversation TEXT NOT NULL REFERENCES conversations,
          owner INTEGER NOT NULL REFERENCES users,user_message INTEGER NOT NULL REFERENCES chat_messages,
          assistant_message INTEGER NOT NULL REFERENCES chat_messages,model TEXT NOT NULL,state TEXT NOT NULL,
          created REAL NOT NULL,started REAL,first_token REAL,finished REAL,updated REAL NOT NULL,
          usage TEXT NOT NULL DEFAULT '{}',error TEXT NOT NULL DEFAULT '',request_id TEXT NOT NULL DEFAULT '',finish_reason TEXT NOT NULL DEFAULT '')''',
        '''CREATE UNIQUE INDEX IF NOT EXISTS chat_one_running ON chat_turns(conversation) WHERE state='running' ''',
        '''CREATE TABLE IF NOT EXISTS credit_chat_charges(turn TEXT PRIMARY KEY REFERENCES chat_turns,workspace INTEGER NOT NULL REFERENCES credit_accounts,
          owner INTEGER NOT NULL REFERENCES users,amount INTEGER NOT NULL CHECK(amount>0),price_key TEXT NOT NULL,
          price_revision INTEGER NOT NULL,state TEXT NOT NULL,created INTEGER NOT NULL)''',
        '''CREATE TABLE IF NOT EXISTS canvas_chat_links(project TEXT NOT NULL REFERENCES canvas_projects ON DELETE CASCADE,
          node TEXT NOT NULL,conversation TEXT NOT NULL REFERENCES conversations,created REAL NOT NULL,
          PRIMARY KEY(project,node,conversation))''',
        '''CREATE TABLE IF NOT EXISTS chat_applications(uid TEXT PRIMARY KEY,owner INTEGER NOT NULL REFERENCES users,
          conversation TEXT NOT NULL REFERENCES conversations,message INTEGER NOT NULL REFERENCES chat_messages,
          project TEXT NOT NULL,node TEXT NOT NULL,mode TEXT NOT NULL,created REAL NOT NULL)''',
    ]
    for sql in statements:con.execute(sql)
    if 'chat_turn' not in {r['name'] for r in con.execute('PRAGMA table_info(credit_ledger)')}:
        con.execute('ALTER TABLE credit_ledger ADD COLUMN chat_turn TEXT')


def require_chat(con,user,cid,workspace=None,deleted=False):
    row=con.execute('SELECT * FROM conversations WHERE id=?',(cid,)).fetchone()
    require_resource(con,user,row,workspace)
    if row['deleted_at'] is not None and not deleted:fail(404,'对话已删除')
    return dict(row)


def public_chat(con,chat,user):
    active=con.execute("SELECT id FROM chat_turns WHERE conversation=? AND state='running'",(chat['id'],)).fetchone()
    return {k:chat[k] for k in ('id','workspace','owner','title','model','created','updated','revision')}|{
        'active_turn':active[0] if active else None,'can_delete':user['id']==chat['owner'] or user['role']=='admin'}


def messages(con,cid):
    return [dict(r) for r in con.execute('''SELECT m.id,m.role,m.content,m.state,m.model,m.created,m.author,m.context,m.reply_to,
      COALESCE(NULLIF(u.nickname,''),u.name) AS author_name,
      t.id AS turn,t.error,t.usage,t.started,t.finished,t.finish_reason
      FROM chat_messages m LEFT JOIN users u ON m.author=u.id
      LEFT JOIN chat_turns t ON t.assistant_message=m.id
      WHERE m.conversation=? AND m.superseded=0 ORDER BY m.id''',(cid,))]


def reserve(con,tid,workspace,user,model,price_revision):
    import credits
    key=model+'|reply'
    price=con.execute('SELECT amount FROM credit_prices WHERE key=?',(key,)).fetchone()
    if not price or price[0] is None:fail(409,'这个对话模型尚未定价')
    revision=int(con.execute("SELECT value FROM settings WHERE key='credit_price_revision'").fetchone()[0])
    if price_revision is not None and revision!=price_revision:fail(409,'价格已更新，请确认后重新发送')
    amount=price[0];account=credits.wallet(con,workspace)
    if account['available']<amount:fail(409,f'当前空间积分不足，需要 {amount} 积分')
    con.execute('UPDATE credit_accounts SET reserved=reserved+? WHERE workspace=?',(amount,workspace))
    con.execute("INSERT INTO credit_chat_charges VALUES(?,?,?,?,?,?,'held',?)",(tid,workspace,user,amount,key,revision,int(time.time())))
    account=credits.wallet(con,workspace)
    con.execute('''INSERT INTO credit_ledger(workspace,actor,chat_turn,action,amount,balance,reserved,note,created)
       VALUES(?,?,?,'reserve',?,?,?,?,?)''',(workspace,user,tid,amount,account['balance'],account['reserved'],CHAT_MODELS[model]['label']+' 对话',int(time.time())))


def settle(con,tid,success):
    row=con.execute('SELECT * FROM credit_chat_charges WHERE turn=?',(tid,)).fetchone()
    if not row or row['state']!='held':return
    con.execute('UPDATE credit_accounts SET balance=balance-?,reserved=reserved-? WHERE workspace=?',(row['amount'] if success else 0,row['amount'],row['workspace']))
    con.execute('UPDATE credit_chat_charges SET state=? WHERE turn=?',('spent' if success else 'refunded',tid))
    account=con.execute('SELECT * FROM credit_accounts WHERE workspace=?',(row['workspace'],)).fetchone()
    con.execute('''INSERT INTO credit_ledger(workspace,actor,chat_turn,action,amount,balance,reserved,note,created)
       VALUES(?,?,?,?,?,?,?,?,?)''',(row['workspace'],row['owner'],tid,'spend' if success else 'refund',row['amount'],account['balance'],account['reserved'],'AI 对话',int(time.time())))


def finish(con,tid,status,text=None,error='',usage=None,reason=''):
    turn=con.execute('SELECT * FROM chat_turns WHERE id=?',(tid,)).fetchone()
    if not turn or turn['state']!='running':return False
    stamp=time.time()
    if text is not None:con.execute('UPDATE chat_messages SET content=? WHERE id=?',(text,turn['assistant_message']))
    con.execute('UPDATE chat_messages SET state=? WHERE id=?',(status,turn['assistant_message']))
    con.execute('UPDATE chat_turns SET state=?,finished=?,updated=?,error=?,usage=?,finish_reason=? WHERE id=?',
                (status,stamp,stamp,error,json.dumps(usage or {}),reason,tid))
    con.execute('UPDATE conversations SET updated=?,revision=revision+1 WHERE id=?',(stamp,turn['conversation']))
    settle(con,tid,status=='complete')
    return True
