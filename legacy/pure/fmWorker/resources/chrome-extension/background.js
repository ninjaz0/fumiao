'use strict';
const HOST = 'com.nvmes.fmworker';
const FLOW = 'https://flow.google.com/projects';
const FLOW_PATTERNS = ['https://flow.google.com/*', 'https://labs.google/fx/*'];
let port = null, enabled = true, connected = false, reason = 'app_closed';
let queue = Promise.resolve();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function flowTab(open) {
  const tabs = await chrome.tabs.query({url: FLOW_PATTERNS});
  let tab = tabs.find(t => t.active) || tabs[0];
  if (!tab && open) tab = await chrome.tabs.create({url: FLOW, active: true});
  else if (tab && open) await chrome.tabs.update(tab.id, {active: true});
  return tab;
}

async function generationProjectTab(project) {
  const id = String(project || '').replace(/^projects\//, '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const url = 'https://flow.google.com/project/' + id;
  const existing = await chrome.tabs.query({url: url + '*'});
  let tab = existing[0];
  if (!tab) tab = await chrome.tabs.create({url, active: false});
  const ready = await new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return; settled = true;
      clearTimeout(timer); chrome.tabs.onUpdated.removeListener(updated); resolve(value);
    };
    const updated = (tabId, change) => { if (tabId === tab.id && change.status === 'complete') finish(true); };
    const timer = setTimeout(() => finish(false), 15000);
    chrome.tabs.onUpdated.addListener(updated);
    chrome.tabs.get(tab.id).then(value => { if (value.status === 'complete') finish(true); }).catch(() => finish(false));
  });
  return ready ? tab : null;
}

async function identity(tab) {
  if (!tab?.id) return null;
  try {
    const [result] = await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN',
      func: () => ({host: location.hostname, email: String((window.WIZ_global_data || {}).oPEP7c || '').trim().toLowerCase(), ready: document.readyState})});
    const value = result?.result;
    return value && ['flow.google.com', 'labs.google'].includes(value.host) ? value : null;
  } catch { return null; }
}

async function runCommand(command) {
  const expected = String(command.payload?.expected_email || '').trim().toLowerCase();
  if (!expected) return {ok: false, error: 'login_required'};
  if (command.kind === 'open_flow') {
    await flowTab(true);
    return {ok: true};
  }
  if (!['session', 'captcha'].includes(command.kind)) return {ok: false, error: 'unsupported'};
  if (command.kind === 'captcha' && !['IMAGE_GENERATION','VIDEO_GENERATION','UPLOAD_IMAGE'].includes(command.payload?.action))
    return {ok: false, error: 'unsupported'};
  const tab = command.kind === 'captcha' ? await generationProjectTab(command.payload?.project_id) : await flowTab(false);
  if (!tab) return command.kind === 'session' ? {ok: true, connected: false} : {ok: false, error: 'page_unavailable'};
  let who = await identity(tab);
  for (let i = 0; i < 8 && !who?.email; i++) { await delay(500); who = await identity(tab); }
  if (!who?.email) return command.kind === 'session' ? {ok: true, connected: false} : {ok: false, error: 'login_required'};
  if (who.email !== expected) return {ok: false, error: 'wrong_account'};
  if (command.kind === 'session') {
    let cookies;
    try {
      // getAll filters each cookie by its own domain, so a .google.com
      // cookie may be omitted even though Chrome sends it to Flow. The
      // documented per-URL get API reads only these known cookies that
      // apply to our already-authorized Flow URL.
      const requiredNames = ['OSID','__Secure-OSID','SID','HSID','SSID','APISID','SAPISID',
        '__Secure-1PSID','__Secure-3PSID','SIDCC','__Secure-1PSIDCC','__Secure-3PSIDCC',
        '__Secure-1PSIDTS','__Secure-3PSIDTS'];
      const named = await Promise.all(requiredNames.map(name => chrome.cookies.get({url: FLOW, name})));
      const groups = await Promise.all([
        chrome.cookies.getAll({url: FLOW}),
        Promise.resolve(named.filter(Boolean))
      ]);
      const unique = new Map();
      for (const c of groups.flat()) {
        if (['google.com','flow.google.com'].includes(c.domain.replace(/^\./,'')))
          unique.set(JSON.stringify([c.domain,c.path,c.name,c.partitionKey||null]), c);
      }
      cookies = [...unique.values()];
    } catch { return {ok: false, error: 'cookie_read_failed'}; }
    const names = new Set(cookies.map(c => c.name));
    if (!['OSID','__Secure-OSID'].some(n => names.has(n))) return {ok: false, error: 'flow_session_missing'};
    if (!['SID','HSID','SSID','APISID','SAPISID','__Secure-1PSID','__Secure-3PSID'].some(n => names.has(n)))
      return {ok: false, error: 'account_cookies_missing'};
    const sameSite = {no_restriction: 'None', lax: 'Lax', strict: 'Strict'};
    return {ok: true, connected: true, email: who.email, cookies: cookies.filter(c =>
      ['google.com', 'flow.google.com'].includes(c.domain.replace(/^\./, ''))).map(c => ({
        name: c.name, value: c.value, domain: c.domain, path: c.path,
        secure: c.secure, httpOnly: c.httpOnly, hostOnly: c.hostOnly,
        ...(c.expirationDate ? {expires: c.expirationDate} : {}),
        ...(sameSite[c.sameSite] ? {sameSite: sameSite[c.sameSite]} : {})
      }))};
  }
  const action = command.payload?.action;
  if (!['IMAGE_GENERATION', 'VIDEO_GENERATION', 'UPLOAD_IMAGE'].includes(action)) return {ok: false, error: 'unsupported'};
  try {
    const [result] = await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN',
      args: [action, expected], func: async (action, expected) => {
        if (String((window.WIZ_global_data || {}).oPEP7c || '').trim().toLowerCase() !== expected) return null;
        const deadline = Date.now() + 10000;
        while (!window.grecaptcha?.enterprise && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 250));
        if (!window.grecaptcha?.enterprise) return null;
        const source = Array.from(document.scripts).map(s => s.src).find(src => /\/recaptcha\/enterprise\.js/.test(src));
        const render = source ? new URL(source).searchParams.get('render') : '';
        const siteKey = render && /^[\w-]{20,}$/.test(render) ? render : '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';
        const token = await Promise.race([
          new Promise((resolve, reject) => window.grecaptcha.enterprise.ready(() => window.grecaptcha.enterprise.execute(siteKey, {action}).then(resolve, reject))),
          new Promise(resolve => setTimeout(() => resolve(null), 25000))
        ]);
        if (!token) return null;
        return {token, user_agent: navigator.userAgent, accept_language: (navigator.languages || [navigator.language]).join(',')};
      }});
    return typeof result?.result?.token === 'string' ? {ok: true, ...result.result} : {ok: false, error: 'verification_failed'};
  } catch { return {ok: false, error: 'verification_failed'}; }
}

function connect() {
  if (!enabled || port) return;
  const current = chrome.runtime.connectNative(HOST);
  port = current;
  current.onMessage.addListener(message => {
    if (port !== current) return;
    if (message.type === 'status') { connected = !!message.connected; reason = message.reason || ''; }
    if (message.type === 'command' && typeof message.id === 'string') {
      queue = queue.then(async () => {
        let result;
        try { result = await runCommand(message); } catch { result = {ok: false, error: 'page_unavailable'}; }
        if (port === current) current.postMessage({type: 'result', id: message.id, result});
      }).catch(() => {});
    }
  });
  current.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError;
    if (port === current) { port = null; connected = false; reason = error ? 'host_missing' : 'app_closed'; }
  });
  current.postMessage({type: 'hello', version: chrome.runtime.getManifest().version});
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html')) return;
  if (message.type === 'status') { respond({enabled, connected, reason}); return; }
  if (message.type === 'toggle') {
    enabled = !!message.enabled;
    chrome.storage.local.set({enabled});
    if (!enabled && port) { const old = port; port = null; connected = false; old.disconnect(); }
    else connect();
    respond({enabled, connected, reason});
  }
});
chrome.alarms.create('reconnect', {periodInMinutes: 0.5});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'reconnect') connect(); });
chrome.storage.local.get({enabled: true}).then(value => { enabled = value.enabled; connect(); });
