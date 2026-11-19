"""Administrator-controlled model admission. Existing jobs remain visible and recoverable."""
import json
from fastapi import HTTPException
from node_models import GPU_MODELS
from chat_models import CHAT_MODELS

MODELS={
    'MiniMax H3':{'kind':'video','label':'MiniMax H3'},
    'muse-video':{'kind':'video','label':'Muse'},
    'gpt-image-2.6-sunburst':{'kind':'image','label':'gpt-image-2.6'},
    'muse-image':{'kind':'image','label':'Muse'},
}
MODELS.update({key:{'kind':value['kind'],'label':value['label']} for key,value in GPU_MODELS.items()})

MODELS.update(CHAT_MODELS)
from flow_catalog import MODELS as FLOW_MODELS
MODELS.update(FLOW_MODELS)

def hidden_models(con):
    row=con.execute("SELECT value FROM settings WHERE key='hidden_model_ids'").fetchone()
    configured=set(json.loads(row[0])) if row else set()
    return {key for key,value in MODELS.items() if value.get('hidden') or key in configured}


def catalog(con):
    hidden=hidden_models(con)
    return {key:value|{'hidden':key in hidden} for key,value in MODELS.items()}


def groups(con):
    """One management switch for every visible model family and generation kind."""
    result={}
    for model,spec in catalog(con).items():
        if spec['hidden']:continue
        key=spec.get('family') or model
        group=result.setdefault(key,{'kind':spec['kind'],'label':spec.get('family_label') or spec['label'],'models':[]})
        if group['kind']!=spec['kind']:raise ValueError('Model families must not mix generation kinds')
        group['models'].append(model)
    return result


def save_group(con, group, value, expected, workspace=None):
    members=groups(con).get(group,{}).get('models')
    if not members:raise HTTPException(400,'未知模型')
    if workspace is not None:
        return _save_team_models(con,workspace,members,value,expected)
    flags=read(con)['enabled']
    flags.update({model:value for model in members})
    return save(con,flags,expected)


def read(con):
    row=con.execute("SELECT value FROM settings WHERE key='model_policy'").fetchone()
    if row:return json.loads(row[0])
    old=con.execute("SELECT value FROM settings WHERE key='openai_images'").fetchone()
    images=json.loads(old[0]).get('enabled',True) if old else True
    return {'revision':1,'enabled':{key:False if value.get('hidden') else bool(images) if value['kind']=='image' else True for key,value in MODELS.items()}}


def migrate(con):
    con.execute("INSERT OR IGNORE INTO settings VALUES('model_policy',?)",(json.dumps(read(con)),))
    con.execute('''CREATE TABLE IF NOT EXISTS workspace_model_policy(
        workspace INTEGER PRIMARY KEY REFERENCES workspaces, flags TEXT NOT NULL, revision INTEGER NOT NULL)''')
    policy=read(con);missing=set(MODELS)-set(policy['enabled'])
    hidden=hidden_models(con)
    if missing or any(policy['enabled'].get(key) for key in hidden):
        policy['enabled'].update({key:True for key in missing})
        policy['enabled'].update({key:False for key in hidden});policy['revision']+=1
        con.execute("UPDATE settings SET value=? WHERE key='model_policy'",(json.dumps(policy),))
    for row in con.execute('SELECT * FROM workspace_model_policy').fetchall():
        flags=json.loads(row['flags']);missing=set(MODELS)-set(flags)
        if missing or any(flags.get(key) for key in hidden):
            flags.update({key:True for key in missing})
            flags.update({key:False for key in hidden})
            con.execute('UPDATE workspace_model_policy SET flags=?,revision=revision+1 WHERE workspace=?',(json.dumps(flags),row['workspace']))


def team_policy(con, workspace):
    row=con.execute('SELECT flags,revision FROM workspace_model_policy WHERE workspace=?',(workspace,)).fetchone()
    hidden=hidden_models(con)
    return {'revision':row['revision'] if row else 0,
            'enabled':json.loads(row['flags']) if row else {k:k not in hidden for k in MODELS}}


def effective(con, workspace):
    global_flags=read(con)['enabled']; team_flags=team_policy(con,workspace)['enabled']
    hidden=hidden_models(con)
    return {k:bool(global_flags.get(k) and team_flags.get(k) and k not in hidden) for k in MODELS}


def enabled(con, model, workspace=None):
    return model not in hidden_models(con) and bool((effective(con,workspace) if workspace is not None else read(con)['enabled']).get(model,False))


def require_enabled(con, model, workspace=None):
    if not enabled(con,model,workspace):raise HTTPException(403,'当前空间未开放该模型，请选择其他模型')


def allowed_sql(alias='jobs'):
    assert alias in ('jobs','j')
    return f'''EXISTS(SELECT 1 FROM settings s,json_each(s.value,'$.enabled') f
        WHERE s.key='model_policy' AND f.key={alias}.model AND f.value=1)
        AND NOT EXISTS(SELECT 1 FROM workspace_model_policy wp WHERE wp.workspace={alias}.workspace
        AND NOT EXISTS(SELECT 1 FROM json_each(wp.flags) f WHERE f.key={alias}.model AND f.value=1))'''


def save_team(con, workspace, model, value, expected):
    if model in hidden_models(con) and value:raise HTTPException(400,'该模型已隐藏')
    return _save_team_models(con,workspace,[model],value,expected)


def _save_team_models(con, workspace, models, value, expected):
    row=con.execute("SELECT 1 FROM workspaces WHERE id=? AND kind='team'",(workspace,)).fetchone()
    if not row:raise HTTPException(404,'团队不存在')
    current=team_policy(con,workspace)
    if current['revision']!=expected:raise HTTPException(409,'团队模型设置已更新，请刷新后重试')
    current['enabled'].update({model:value for model in models});current['revision']+=1
    con.execute('''INSERT INTO workspace_model_policy VALUES(?,?,?) ON CONFLICT(workspace)
        DO UPDATE SET flags=excluded.flags,revision=excluded.revision''',
        (workspace,json.dumps(current['enabled']),current['revision']))
    return current


def save(con, flags, expected=None):
    current=read(con)
    if expected is not None and current['revision']!=expected:
        raise HTTPException(409,'模型设置已更新，请刷新后重试')
    if set(flags)!=set(MODELS) or any(type(v) is not bool for v in flags.values()):
        raise HTTPException(400,'模型设置无效')
    hidden=hidden_models(con)
    flags={key:False if key in hidden else value for key,value in flags.items()}
    value={'revision':current['revision']+1,'enabled':flags}
    con.execute("INSERT INTO settings VALUES('model_policy',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(json.dumps(value),))
    row=con.execute("SELECT value FROM settings WHERE key='openai_images'").fetchone()
    legacy=json.loads(row[0]) if row else {}
    legacy['enabled']=any(flags[k] for k,m in MODELS.items() if m['kind']=='image')
    con.execute("INSERT INTO settings VALUES('openai_images',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(json.dumps(legacy),))
    return value
