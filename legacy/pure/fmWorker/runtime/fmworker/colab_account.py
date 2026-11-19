"""Read-only account discovery. A catalog entry never promises allocation capacity."""
import json
import math
import time

from google.auth.transport.requests import AuthorizedSession

USER_INFO = 'https://colab.pa.googleapis.com/v1/user-info'
RUNTIME_SPECS = 'https://colaboratory.googleapis.com/v1beta/runtimespecs'
CCU_INFO = 'https://colab.research.google.com/tun/m/ccu-info'
PLAN_INFO = 'https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist'
PLAN_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'
COLAB_HEADERS = {'Accept': 'application/json', 'X-Colab-Client-Agent': 'colab-cli'}


def unknown_plan(status='unknown'):
    return {'id': None, 'name': None, 'status': status, 'source': None}


def empty_account():
    return {'status': 'unknown', 'detail': '', 'checked_at': None,
            'subscription_tier': None, 'google_ai_plan': unknown_plan(),
            'paid_compute_units_balance': None, 'consumption_rate_hourly': None,
            'eligible_accelerators': [], 'source': None}


def number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value if math.isfinite(value) and value >= 0 else None


def payload(response):
    response.raise_for_status()
    raw = response.text
    if raw.startswith(")]}'"): raw = raw.split('\n', 1)[-1]
    value = json.loads(raw)
    if not isinstance(value, dict): raise ValueError('Invalid account response')
    return value


def catalog(value):
    entries = {}
    for key, eligible in [('eligibleAccelerators', True), ('ineligibleAccelerators', False)]:
        rows = value.get(key)
        if not isinstance(rows, list): raise ValueError('Missing accelerator information')
        for row in rows:
            if not isinstance(row, dict): continue
            variant = {'VARIANT_UNSPECIFIED': 'CPU', 'VARIANT_DEFAULT': 'CPU',
                       'VARIANT_GPU': 'GPU', 'VARIANT_TPU': 'TPU'}.get(row.get('variant'))
            if not variant: continue
            models = row.get('models', [])
            if not isinstance(models, list): continue
            if variant == 'CPU': models = ['CPU']
            for model in models:
                if not isinstance(model, str) or not model or not model.replace('_', '').isalnum(): continue
                ident = model.upper()
                entries[ident] = {'id': ident, 'label': ident, 'variant': variant,
                                  'eligible': eligible, 'high_memory': None}
    return list(entries.values())


def runtime_catalog(value):
    rows = value.get('runtimeSpecs')
    if not isinstance(rows, list): raise ValueError('Missing runtime specs')
    entries = []
    for row in rows:
        key = row.get('key', {}) if isinstance(row, dict) else {}
        variant = {'VARIANT_DEFAULT': 'CPU', 'VARIANT_CPU': 'CPU', 'VARIANT_GPU': 'GPU',
                   'VARIANT_TPU': 'TPU'}.get(key.get('variant'))
        model = key.get('accelerator')
        if not variant or not isinstance(model, str): continue
        model = 'CPU' if variant == 'CPU' else model.upper()
        if not model.replace('_', '').isalnum(): continue
        high = key.get('shape') == 'SHAPE_HIGHMEM'
        if key.get('shape') not in ('SHAPE_STANDARD', 'SHAPE_HIGHMEM'): continue
        entries.append({'id': model + ('-HIGH_RAM' if high else ''),
                        'label': model + (' · 高内存' if high else ''), 'variant': variant,
                        'eligible': row.get('eligible') is True, 'high_memory': high})
    return entries


def tunnel_catalog(value):
    """Raw tunnel info exposes entitlements that the CLI's model discards."""
    fields = [('eligibleGpus', 'GPU', True), ('ineligibleGpus', 'GPU', False),
              ('eligibleTpus', 'TPU', True), ('ineligibleTpus', 'TPU', False)]
    if not any(isinstance(value.get(key), list) for key, _, _ in fields):
        return []
    entries = [{'id': 'CPU', 'label': 'CPU · 创建时验证', 'variant': 'CPU',
                'eligible': None, 'high_memory': None}]
    for key, variant, eligible in fields:
        models = value.get(key, [])
        if not isinstance(models, list): raise ValueError('Invalid tunnel accelerator list')
        for model in models:
            if not isinstance(model, str) or not model or not model.replace('_', '').isalnum(): continue
            ident = model.upper()
            entries.append({'id': ident, 'label': ident, 'variant': variant,
                            'eligible': eligible, 'high_memory': None})
    return entries


def parse_plan(value):
    # currentTier can remain free-tier for an Ultra subscriber. Only paidTier is
    # evidence of the Google AI plan; never map standard-tier or CU balance.
    tier = value.get('paidTier')
    if not isinstance(tier, dict) or not isinstance(tier.get('id'), str): return unknown_plan()
    names = {'g1-pro-tier': 'Google AI Pro', 'g1-ultra-lite-tier': 'Google AI Ultra 5x',
             'g1-ultra-tier': 'Google AI Ultra 20x'}
    ident = tier['id'][:120]
    name = names.get(ident)
    if not name: return {'id': ident, 'name': None, 'status': 'unknown', 'source': 'code-assist.paidTier'}
    return {'id': ident, 'name': name, 'status': 'confirmed', 'source': 'code-assist.paidTier'}


class AccountProbe:
    def __init__(self, state, google):
        self.state, self.google = state, google

    def plan(self):
        try: credentials = self.google.plan_credentials()
        except Exception: return unknown_plan('authorization_required')
        if credentials is None: return unknown_plan('authorization_required')
        session = AuthorizedSession(credentials)
        try:
            response = session.post(PLAN_INFO, json={'metadata': {'ideType': 'ANTIGRAVITY'}}, timeout=20)
            if response.status_code in (401, 403):
                self.state.set('google_plan_authorization', {'stage': 'error', 'detail': 'Google 未允许此授权客户端查询套餐；Colab 权益及实例功能不受影响'})
                return unknown_plan('authorization_required')
            result = parse_plan(payload(response))
            self.state.set('google_plan_authorization', {'stage': 'connected', 'detail': '套餐已确认' if result['status'] == 'confirmed' else 'Google 未返回可确认的 Google AI 套餐'})
            return result
        except Exception:
            return unknown_plan()
        finally:
            session.close()

    def run(self):
        previous = self.state.get('colab_account') or empty_account()
        self.state.set('colab_account', previous | {'status': 'loading', 'detail': '正在读取 Colab 权益'})
        result = empty_account()
        result['checked_at'] = time.time()
        session = None
        try:
            session = AuthorizedSession(self.google.credentials())
            value = payload(session.get(USER_INFO, params={'get_ccu_consumption_info': 'true'}, headers=COLAB_HEADERS, timeout=20))
            result['eligible_accelerators'] = catalog(value)
            tier = value.get('subscriptionTier')
            result['subscription_tier'] = tier if isinstance(tier, str) else None
            result['paid_compute_units_balance'] = number(value.get('paidComputeUnitsBalance'))
            result['consumption_rate_hourly'] = number(value.get('consumptionRateHourly'))
            result.update(status='ready', source='colab.user-info', detail='已读取 Colab 权益；实际分配取决于可用容量')
            try:
                specs = runtime_catalog(payload(session.get(RUNTIME_SPECS, headers=COLAB_HEADERS, timeout=15)))
                if specs:
                    result['eligible_accelerators'] = specs
                    result['source'] = 'colab.user-info+runtimespecs'
            except Exception:
                pass  # The public beta requires an allowlisted OAuth project.
        except Exception:
            result.update(status='error', detail='Colab 权益尚未确认，请重试或重新授权；未创建任何实例')
            if session is not None:
                try:
                    usage = payload(session.get(CCU_INFO, params={'authuser': '0'}, headers=COLAB_HEADERS, timeout=15))
                    result['paid_compute_units_balance'] = number(usage.get('currentBalance'))
                    result['consumption_rate_hourly'] = number(usage.get('consumptionRateHourly'))
                    result['source'] = 'colab.ccu-info'
                    result['detail'] = '已读取 CU 余额，但套餐及可用实例尚未确认，请重试权益检测'
                    accelerators = tunnel_catalog(usage)
                    if accelerators:
                        result['eligible_accelerators'] = accelerators
                        result['status'] = 'ready'
                        result['detail'] = '已读取机型权益，订阅待确认；CPU 资格在创建时验证'
                except Exception:
                    pass
        finally:
            if session is not None: session.close()
        result['google_ai_plan'] = self.plan()
        self.state.set('colab_account', result)
        return result
