#!/usr/bin/env python3
"""Export a quiesced Pure SQLite snapshot. No service credentials or sessions."""
import argparse,json,os,re,sqlite3,hashlib
from pathlib import Path

# Optional Pure tables for archived contributions. Keep only the public facts
# needed to identify a historical allocation or independent earnings balance.
contribution_columns={
    'fm_resources': ('node','kind','enabled','capabilities','created'),
    'fm_assignments': ('job','node','owner','reward_bps','created'),
    'fm_fund_holds': ('job','workspace','amount','state'),
    'fm_accounts': ('id','owner','workspace','balance','reserved','earned','created','updated'),
    'fm_account_ledger': ('id','account','job','action','amount','balance','created'),
}

def export(database,output,source,include_registration_codes=False,avatars=None,objects=None):
    con=sqlite3.connect(Path(database).resolve().as_uri()+'?mode=ro',uri=True)
    con.row_factory=sqlite3.Row
    con.execute('BEGIN')
    tables={r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    def rows(table):return [dict(r) for r in con.execute('SELECT * FROM "'+table+'"')] if table in tables else []
    # An expired contribution lease can still have completed upstream. Pure
    # must be put in maintenance before the snapshot so nothing reaps or retries it.
    jobs=rows('jobs')
    contribution={name:rows(name) for name in contribution_columns}
    rewards=rows('fm_rewards')
    usage=rows('fm_usage')
    contributor_nodes={r['node'] for group in (contribution['fm_resources'],contribution['fm_assignments'],rewards,usage)
                       for r in group}
    contributed_jobs={r['job'] for group in (contribution['fm_assignments'],rewards) for r in group}
    held_charges={r['job'] for table in ('credit_charges','fm_fund_holds')
                  for r in rows(table) if r['state']=='held'}
    active_jobs={r['id'] for r in jobs if r['status'] not in {'done','failed','cancelled'}}
    active_contributions=(active_jobs | held_charges) & (
        contributed_jobs | {j['id'] for j in jobs if j.get('node') in contributor_nodes}
    )
    if active_contributions:
        ids=', '.join(map(str,sorted(active_contributions)[:20]))
        raise SystemExit(
            f'旧贡献任务需人工核对（任务编号：{ids}）；请保持源站和调度器停写，'
            '核对上游结果、消费冻结及已入账记录。禁止自动重发，确认后从一致性备份重新导出。'
        )
    if active_jobs:
        ids=', '.join(map(str,sorted(active_jobs)[:20]))
        raise SystemExit(f'jobs 尚有未结算任务（任务编号：{ids}）；请停止接收新任务并完成/核对后导出')
    checks=[('job_runs','status',{'done','failed','cancelled','interrupted','legacy'}),('chat_turns','state',{'complete','completed','failed','stopped','interrupted','cancelled'}),('storyboard_exports','state',{'done','failed','cancelled'})]
    for table,column,terminal in checks:
        if any(r[column] not in terminal for r in rows(table)):
            raise SystemExit(f'{table} 尚有未结算任务；请停止接收新任务并完成/核对后导出')
    if held_charges or any(r['reserved'] for r in rows('credit_accounts')):raise SystemExit('仍有冻结积分，拒绝导出')
    if any(r['held'] for r in rows('fm_funds')):raise SystemExit('仍有冻结的贡献合格积分，拒绝导出')
    if any(r['state'] not in {'paid','expired'} for r in rows('recharge_orders')):
        raise SystemExit('仍有未确认充值订单，请先核对或关闭后导出')
    names=['users','workspaces','workspace_members','media','jobs','canvas_projects','canvas_media_refs','canvas_job_links','canvas_run_batches','asset_packs','asset_pack_media','conversations','chat_messages','chat_turns','canvas_chat_links','chat_applications','credit_accounts','credit_ledger','credit_prices','credit_charges','credit_chat_charges','recharge_orders','favorites','workspace_model_policy','registration_codes','registration_redemptions','storyboard_exports','storyboard_export_refs','media_provenance','fm_rewards','fm_funds','fm_reward_remainders','fm_usage']
    cached={'fm_rewards':rewards,'fm_usage':usage,'jobs':jobs}
    result={'version':1,'source':source,'tables':{name:cached[name] if name in cached else rows(name) for name in names}}
    canvas_tables={'canvas_projects','canvas_media_refs','canvas_job_links','canvas_run_batches','storyboard_exports','storyboard_export_refs'}
    if tables & canvas_tables and not canvas_tables <= tables:raise SystemExit('原画布表不完整，请先完成原实例初始化')
    result['canvasVersion']=1
    result['tables']['storyboard_exports']=[dict(r) for r in con.execute('SELECT rowid AS original_order,* FROM storyboard_exports ORDER BY rowid')] if 'storyboard_exports' in tables else []
    chat_tables={'conversations','chat_messages','chat_turns','credit_chat_charges','canvas_chat_links','chat_applications'}
    if tables & chat_tables and not chat_tables <= tables:raise SystemExit('原对话表不完整，请先完成原实例初始化')
    if any(r['state']=='held' for r in rows('credit_chat_charges')):raise SystemExit('仍有未结算对话费用，拒绝导出')
    result['chatVersion']=1
    result['tables']['conversations']=[dict(r) for r in con.execute('SELECT rowid AS original_order,* FROM conversations ORDER BY rowid')] if 'conversations' in tables else []
    # The UI orders references by SQLite rowid, not their random media IDs.
    result['tables']['media']=[dict(r) for r in con.execute('SELECT rowid AS original_order,* FROM media ORDER BY rowid')] if 'media' in tables else []
    if objects is not None:
        for media in result['tables']['media']:
            key=media['id']
            if not re.fullmatch(r'[0-9a-f]{32}',key):raise SystemExit('旧素材编号无效')
            path=Path(objects)/key
            if not path.is_file():raise SystemExit(f'缺少旧素材文件：{key}')
            with path.open('rb') as file:
                info=os.fstat(file.fileno())
                if info.st_size!=media['size']:raise SystemExit(f'旧素材长度不一致：{key}')
                media['sha256']=hashlib.file_digest(file,'sha256').hexdigest()
                media['modified_ns']=str(info.st_mtime_ns)
    node_columns={'id','owner','name','stage','lastseen','control','detail','models','ready_models','profile','hardware','workflow','runtime_id','model_profiles','video_steps'}
    source_nodes=rows('nodes')
    result['tables']['nodes']=[{k:v for k,v in r.items() if k in node_columns} for r in source_nodes if 'id' in r]
    for name,columns in contribution_columns.items():
        if name == 'fm_resources' or contribution[name]:
            result['tables'][name]=[{k:r[k] for k in columns if k in r} for r in contribution[name]]
    retired_credentials=[]
    for node in source_nodes:
        if node['id'] not in contributor_nodes:
            continue
        old_digest=node.get('key')
        if old_digest is not None and not re.fullmatch(r'[a-f0-9]{64}',old_digest):
            raise SystemExit(f"旧贡献节点凭据格式无效（节点编号：{node['id']}）；请先核对源数据")
        # A domain-separated hash of the server's hash is useful only for denial.
        digest=hashlib.sha256(('fmworker-retired:'+old_digest).encode()).hexdigest() if old_digest else None
        retired_credentials.append({'node':node['id'],'digest':digest})
    if retired_credentials:
        result['tables']['fm_retired_node_credentials']=retired_credentials
    for job in result['tables']['jobs']:
        job.pop('ticket',None);job.pop('lease',None)
    # Timing only: never export node credentials, tickets or live provider tasks.
    timing_columns={'id','job','attempt','node','kind','model','features','created','queued','started','generating','finalizing','uploading','validating','finished','status','phase','step','steps','progress','predicted','details','valid'}
    result['tables']['job_runs']=[{k:v for k,v in r.items() if k in timing_columns} for r in rows('job_runs')]
    reference_columns={'media','seconds','fps','has_audio','name'}
    result['tables']['h3_reference_media']=[{k:v for k,v in r.items() if k in reference_columns} for r in rows('h3_reference_media')]
    avatar_root=Path(avatars) if avatars else Path(database).resolve().parent/'avatars'
    keys={r['avatar'][7:] for r in result['tables']['users'] if (r.get('avatar') or '').startswith('upload:')}
    result['tables']['avatar_files']=[]
    for key in sorted(keys):
        if len(key)!=32 or any(c not in '0123456789abcdef' for c in key):raise SystemExit('旧头像编号无效')
        path=avatar_root/(key+'.webp')
        if not path.is_file():raise SystemExit('缺少已上传头像文件，请使用 --avatars 指定完整目录')
        data=path.read_bytes()
        result['tables']['avatar_files'].append(dict(key=key,size=len(data),sha256=hashlib.sha256(data).hexdigest(),modified=path.stat().st_mtime))
    # Only non-secret model admission and revision settings are migratable.
    allowed={'model_policy','hidden_model_ids','credit_price_revision'}
    result['tables']['model_settings']=[r for r in rows('settings') if r['key'] in allowed]
    state_settings={r['key']:r['value'] for r in rows('settings')}
    if 'workspaces' in tables and 'workspaces_migrated_v1' not in state_settings:raise SystemExit('缺少原工作区迁移编号，请先完成原实例初始化')
    # Only the public enable flag is exported, never the rest of provider config.
    image_enabled=json.loads(state_settings.get('openai_images','{}')).get('enabled',True)
    if type(image_enabled) is not bool:raise SystemExit('旧图片开关无效')
    result['tables']['fm_reward_settings']=[
        {'key':'fmworker_reward_bps','value':int(state_settings['fmworker_reward_bps'])}
    ] if 'fmworker_reward_bps' in state_settings else []
    result['tables']['state_settings']=[]
    if 'workspaces_migrated_v1' in state_settings:
        result['stateVersion']=1
        result['tables']['state_settings']=[{'key':'workspaces_migrated_v1','value':int(state_settings['workspaces_migrated_v1'])},{'key':'image_enabled','value':image_enabled}]
    if 'node_name_sequence' in state_settings:
        result['tables']['state_settings'].append({'key':'node_name_sequence','value':int(state_settings['node_name_sequence'])})
    if 'pairs' in tables:
        # Only reserved numeric labels affect future name allocation. Do not
        # select pair keys, enrollment receipts, or credentials into the export.
        result['tables']['node_pair_names']=[
            {'label':label} for label, in con.execute('SELECT DISTINCT label FROM pairs ORDER BY label')
            if re.fullmatch(r'弗淼[0-9]{1,9}', label or '')
        ]
    # Reusable registration codes are needed for an exact migration. They are opt-in
    # and remain protected by the same 0600 export permissions as password hashes.
    if not include_registration_codes:
        for row in result['tables']['registration_codes']:
            for key in list(row):
                if 'code' in key or 'hash' in key:row.pop(key,None)
    with open(os.open(output,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w') as f:json.dump(result,f,ensure_ascii=False,separators=(',',':'))
    con.close()
    print(json.dumps({k:len(v) for k,v in result['tables'].items()}))
if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--database',required=True)
    p.add_argument('--output',required=True)
    p.add_argument('--source',required=True,help='稳定的实例名称，例如 nvmes-production')
    p.add_argument('--avatars',help='已上传头像目录，默认在源数据库旁的 avatars 中')
    p.add_argument('--objects',help='媒体备份目录，用于保存文件 SHA-256 和纳秒修改时间')
    p.add_argument('--include-registration-codes',action='store_true',help='完整迁移时保留邀请码，导出文件包含可用注册凭据')
    a=p.parse_args()
    export(a.database,a.output,a.source,a.include_registration_codes,a.avatars,a.objects)
