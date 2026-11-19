"""fmWorker resource ownership, conservative funding provenance and idempotent rewards.

No import of core here: migrate() runs during core initialization. Existing GPU
nodes have no fm_resources row and retain their existing scheduling behaviour.
"""
import json
import time

H3_MODES = ('text', 'first', 'last', 'first_last', 'image', 'video', 'audio', 'mixed')


def migrate(con):
    for sql in (
        '''CREATE TABLE IF NOT EXISTS fm_resources(
          node INTEGER PRIMARY KEY REFERENCES nodes, kind TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 0, capabilities TEXT NOT NULL DEFAULT '{}',
          limits TEXT NOT NULL DEFAULT '{}', created INTEGER NOT NULL)''',
        '''CREATE TABLE IF NOT EXISTS fm_assignments(
          job INTEGER NOT NULL, ticket TEXT NOT NULL, node INTEGER NOT NULL REFERENCES nodes,
          owner INTEGER NOT NULL REFERENCES users, reward_bps INTEGER NOT NULL,
          created INTEGER NOT NULL, PRIMARY KEY(job,ticket))''',
        '''CREATE TABLE IF NOT EXISTS fm_rewards(
          job INTEGER PRIMARY KEY, node INTEGER NOT NULL, owner INTEGER NOT NULL,
          workspace INTEGER NOT NULL, units INTEGER NOT NULL, credited INTEGER NOT NULL,
          created INTEGER NOT NULL)''',
        '''CREATE TABLE IF NOT EXISTS fm_reward_remainders(
          workspace INTEGER PRIMARY KEY REFERENCES credit_accounts, units INTEGER NOT NULL DEFAULT 0)''',
        '''CREATE TABLE IF NOT EXISTS fm_funds(
          workspace INTEGER PRIMARY KEY REFERENCES credit_accounts,
          eligible INTEGER NOT NULL DEFAULT 0 CHECK(eligible>=0),
          held INTEGER NOT NULL DEFAULT 0 CHECK(held>=0 AND held<=eligible))''',
        '''CREATE TABLE IF NOT EXISTS fm_fund_holds(
          job INTEGER PRIMARY KEY REFERENCES credit_charges, workspace INTEGER NOT NULL,
          amount INTEGER NOT NULL CHECK(amount>=0), state TEXT NOT NULL DEFAULT 'held')''',
        '''CREATE TABLE IF NOT EXISTS fm_usage(
          node INTEGER NOT NULL REFERENCES nodes, uid TEXT NOT NULL, units REAL NOT NULL CHECK(units>=0),
          created INTEGER NOT NULL, PRIMARY KEY(node,uid))''',
        '''CREATE TRIGGER IF NOT EXISTS fm_account AFTER INSERT ON credit_accounts BEGIN
          INSERT INTO fm_funds(workspace) VALUES(NEW.workspace); END''',
        '''CREATE TRIGGER IF NOT EXISTS fm_paid_in AFTER INSERT ON credit_ledger
          WHEN NEW.action IN ('recharge','contribution') AND NEW.amount>0 BEGIN
          UPDATE fm_funds SET eligible=eligible+NEW.amount WHERE workspace=NEW.workspace; END''',
        '''CREATE TRIGGER IF NOT EXISTS fm_adjust_out AFTER INSERT ON credit_ledger
          WHEN NEW.action='adjust' AND NEW.amount<0 BEGIN
          UPDATE fm_funds SET eligible=MAX(held,MIN(eligible,NEW.balance)) WHERE workspace=NEW.workspace; END''',
        '''CREATE TRIGGER IF NOT EXISTS fm_fund_settle AFTER UPDATE OF state ON credit_charges
          WHEN OLD.state='held' AND NEW.state IN ('spent','refunded') BEGIN
          UPDATE fm_funds SET held=held-COALESCE((SELECT amount FROM fm_fund_holds WHERE job=NEW.job AND state='held'),0),
            eligible=eligible-CASE WHEN NEW.state='spent' THEN COALESCE((SELECT amount FROM fm_fund_holds WHERE job=NEW.job AND state='held'),0) ELSE 0 END
            WHERE workspace=NEW.workspace;
          UPDATE fm_fund_holds SET state=NEW.state WHERE job=NEW.job; END''',
    ):
        con.execute(sql)
    # Contribution schedules and budgets were removed; erase legacy settings.
    con.execute("UPDATE fm_resources SET limits='{}' WHERE limits!='{}'")
    # Replay only previously unclassified wallets. Gifts remain non-rewardable.
    for account in con.execute('SELECT a.* FROM credit_accounts a LEFT JOIN fm_funds f ON f.workspace=a.workspace WHERE f.workspace IS NULL').fetchall():
        eligible = 0
        for entry in con.execute('SELECT * FROM credit_ledger WHERE workspace=? ORDER BY id', (account['workspace'],)):
            if entry['action'] in ('recharge', 'contribution'):
                eligible += max(0, entry['amount'])
            if entry['action'] in ('spend', 'adjust'):
                eligible = min(eligible, entry['balance'])
        con.execute('INSERT INTO fm_funds VALUES(?,?,0)', (account['workspace'], max(0, min(eligible, account['balance']))))
        for charge in con.execute("SELECT * FROM credit_charges WHERE workspace=? AND state='held' ORDER BY job", (account['workspace'],)).fetchall():
            # Existing holds predate provenance snapshots: reserve conservatively,
            # but never issue retrospective contribution rewards for them.
            reserve_funds(con, charge['job'], charge['workspace'], charge['amount'], already_reserved=True)
    con.execute("INSERT OR IGNORE INTO settings VALUES('fmworker_reward_bps','7000')")


def reserve_funds(con, job, workspace, amount, already_reserved=False):
    if con.execute('SELECT 1 FROM fm_fund_holds WHERE job=?', (job,)).fetchone():
        return
    row = con.execute('SELECT a.balance,a.reserved,f.eligible,f.held FROM credit_accounts a JOIN fm_funds f USING(workspace) WHERE workspace=?', (workspace,)).fetchone()
    if not row:
        return
    available = row['balance']-row['reserved']+(amount if already_reserved else 0)
    eligible = row['eligible']-row['held']
    hold = min(eligible, max(0, amount-max(0, available-eligible)))
    con.execute('INSERT INTO fm_fund_holds(job,workspace,amount) VALUES(?,?,?)', (job, workspace, hold))
    con.execute('UPDATE fm_funds SET held=held+? WHERE workspace=?', (hold, workspace))


def resource(con, node):
    row = con.execute('SELECT * FROM fm_resources WHERE node=?', (node,)).fetchone()
    return dict(row) if row else None


def input_mode(job):
    from node_models import h3_input_metadata
    value = h3_input_metadata(dict(job))
    if value.get('mode') == 'frames':
        first, last = bool(value.get('first_frame')), bool(value.get('last_frame'))
        return 'first_last' if first and last else 'first' if first else 'last' if last else 'text'
    kinds = {f['kind'] for f in value.get('files', [])}
    if kinds:
        return next(iter(kinds)) if len(kinds) == 1 else 'mixed'
    refs = json.loads(job['refs']) if isinstance(job['refs'], str) else job['refs']
    return 'text' if not refs else 'first' if len(refs) == 1 else 'image'


def can_claim(con, node, job, timestamp=None):
    r = resource(con, node['id'])
    if r is None:
        return True
    timestamp = int(time.time() if timestamp is None else timestamp)
    if not r['enabled']:
        return False
    caps = json.loads(r['capabilities'])
    if job['model'] not in caps.get('models', []):
        return False
    # Never dispatch based on an optimistic full-feature claim alone. A release
    # build advertises its validated matrix; unknown/empty matrices claim nothing.
    if job['model'] == 'MiniMax H3':
        matrix = caps.get('h3', {})
        if any(value not in matrix.get(key, []) for key, value in (
            ('modes', input_mode(job)), ('steps', job['sampling_steps']),
            ('quality', job['quality']), ('seconds', job['seconds']))):
            return False
    return True


def assigned(con, node, job):
    if resource(con, node['id']) is None:
        return
    ratio = int(con.execute("SELECT value FROM settings WHERE key='fmworker_reward_bps'").fetchone()[0])
    con.execute('INSERT OR IGNORE INTO fm_assignments VALUES(?,?,?,?,?,?)',
                (job['id'], job['ticket'], node['id'], node['owner'], min(10000, max(0, ratio)), int(time.time())))


def settle_reward(con, job_id):
    row = con.execute('''SELECT a.*,j.owner AS customer,j.status,c.workspace AS source_workspace,
      h.amount AS eligible,c.state AS charge_state FROM jobs j
      JOIN fm_assignments a ON a.job=j.id AND a.ticket=j.ticket
      JOIN credit_charges c ON c.job=j.id JOIN fm_fund_holds h ON h.job=j.id WHERE j.id=?''', (job_id,)).fetchone()
    if not row or row['status'] != 'done' or row['charge_state'] != 'spent' or row['customer'] == row['owner']:
        return
    if con.execute('SELECT 1 FROM fm_rewards WHERE job=?', (job_id,)).fetchone():
        return
    dest = con.execute("SELECT w.id FROM workspaces w JOIN users u ON u.id=w.owner WHERE w.kind='personal' AND w.owner=? AND u.active=1", (row['owner'],)).fetchone()
    if not dest:
        return
    units = row['eligible']*row['reward_bps']
    if not units:
        return
    workspace = dest[0]
    con.execute('INSERT OR IGNORE INTO fm_reward_remainders(workspace) VALUES(?)', (workspace,))
    previous = con.execute('SELECT units FROM fm_reward_remainders WHERE workspace=?', (workspace,)).fetchone()[0]
    credit, remainder = divmod(previous+units, 10000)
    con.execute('UPDATE fm_reward_remainders SET units=? WHERE workspace=?', (remainder, workspace))
    con.execute('INSERT INTO fm_rewards VALUES(?,?,?,?,?,?,?)',
                (job_id, row['node'], row['owner'], workspace, units, credit, int(time.time())))
    if credit:
        con.execute('UPDATE credit_accounts SET balance=balance+? WHERE workspace=?', (credit, workspace))
        balance = con.execute('SELECT balance,reserved FROM credit_accounts WHERE workspace=?', (workspace,)).fetchone()
        con.execute('''INSERT INTO credit_ledger(workspace,actor,job,action,amount,balance,reserved,note,uid,created)
          VALUES(?,?,?,'contribution',?,?,?,'fmWorker 贡献奖励',?,?)''',
          (workspace, row['owner'], job_id, credit, balance[0], balance[1], 'fmworker:'+str(job_id), int(time.time())))


def has_ready_flow(con, model):
    stamp = int(time.time())
    for row in con.execute("SELECT n.*,f.capabilities FROM nodes n JOIN fm_resources f ON f.node=n.id WHERE f.kind='flow' AND f.enabled=1 AND n.control='active' AND n.stage='ready' AND n.lastseen>?", (stamp-45,)):
        if can_claim(con, row, {'model': model}, stamp):
            return True
    return False


def reap_flow(con, timestamp):
    # A lost webpage request may already have consumed upstream credits. It must
    # never be reassigned and submitted again automatically.
    rows = con.execute("SELECT * FROM jobs WHERE model LIKE 'flow:%' AND node IS NOT NULL AND status='running' AND lease<?", (timestamp,)).fetchall()
    if not rows: return
    import timing
    for job in rows:
        con.execute("UPDATE jobs SET status='failed',lease=NULL,note='贡献节点失联，Flow 结果未确认；未自动重复生成',updated=? WHERE id=?", (timestamp,job['id']))
        con.execute("UPDATE flow_tasks SET state='uncertain' WHERE job=?", (job['id'],))
        timing.end_run(con,job,'interrupted')
