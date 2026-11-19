"use strict";
const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,image/heic-sequence,image/heif-sequence,image/avif,image/tiff,image/bmp,image/gif,.jpg,.jpeg,.png,.webp,.heic,.heif,.avif,.tif,.tiff,.bmp,.gif";
const app = document.querySelector("#app"),
  modal = document.querySelector("#modal"),
  dialogBody = document.querySelector("#dialog-body");
const paths = {
  chat: "M21 11.5a8 8 0 01-8 8H5l-3 3v-11a8 8 0 018-8h3a8 8 0 018 8zM7 9h9M7 13h6",
  voice: "M9 5a3 3 0 016 0v7a3 3 0 01-6 0V5zM5 10v2a7 7 0 0014 0v-2M12 19v3m-4 0h8",
  link: "M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-2 2 M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l2-2",
  switch: "M5 7h14l-3-3M19 17H5l3 3",
  star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6m4-6v6",
  create: "M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z",
  library: "M3 7h7l2 2h9v10H3z M3 7V5h7l2 2",
  canvas: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  gpu: "M6 6h12v12H6z M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4",
  team: "M3 20v-2a5 5 0 0110 0v2 M17 13a4 4 0 014 4v3 M12 7a4 4 0 11-8 0 4 4 0 018 0z M16 4a3 3 0 010 6",
  drive: "M4 5h16l2 10v4H2v-4z M3 14h18 M16 17h2",
  plus: "M12 5v14 M5 12h14",
  arrow: "M12 19V5 M6 11l6-6 6 6",
  film: "M3 5h18v14H3z M7 5v14m10-14v14 M3 9h4m-4 6h4m10-6h4m-4 6h4",
  sliders: "M4 7h7m5 0h4M4 17h2m5 0h9 M11 4v6m-4 4v6",
  logout: "M9 3H4v18h5 M9 12h12m-5-5 5 5-5 5",
  picture: "M3 4h18v16H3z M4 17l5-5 4 4 3-3 4 4",
  queue: "M4 6h16M4 12h12M4 18h8",
  sun: "M12 8a4 4 0 100 8 4 4 0 000-8z M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M19 5l-1.5 1.5m-11 11L5 19",
  moon: "M20 14.4A8.4 8.4 0 019.6 4a8.5 8.5 0 1010.4 10.4z",
  account: "M20 21v-2a7 7 0 00-14 0v2M12 3a4 4 0 110 8 4 4 0 010-8z",
  close: "m6 6 12 12M18 6 6 18",
  chevron: "m7 10 5 4 5-4",
  back: "M20 12H4m6-6-6 6 6 6",
  sidebar: "M4 5h16v14H4zM14 5v14",
  model: "m12 3 8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9",
  clock: "M12 8v4l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  download: "M12 3v12m-5-5 5 5 5-5M4 20h16",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  edit: "m15 4 5 5-11 11H4v-5zM13 6l5 5",
  repeat: "M20 7h-6l3-4M4 17h6l-3 4M20 7a9 9 0 00-15 0M4 17a9 9 0 0015 0",
  check: "m5 12 4 4L19 6",
  at: "M16 8v6a2 2 0 004 0v-2a8 8 0 10-4 7M16 12a4 4 0 11-8 0 4 4 0 018 0",
  frame: "M3 7h18v10H3z",
  play: "m9 5 10 7-10 7z",
  pause: "M8 5v14M16 5v14",
  volume: "M4 9h4l5-4v14l-5-4H4zM16 8a6 6 0 010 8m3-11a10 10 0 010 14",
  muted: "M4 9h4l5-4v14l-5-4H4zM17 9l5 6m0-6-5 6",
  settings:
    "M10 2h4l.8 3.1 1.7 1 3.1-.9 2 3.5-2.4 2.1v2.4l2.4 2.1-2 3.5-3.1-.9-1.7 1L14 22h-4l-.8-3.1-1.7-1-3.1.9-2-3.5 2.4-2.1v-2.4L2.4 8.7l2-3.5 3.1.9 1.7-1zM15.5 12a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0z",
  fullscreen: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
};
const ic = (k) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[k]}"/></svg>`;
const brand = `<span class="brand"><img src="/static/mark.svg" alt=""><span>弗淼 <b>AIGC</b></span></span>`;
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let workspaceId = new URLSearchParams(location.search).get("workspace");
let state = null,
  page = "home",
  libraryTab = "videos",
  libraryScope = "history",
  selectingAssets = false,
  referencePicking = null,
  selectedAssets = new Set(),
  libraryBusy = false,
  downloadBusy = false,
  refs = [],
  parent = null,
  retainedSeed = null,
  suspendedImageDraft = null,
  submitId = crypto.randomUUID(),
  draft = { audioModel:"breeze-tts-2", voiceDescription:"", kind: "video", videoModel: "MiniMax H3", prompt: "", ratio: "16:9", quality: "480", seconds: "5", sampling_steps: 20, fast_mode: false, seed: "", model: "", imageQuality: "medium", resolution: "1K" },
  toastTimer,
  editingUpload = false,
  revisionPending = false;
let stateReceivedAt = Date.now() / 1000;
let estimateKey = "", estimateSerial = 0, estimateRequestedAt = 0, estimateTimer = null, draftEstimate = null;
// Registration extends the established login surface: brand/ribbons left, compact form right.
// Operate: users enter credentials and a reusable code; administrators set expiry, personal credits and one team.
// FIRST VIEWPORT: single-column fields, black primary action and a direct login/register switch; mobile stacks the existing brand panel.
// FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
let authMode = 'login', retiredInvite = false;
function readAuthLocation() {
  authMode = location.hash === '#register' ? 'register' : 'login';
  retiredInvite = new URLSearchParams(location.hash.slice(1)).has('invite');
  if (retiredInvite) history.replaceState(null, '', location.pathname + location.search);
}
sessionStorage.removeItem('fm-invite');
readAuthLocation();
window.addEventListener('hashchange', () => {
  readAuthLocation();
  if (!state) auth();
});
function notify(message) {
  const el = document.querySelector("#toast");
  el.textContent = message;
  el.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("visible"), 4200);
}
async function req(
  path,
  body,
  method = body === undefined ? "GET" : "POST",
  raw = false,
) {
  const r = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      ...(body === undefined || raw ? {} : { "Content-Type": "application/json" }),
      ...(workspaceId ? {"X-Workspace-Id": String(workspaceId)} : {}),
      ...(raw && body?.name ? {"X-File-Name":encodeURIComponent(body.name)} : {}),
    },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  let data;
  try {
    data = await r.json();
  } catch {
    data = {};
  }
  if (!r.ok) {
    let msg = data.detail;
    throw Object.assign(
      new Error(typeof msg === "string" ? msg : "请求未完成，请检查输入后重试"),
      { status: r.status },
    );
  }
  return data;
}
let modalSettling = false, modalClosePromise = null, resolveModalClose = null;
let modalReturnFocus = null, pageRenderPending = false;
function showModal(html) {
  window.FumiaoChat?.unmountPacks?.();
  if (!modal.open) {
    const focused = document.activeElement;
    modalReturnFocus = focused?.closest('#popover') ? document.querySelector('.workspace-switch') : focused;
  }
  // A menu must not retain an invisible hit area or become the dialog's return target.
  closeMenu();
  popover.hidden = true;
  popover.innerHTML = "";
  dialogBody.innerHTML = html;
  const heading = dialogBody.querySelector("h2");
  if (heading) {
    heading.id = "modal-heading";
    modal.setAttribute("aria-labelledby", heading.id);
  }
  if (!modal.open) modal.showModal();
}
function beginModalClose() {
  modalSettling = true;
  if (!modalClosePromise) modalClosePromise = new Promise(resolve => { resolveModalClose = resolve; });
  return modalClosePromise;
}
function closeModal() {
  window.FumiaoChat?.unmountPacks?.();
  if (!modal.open) return modalClosePromise || Promise.resolve();
  const pending = beginModalClose();
  modal.close();
  return pending;
}
modal.addEventListener("cancel", beginModalClose);
modal.addEventListener("close", () => {
  modalSettling = true;
  requestAnimationFrame(() => {
    modalSettling = false;
    const done = resolveModalClose;
    resolveModalClose = null; modalClosePromise = null;
    if (!modal.open) {
      if (pageRenderPending && state) renderPage(false);
      const target = modalReturnFocus?.isConnected && modalReturnFocus.getClientRects().length
        ? modalReturnFocus : document.querySelector('.workspace-switch');
      target?.focus({preventScroll:true});
    }
    done?.();
  });
});
document.querySelector("#close-modal").onclick = closeModal;
modal.addEventListener("click", (e) => {
  if (e.target === modal && !dialogBody.contains(e.target)) {
    const r = modal.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      closeModal();
  }
});
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    notify("已复制");
  } catch {
    notify("请选中内容后手动复制");
  }
}
function confirmAction(title, summary, action) {
  showModal(
    `<h2>${esc(title)}</h2><p>${esc(summary)}</p><div class="buttons"><button id="confirm" class="primary">确定</button><button id="back" class="ghost">取消</button></div>`,
  );
  dialogBody.querySelector("#back").onclick = closeModal;
  dialogBody.querySelector("#confirm").onclick = async (e) => {
    e.target.disabled = true;
    try {
      await action();
      closeModal();
      await sync(true);
    } catch (x) {
      notify(x.message);
      e.target.disabled = false;
    }
  };
}
function auth() {
  const registering = authMode === "register";
  if (state) persist();
  state = null;
  draft = {...draft, prompt:"", seed:"", packs:[]}; refs=[]; parent=null; retainedSeed=null;
  suspendedImageDraft=null; submitId=crypto.randomUUID(); savedRange=null;
  const ribbons = Array.from(
    { length: 54 },
    (_, i) =>
      `<path d="M-80 ${255 + i * 3.6} C 80 ${166 + i * 4.7}, 130 ${390 - i * 3.2}, 246 ${230 - i * 2.1} S 410 ${70 + i * 3.5}, 565 ${90 + i * 3.7}"/>`,
  ).join("");
  app.innerHTML = `<div class="auth"><header class="auth-top">${themeButton()}</header>
    <main class="auth-body"><section class="auth-wrap">
      <div class="auth-art"><a class="auth-home" href="/" title="网站首页" aria-label="弗淼 AIGC 网站首页">${brand}</a>
        <svg class="ribbon" viewBox="0 0 480 450" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <defs><linearGradient id="auth-thread"><stop class="ribbon-start"/><stop offset=".46" class="ribbon-middle"/><stop offset="1" class="ribbon-end"/></linearGradient></defs>
          <g stroke="url(#auth-thread)" stroke-width="1.7" fill="none">${ribbons}</g>
        </svg>
      </div>
      <form class="auth-form ${registering ? 'auth-register' : ''}">
      <h1>${registering ? "注册账户" : "登录工作台"}</h1>
      <label class="formlabel">用户名<input required name="user" autocomplete="username" minlength="${registering ? 2 : 1}" maxlength="32" ${registering ? 'placeholder="2–32 位中英文、数字或 _ . -"' : ''}></label>
      ${registering ? '<label class="formlabel">昵称<input required name="nickname" autocomplete="nickname" maxlength="40" placeholder="在工作台显示的名字"></label>' : ''}
      <label class="formlabel">密码<input required name="pw" type="password" minlength="${registering ? 10 : 1}" maxlength="200" autocomplete="${registering ? "new-password" : "current-password"}" placeholder="${registering ? "至少 10 位" : ""}"></label>
      ${registering ? '<label class="formlabel">邀请码<input required name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="64" placeholder="请填写邀请码"></label>' : ''}
      <div class="authnote" role="alert">${retiredInvite ? '邀请链接已停用，请向管理员获取邀请码后注册。' : ''}</div>
      <button class="primary" type="submit">${registering ? "注册并登录" : "登录"}</button>
      <p class="auth-switch">${registering ? '已有账户？' : '还没有账户？'}<a href="${registering ? '#login' : '#register'}" id="auth-switch">${registering ? '登录' : '注册'}</a></p>
    </form></section></main></div>`;
  const form = app.querySelector("form");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector(".primary");
    btn.disabled = true;
    btn.textContent = registering ? '正在注册…' : '正在登录…';
    form.querySelector('.authnote').textContent = '';
    try {
      await req(registering ? "/api/register" : "/api/login", {
        name: form.elements.user.value.trim(),
        password: form.elements.pw.value,
        ...(registering ? {nickname: form.elements.nickname.value.trim(), code: form.elements.code.value.trim()} : {}),
      });
      authMode = 'login'; workspaceId = null;
      history.replaceState(null, '', location.pathname);
      await sync(true);
    } catch (x) {
      form.querySelector(".authnote").textContent = x.message;
    } finally {
      btn.disabled = false;
      btn.textContent = registering ? '注册并登录' : '登录';
    }
  };
  document.querySelector('#auth-switch').onclick = e => {
    e.preventDefault();
    authMode = registering ? 'login' : 'register';
    retiredInvite = false;
    history.replaceState(null, '', '#' + authMode);
    auth();
    app.querySelector('[name=user]').focus();
  };

}

const labels = {
  queued: "排队中",
  running: "生成中",
  done: "已完成",
  failed: "生成失败",
  cancelled: "已取消",
  preparing: "准备模型",
  ready: "就绪",
  busy: "生成中",
  error: "准备失败",
  offline: "离线",
};
const navItems = {
  home: ["创作", "create"],
  canvas: ["画布", "canvas"],
  chat: ["对话", "chat"],
  library: ["资产", "library"],
  queue: ["任务队列", "queue"],
};
let settingsTab = "profile";
let profileDraft = null;
const narrowSidebar = matchMedia("(max-width:760px)");
let collapsed =
  narrowSidebar.matches || localStorage.getItem("fm-sidebar") === "collapsed";
let detailId = null,
  detailEditing = false,
  imageId = null,
  composer = null,
  composerResizeObserver = null;
let menuKind = null,
  menuAnchor = null,
  menuSerial = 0,
  savedRange = null;
let assetScroll = 0,
  refreshing = null,
  refreshForced = false,
  uploadBusy = false;
const popover = document.createElement("div");
popover.id = "popover";
popover.hidden = true;
document.body.appendChild(popover);
const gb = (value) => (value / 1e9).toFixed(1);
const mediaURL = (key) => "/media/" + key;
const chevron = () =>
  `<svg class="chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="m2.5 4.5 3.5 3 3.5-3"/></svg>`;
function themeButton() {
  const dark = document.documentElement.dataset.theme === "dark";
  return `<button class="appearance icon-button" data-act="theme" aria-label="切换外观" aria-pressed="${dark}" title="${dark ? "浅色模式" : "深色模式"}"><span class="light-icon">${ic("moon")}</span><span class="dark-icon">${ic("sun")}</span></button>`;
}
function applySidebar() {
  const shell = document.querySelector(".shell");
  if (!shell) return;
  shell.classList.toggle("collapsed", collapsed);
  const home = shell.querySelector(".brand-button");
  home.tabIndex = collapsed ? -1 : 0;
  home.setAttribute("aria-hidden", String(collapsed));
  shell.querySelector(".collapse-button").disabled = collapsed;
  shell.querySelector(".expand-button").disabled = !collapsed;
}
narrowSidebar.addEventListener("change", (event) => {
  if (event.matches) {
    collapsed = true;
    applySidebar();
    closeMenu();
  }
});
function currentWorkspace() { return state.workspaces.find(w => w.id === state.workspace_id); }
function workspaceBadge(space) {
  return space.kind === "personal"
    ? `<span class="space-badge personal" aria-hidden="true">${esc([...displayName(state.me)][0] || "用")}</span>`
    : `<span class="space-badge team" aria-hidden="true">${ic("team")}</span>`;
}
function workspaceButton() {
  const space = currentWorkspace();
  return `<button class="workspace-switch" data-menu="workspaces" aria-label="切换工作区，当前${esc(space.name)}" aria-haspopup="dialog" aria-expanded="false" title="${esc(space.name)}">${workspaceBadge(space)}<span class="space-button-name nav-label">${esc(space.name)}</span><span class="space-switch-icon nav-label">${ic("switch")}</span></button>`;
}
function workspaceButtonElement() {
  const box = document.createElement('div'); box.innerHTML = workspaceButton(); return box.firstElementChild;
}
function workspaceMenu() {
  const personal = state.workspaces.find(w => w.kind === "personal");
  const teams = state.workspaces.filter(w => w.kind === "team");
  const option = space => `<button type="button" role="option" aria-selected="${space.id === state.workspace_id}" class="space-option" data-act="switch-workspace" data-id="${space.id}">${workspaceBadge(space)}<span class="space-option-name"><strong>${esc(space.kind === "personal" ? displayName(state.me) : space.name)}</strong><small>${space.kind === "personal" ? "仅自己可见" : "团队成员可见"}</small></span>${space.id === state.workspace_id ? ic("check") : '<span class="space-check-slot"></span>'}</button>`;
  return `<div class="space-menu-label">个人空间</div><div role="listbox" aria-label="个人空间">${option(personal)}</div><div class="space-menu-label space-team-label"><span>团队空间</span>${state.me.role === "admin" ? `<button class="space-create" data-act="create-workspace">${ic("plus")}创建团队</button>` : ""}</div><div class="space-team-options" role="listbox" aria-label="团队空间">${teams.map(option).join("") || '<p class="space-empty">尚未加入团队空间</p>'}</div>`;
}
function workspacesView() {
  const teams = state.workspaces.filter(w => w.kind === 'team');
  return `<section class="management-view"><div class="page-heading"><h2>团队空间</h2><button class="primary" data-act="create-workspace">${ic('plus')}创建团队</button></div><div class="list-surface">${teams.map(w => `<div class="workspace-row">${workspaceBadge(w)}<div class="workspace-row-name"><strong>${esc(w.name)}</strong><span>${w.member_count} 位成员</span></div><button class="quiet-button" data-act="edit-workspace" data-id="${w.id}">管理成员</button><button class="quiet-button" data-act="switch-workspace" data-id="${w.id}">进入</button></div>`).join('') || '<p class="empty-note">还没有团队空间</p>'}</div></section>`;
}
function workspaceDialog(space = null) {
  if (state.me.role !== 'admin') return;
  const members = state.users.filter(u => u.active);
  showModal(`<form id="workspace-form"><h2>${space ? '管理团队空间' : '创建团队空间'}</h2><label class="formlabel">团队名称<input name="name" required maxlength="40" value="${esc(space?.name || '')}" placeholder="输入团队名称" autocomplete="off"></label><div class="workspace-member-heading"><span>团队成员</span><span id="workspace-member-count"></span></div><input class="workspace-member-search" type="search" placeholder="搜索成员" aria-label="搜索团队成员"><div class="workspace-member-picker">${members.map(u => `<label class="workspace-member-choice" data-search="${esc((displayName(u)+' '+u.name).toLowerCase())}"><input type="checkbox" name="member" value="${u.id}" ${space?.members?.includes(u.id) ? 'checked' : ''}>${avatarImage(u)}<span><strong>${esc(displayName(u))}</strong>${displayName(u) !== u.name ? `<small>${esc(u.name)}</small>` : ""}</span></label>`).join('')}<p class="space-empty" id="workspace-no-match" hidden>没有找到成员</p></div><p class="workspace-access-note">管理员无需加入即可访问</p><p class="form-message" role="alert"></p><div class="workspace-dialog-actions"><button type="button" class="quiet-button" data-act="close">取消</button><button class="primary" type="submit">${space ? '保存' : '创建'}</button></div></form>`);
  const form = dialogBody.querySelector('form');
  const count = () => { form.querySelector('#workspace-member-count').textContent = `已选 ${form.querySelectorAll('[name=member]:checked').length} 人`; };
  count(); form.onchange = count;
  form.querySelector('[type=search]').oninput = event => {
    const value = event.target.value.trim().toLowerCase(); let shown = 0;
    for (const row of form.querySelectorAll('.workspace-member-choice')) { row.hidden = !row.dataset.search.includes(value); if (!row.hidden) shown++; }
    form.querySelector('#workspace-no-match').hidden = Boolean(shown);
  };
  form.onsubmit = async event => {
    event.preventDefault(); const button = form.querySelector('[type=submit]'); button.disabled = true;
    try {
      const body = {name:form.elements.name.value.trim(),members:[...form.querySelectorAll('[name=member]:checked')].map(n => Number(n.value))};
      if (space) body.expected_revision = space.revision;
      await req(space ? '/api/workspaces/'+space.id : '/api/workspaces', body, space ? 'PATCH' : 'POST');
      await closeModal(); await sync(true); notify(space ? '团队已更新' : '团队已创建');
    } catch (error) { form.querySelector('.form-message').textContent = error.message; }
    finally { button.disabled = false; }
  };
}

function mountShell() {
  app.innerHTML = `<div class="shell ${collapsed ? "collapsed" : ""}">
    <aside class="side">
      <div class="side-head">
        <button class="brand-button" data-nav="home" aria-label="去首页" tabindex="${collapsed ? -1 : 0}" aria-hidden="${collapsed}">${brand}</button>
        <button class="icon-button collapse-button" data-act="collapse" aria-label="收起侧边栏" aria-expanded="true" ${collapsed ? "disabled" : ""}>${ic("sidebar")}</button>
        <button class="icon-button expand-button" data-act="collapse" aria-label="展开侧边栏" aria-expanded="false" ${collapsed ? "" : "disabled"}><span class="collapse-glyph">${ic("sidebar")}</span></button>
      </div>
      ${workspaceButton()}
      <nav aria-label="主导航">${Object.entries(navItems)
        .filter(([key]) => key !== "team" || state.me.role === "admin")
        .map(
          ([key, [text, icon]]) =>
            `<button data-nav="${key}" title="${text}" class="${page === key ? "active" : ""}">${ic(icon)}<span class="nav-label">${text}</span></button>`,
        )
        .join("")}</nav>
      <div class="side-bottom"><button class="account" data-menu="account" aria-label="账户" title="${esc(displayName(state.me))}">${avatarImage(state.me, true)}<span class="nav-label" data-current-name>${esc(displayName(state.me))}</span></button></div>
    </aside><button class="rail-backdrop" data-act="collapse" aria-label="关闭导航" tabindex="-1"></button>
    <div class="workspace"><header class="topbar" aria-hidden="true"></header><main id="view"></main></div>
  </div>`;
  composerResizeObserver?.disconnect();
  composer = buildComposer();
  composerResizeObserver = new ResizeObserver(updateComposerSpace);
  composerResizeObserver.observe(composer);
  renderPage();
}
function updateComposerSpace() {
  if (!composer?.isConnected) return;
  document.querySelector('.shell')?.style.setProperty('--composer-height', Math.ceil(composer.getBoundingClientRect().height) + 'px');
}
function restoreDraft() {
  try {
    const key = "fm-draft-" + state.me.id + "-workspace-" + state.workspace_id;
    const legacyKey = "fm-draft-" + state.me.id;
    if (!sessionStorage.getItem(key) && state.workspace_id === state.legacy_workspace_id && sessionStorage.getItem(legacyKey)) {
      sessionStorage.setItem(key,sessionStorage.getItem(legacyKey)); sessionStorage.removeItem(legacyKey);
    }
    const saved = JSON.parse(sessionStorage.getItem(key));
    if (saved) {
      Object.assign(draft, saved.draft);
      draft.kind = ["image","audio"].includes(draft.kind) ? draft.kind : "video";
      if (!state.images.models[draft.model]) draft.model = state.images.default_model;
      if (!["1K", "2K"].includes(draft.resolution)) draft.resolution = "1K";
      if (!["low", "medium", "high"].includes(draft.imageQuality)) draft.imageQuality = "medium";
      if (!state.ratios.includes(draft.ratio)) draft.ratio = "16:9";
      if (!["480", "768"].includes(String(draft.quality)))
        draft.quality = "480";
      if (!isMuse() && !["5", "10", "15"].includes(String(draft.seconds)))
        draft.seconds = "5";
      refs = saved.refs.filter((key) => state.assets.some((a) => a.id === key));
      parent = saved.parent;
      retainedSeed = saved.retainedSeed;
      submitId = saved.submitId || crypto.randomUUID();
      suspendedImageDraft = saved.suspendedImageDraft || null;
      if (!state.video_models?.[draft.videoModel]) draft.videoModel = "MiniMax H3";
      normalizeModelParams();
    }
  } catch {}
}
function persist() {
  sessionStorage.setItem(
    "fm-draft-" + state.me.id + "-workspace-" + state.workspace_id,
    JSON.stringify({ draft, refs, parent, retainedSeed, submitId, suspendedImageDraft }),
  );
}

// H3 follows the existing neutral Jimeng-style composer: a mode control beside the
// model, fixed frame slots, and a compact reference strip; no new visual shell.
function isH3(j=draft) { return selectedModel(j)==='MiniMax H3' && !isImage(j) && !isAudio(j); }
function h3Options(j=draft) {
  const v=j===draft?draft.h3:j.h3_inputs;
  if(v?.mode) return {mode:v.mode,first_frame:v.first_frame||null,last_frame:v.last_frame||null,video_audio:v.video_audio||[]};
  // Existing single-image jobs retain their original first-frame behavior.
  if(j!==draft && j.refs?.length===1)return {mode:'frames',first_frame:j.refs[0],last_frame:null,video_audio:[]};
  return {mode:'reference',first_frame:null,last_frame:null,video_audio:[]};
}
function h3Frames() { return isH3() && h3Options().mode==='frames'; }
function referenceAsset(key) { return state.assets.find(a=>a.id===key) || {}; }
function referenceType(key) { return ({ref_video:'Video',ref_audio:'Audio'})[referenceAsset(key).kind] || 'Picture'; }
function referenceIndex(key, keys=refs) { return keys.filter(k=>referenceType(k)===referenceType(key)).indexOf(key)+1; }
function referenceLabel(key, keys=refs) { return ({Picture:'图片',Video:'视频',Audio:'音频'})[referenceType(key)]+referenceIndex(key,keys); }
function referenceMedia(key, controls=false) {
  const type=referenceType(key),url=mediaURL(key);
  return type==='Picture'?`<img src="${url}" alt="">`:type==='Video'?`<video src="${url}#t=0.1" preload="metadata" ${controls?'controls':'muted'} playsinline></video>`:controls?`<audio src="${url}" controls></audio>`:`<span class="h3-audio-thumb">${ic('voice')}</span>`;
}
function activeReferences() { return h3Frames()?[...new Set([h3Options().first_frame,h3Options().last_frame].filter(Boolean))]:refs; }
function h3InputIssue(j=draft) {
  const keys=j===draft?packReferences():j.refs||[];
  if(!isH3(j))return !isAudio(j)&&keys.some(k=>referenceType(k)!=='Picture')?'这个模型只接收图片，请移除视频和音频参考':'';
  const options=h3Options(j);
  if(options.mode==='frames') {
    const frames=[options.first_frame,options.last_frame].filter(Boolean).map(referenceAsset);
    if(frames.length===2 && frames.every(a=>a.w&&a.h) && Math.abs(Math.log((frames[0].w/frames[0].h)/(frames[1].w/frames[1].h)))>.035)return '请使用比例相同的首尾帧图片';
    return '';
  }
  if(keys.length>12)return '最多选择 12 个参考素材';
  for(const [type,max,label] of [['Picture',9,'图片'],['Video',3,'视频'],['Audio',3,'音频']]) {
    const files=keys.filter(k=>referenceType(k)===type).map(referenceAsset);
    if(files.length>max)return `最多选择 ${max} 个${label}参考`;
    if(type!=='Picture' && files.reduce((n,a)=>n+(a.seconds||0),0)>15.05)return `参考${label}总时长不能超过 15 秒`;
    if(type==='Video'&&files.some(a=>a.seconds>Number(j.seconds)+.05))return '生成时长不能短于参考视频，请调整时长';
  }
  return '';
}
let h3UploadSlot=null;
function setH3Mode(mode) {
  if(uploadBusy)return;
  const old=h3Options();if(old.mode===mode)return;
  draft.prompt=serializePrompt();
  if(mode==='frames') {
    draft.h3ReferenceDraft={refs:[...refs],prompt:draft.prompt,packs:draft.packs||[],video_audio:old.video_audio};
    const images=packReferences().filter(k=>referenceType(k)==='Picture');
    draft.h3={mode,first_frame:images[0]||null,last_frame:null,video_audio:[]};
    if(images[1]) {const a=referenceAsset(images[0]),b=referenceAsset(images[1]);if(Math.abs(Math.log((a.w/a.h)/(b.w/b.h)))<=.035)draft.h3.last_frame=images[1];}
    draft.prompt=draft.prompt.replace(/<(Picture|Video|Audio) (\d+)>/g,(m,type,n)=>type==='Picture'&&Number(n)===1?'首帧':type==='Picture'&&Number(n)===2&&draft.h3.last_frame?'尾帧':'');
    draft.packs=[];
  } else {
    const frames=activeReferences(),saved=draft.h3ReferenceDraft;
    refs=[...new Set([...(saved?.refs||refs),...frames])].filter(k=>state.assets.some(a=>a.id===k));
    draft.h3={mode:'reference',video_audio:saved?.video_audio||[]};
    // Return the reference text only if the frame prompt has not been edited.
    if(draft.prompt===draft.h3FrameInitialPrompt && saved)draft.prompt=saved.prompt;
    draft.packs=saved?.packs||[];
    delete draft.h3ReferenceDraft;
  }
  draft.h3FrameInitialPrompt=draft.prompt;
  savedRange=null;renderEditor();submitId=crypto.randomUUID();persist();updateComposerControls();closeMenu(true);
}
function assignH3Frame(key,slot=h3UploadSlot) {
  if(referenceType(key)!=='Picture')throw new Error('首尾帧只接收图片');
  const options=h3Options();slot=slot||(!options.first_frame?'first_frame':!options.last_frame?'last_frame':null);
  if(!slot)throw new Error('两个帧位置已填满，请先移除或替换图片');
  const other=referenceAsset(options[slot==='first_frame'?'last_frame':'first_frame']),next=referenceAsset(key);
  if(other.w&&next.w&&Math.abs(Math.log((other.w/other.h)/(next.w/next.h)))>.035)throw new Error('请上传比例相同的首尾帧图片');
  draft.h3={...options,[slot]:key};h3UploadSlot=null;
}
function paintReferenceInputs(box) {
  const host=box.querySelector('.composer-references');host.hidden=isAudio();
  host.classList.toggle('has-frames',h3Frames());
  if(isAudio())return;
  let html;
  if(h3Frames()) {
    const options=h3Options();
    const slot=(key,label)=>`<div class="h3-frame"><button class="h3-frame-preview" data-act="${options[key]?'h3-preview':'h3-upload'}" data-slot="${key}" data-key="${options[key]||''}" aria-label="${options[key]?'预览':'上传'}${label}">${options[key]?referenceMedia(options[key]):ic('plus')}<span>${label}</span></button>${options[key]?`<button class="h3-remove" data-act="h3-remove-frame" data-slot="${key}" aria-label="移除${label}">${ic('close')}</button>`:''}</div>`;
    html=`<div class="h3-frame-pair">${slot('first_frame','首帧')}<button class="h3-swap icon-button" data-act="h3-swap" aria-label="交换首尾帧" ${!options.first_frame&&!options.last_frame?'disabled':''}>${ic('switch')}</button>${slot('last_frame','尾帧')}</div>`;
  } else {
    const selected=packReferences(),layers=selected.slice(0,3);
    html=selected.length
      ? `<button class="reference-deck" data-act="reference" aria-label="管理参考内容，已添加 ${selected.length} 个素材" aria-haspopup="dialog" aria-expanded="${menuKind==='references'}" title="已添加 ${selected.length} 个素材，点击管理">${layers.slice().reverse().map((key,i)=>`<span class="reference-layer" style="--depth:${layers.length-i-1}" aria-hidden="true">${referenceMedia(key)}${i===layers.length-1?'<span class="reference-layer-label">参考内容</span>':''}</span>`).join('')}<span class="reference-deck-count" aria-hidden="true">${selected.length}</span></button>`
      : `<button class="reference-deck" data-act="reference" aria-label="添加参考内容" aria-haspopup="dialog" aria-expanded="${menuKind==='references'}"><span class="reference-deck-empty">${ic('plus')}<small>参考内容</small></span></button>`;
  }
  const anchorWasHere=menuKind==='references'&&host.contains(menuAnchor);
  if(host.innerHTML!==html)host.innerHTML=html;
  if(anchorWasHere){menuAnchor=host.querySelector('[data-act=reference]');menuAnchor?.setAttribute('aria-expanded','true');}
  host.setAttribute('aria-busy',String(uploadBusy));
}

function isImage(j = draft) { return j.kind === "image"; }
function isAudio(j = draft) { return j.kind === "audio"; }
function kindLabel(j) { return isAudio(j)?"语音":isImage(j)?"图片":"视频"; }
function modelsForKind() { return isAudio() ? state.audio_models || {} : isImage() ? state.images.models : state.video_models || {"MiniMax H3":"MiniMax H3","muse-video":"Muse"}; }
function promptLimit() { return isAudio()?300:12000; }
function selectedModel(j = draft) { return j === draft ? (isAudio() ? draft.audioModel : isImage() ? draft.model : draft.videoModel) || "" : j.model || (isImage(j) ? state.images.default_model : "MiniMax H3"); }
function isMuse(j = draft) { return ["muse-image","muse-video"].includes(selectedModel(j)); }
function flowSpec(j=draft) { const spec=state.model_catalog?.[selectedModel(j)];return spec?.provider==='flow'?spec:null; }
function flowOptions() { return FlowPicker.options(state.model_catalog || {},selectedModel(),modelAvailable); }
function composerModelLabel() { return selectedModel()?FlowPicker.label(state.model_catalog || {},selectedModel()):'无模型'; }
function setFlowParams(patch) {
  const spec=flowSpec();if(!spec?.family)return false;
  const model=FlowPicker.resolve(state.model_catalog,selectedModel(),modelAvailable,{ratio:draft.ratio,seconds:Number(draft.seconds),mode:spec.mode,...patch});
  if(!model)return false;
  if(state.model_catalog[model].ratio!==draft.ratio)draft.flowSourceJob=null;
  draft.videoModel=model;normalizeModelParams();return true;
}
function flowInputIssue(j=draft) {
  const spec=flowSpec(j);if(!spec)return '';
  const count=j===draft?packReferences().length:j.refs.length;
  if(count<spec.min_refs)return `请添加至少 ${spec.min_refs} 张参考图片`;
  if(count>spec.max_refs)return spec.max_refs?`这个模型最多接收 ${spec.max_refs} 张参考图片`:'这个模型不接收参考图片，请移除参考图或选择图生视频模型';
  if(spec.mode==='extend' && !(j===draft?draft.flowSourceJob:j.actual?.flow_source_job))return '请选择来源视频';
  return '';
}
function modelAvailable(model) {
  if (!model || (state.model_access || state.model_policy?.enabled)?.[model] !== true) return false;
  if (["gpt-image-2.6-sunburst","muse-image"].includes(model) && !state.images.enabled) return false;
  if(state.model_catalog?.[model]?.provider==='flow')return Boolean(state.flow?.configured);
  return model !== "gpt-image-2.6-sunburst" || state.images.configured;
}
function imagesAvailable() { return Object.keys(state.images.models).some(modelAvailable); }
function videosAvailable() { return Object.keys(state.video_models || {"MiniMax H3":"MiniMax H3","muse-video":"Muse"}).some(modelAvailable); }
function canEditJob(j) { return isAudio(j) ? Object.keys(state.audio_models || {}).some(modelAvailable) : isImage(j) ? imagesAvailable() : videosAvailable(); }
function normalizedSteps(value) { return [16,20,32,50].includes(Number(value)) ? Number(value) : 20; }
function effectiveSteps(value = draft) { return value.fast_mode === true || Number(value.sampling_steps) === 4 ? 4 : normalizedSteps(value.sampling_steps); }
function normalizeModelParams() {
  const spec=flowSpec();
  if(spec){draft.ratio=spec.ratio;draft.seconds=String(spec.seconds);draft.resolution=spec.resolution==='原生'?'1K':spec.resolution;draft.imageQuality='medium';draft.seed='';draft.fast_mode=false;draft.sampling_steps=20;if(spec.mode!=='extend')draft.flowSourceJob=null;return;}
  draft.flowSourceJob=null;
  if(!["1K","2K"].includes(draft.resolution))draft.resolution="1K";
  draft.fast_mode = draft.fast_mode === true || Number(draft.sampling_steps) === 4;
  draft.sampling_steps = normalizedSteps(draft.sampling_steps);
  if (isAudio()) { if (Number(draft.seed)>4294967295) draft.seed="";return; }
  const allowed = isMuse() ? (isImage() ? ["1:1","16:9","9:16","4:3","3:4"] : ["16:9","9:16"]) : state.ratios;
  if (!allowed.includes(draft.ratio)) draft.ratio = "16:9";
  if (!isMuse()) {
    if (!["480","768"].includes(String(draft.quality))) draft.quality = "480";
    if (!["low","medium","high"].includes(draft.imageQuality)) draft.imageQuality = "medium";
  }
  if (!isImage()) {
    const seconds = isMuse() ? ["5","6","8","10"] : ["5","10","15"];
    if (!seconds.includes(String(draft.seconds))) draft.seconds = isMuse() ? "6" : "5";
  }
}
function generationDisabled(j) { return !modelAvailable(selectedModel(j)); }
function ensureModelSelection() {
  const candidates = Object.keys(modelsForKind()).filter(modelAvailable);
  if (!candidates.includes(selectedModel())) {
    if (isAudio()) draft.audioModel = candidates[0] || "";
    else if (isImage()) draft.model = candidates[0] || "";
    else { draft.videoModel = candidates[0] || ""; if (draft.videoModel === "muse-video") draft.seconds = "6"; }
    normalizeModelParams(); submitId=crypto.randomUUID(); persist();
  }
}
function syncImageAvailability() {
  ensureModelSelection();
  updateComposerControls();
  for (const button of document.querySelectorAll('[data-act="edit"], [data-act="again"]')) {
    const job = state.jobs.find(j => j.id === Number(button.dataset.id));
    if (job) button.disabled = button.dataset.act === "edit" ? !canEditJob(job) : generationDisabled(job);
  }
  if (["creation","image-model"].includes(menuKind)) {
    const focused=popover.contains(document.activeElement);showMenuBody(menuKind);positionMenu();
    if (focused) (popover.querySelector('[aria-selected="true"]:not(:disabled)') || popover.querySelector('[role="option"]:not(:disabled):not([hidden])') || menuAnchor)?.focus();
  }
}
const imageQualityLabels = {low: "草稿", medium: "标准", high: "高清"};
function modelLabel(model) { if (model === "storyboard") return "成片合成"; if (!model) return "无模型"; return ["muse-image","muse-video"].includes(model) ? "Muse" : state.model_catalog?.[model]?.label || state.images.models[model] || model; }
function videoJobs() { return state.jobs.filter(j => j.kind==="video"); }
function jobParameters(j) {
  if(flowSpec(j))return `${modelLabel(j.model)}${j.actual?.width?' · '+j.actual.width+' × '+j.actual.height:''}${j.actual?.duration?' · '+j.actual.duration+'s':''}`;
  if(j.model === "storyboard") return `成片 · ${j.actual?.width || j.width} × ${j.actual?.height || j.height} · ${Number(j.actual?.duration || j.seconds).toFixed(1)}s`;
  if (isAudio(j)) return `${modelLabel(j.model)} · 24 kHz${j.actual?.duration ? " · "+durationLabel(Math.round(j.actual.duration)) : ""}`;
  if (isMuse(j)) return `Muse · ${j.actual?.width ? `${j.width} × ${j.height}` : "原生"}${isImage(j) ? "" : ` · ${j.actual?.duration ?? j.seconds}s`}`;
  return isImage(j)
    ? `${esc(modelLabel(j.model))} · ${j.quality === 2048 ? "2K" : "1K"} · ${imageQualityLabels[j.image_quality]}`
    : `MiniMax H3 · ${j.seconds}s · ${j.quality}P`;
}
function waitLabel(j) { if (isMuse(j)) return j.note || (j.status === "queued" ? "等待 Muse 就绪" : "Muse 生成中"); return j.status === "queued" ? (isImage(j) ? "等待图片生成" : "等待 GPU 接单") : "正在生成"; }
function timeTaken(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  seconds = Math.max(0, Math.round(seconds));
  if (!seconds) return "不到 1 秒";
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), sec = seconds % 60;
  return [h ? h + " 小时" : "", m ? m + " 分" : "", sec ? sec + " 秒" : ""].filter(Boolean).join(" ");
}
function estimateTime(seconds) {
  const unit = seconds >= 3600 ? 60 : seconds >= 60 ? 15 : 5;
  const rounded = Math.max(5, Math.round(Math.max(0, seconds) / unit) * unit);
  const h = Math.floor(rounded / 3600), m = Math.floor(rounded % 3600 / 60), s = rounded % 60;
  return [h ? h + " 小时" : "", m ? m + " 分" : "", s ? s + " 秒" : ""].filter(Boolean).join(" ");
}
function estimateRange(estimate) {
  if (!estimate || !Number.isFinite(estimate.high)) return "";
  const low = Math.max(1,estimate.low), high = Math.max(low,estimate.high);
  if (high >= 60) {
    const a = Math.max(1,Math.floor(low/60)), b = Math.ceil(high/60);
    return (a===b ? "约 " + b : a + "–" + b) + " 分钟";
  }
  const a=Math.max(5,Math.floor(low/5)*5), b=Math.ceil(high/5)*5;
  return (a===b ? "约 " + b : a + "–" + b) + " 秒";
}
function jobStatusLabel(j) {return isMuse(j) && j.status === 'running' && j.eta?.phase === 'queued' ? '排队中' : labels[j.status];}
function timingLabel(j) {
  if (isMuse(j) && j.note?.includes("待确认")) return j.note;
  const eta = j.eta || {}, delta = Math.max(0, Date.now()/1000-stateReceivedAt);
  if (j.status === "done") return j.timing?.source === "measured" ? "耗时 " + timeTaken(j.timing.elapsed) : "";
  if (j.status === "queued" || (isMuse(j) && eta.phase === "queued")) {
    if (eta.reason === "model_paused") return "等待模型开放";
    if (eta.reason === "waiting_flow") return "等待 Flow 就绪";
    if (eta.reason === "flow_busy") return "等待 Flow 空闲";
    if (eta.reason === "waiting_muse") return "等待 Muse 就绪";
    if (eta.reason === "muse_busy") return "等待 Muse 空闲账号";
    if (eta.reason === "waiting_gpu") return "等待 GPU 上线";
    if (eta.reason === "worker_update") return "等待实例更新";
    if (eta.reason === "service_paused") return "等待图片服务开启";
    if (Number.isFinite(eta.high)) {
      const remaining = (eta.median ?? eta.high)-delta;
      if (remaining <= 0) return "等待开始";
      return "预计约 " + estimateTime(remaining) + "后开始";
    }
    if (eta.reason === "observing") return j.ahead ? `观测中 · 前方 ${j.ahead} 个任务` : "观测中";
    return j.ahead ? `前方 ${j.ahead} 个任务` : waitLabel(j);
  }
  if (j.status !== "running") return "";
  if (eta.phase === "uploading") return "正在回传";
  if (eta.phase === "validating") return "正在校验";
  if (eta.phase === "finalizing") return isImage(j) ? "正在保存图片" : "正在整理成片";
  if (eta.overdue || (Number.isFinite(eta.high) && eta.high-delta <= 0)) return "生成时间较长，仍在处理中";
  if (Number.isFinite(eta.high)) {
    const left = (eta.median ?? eta.high)-delta;
    return left > 0 ? "预计还需约 " + estimateTime(left) : "仍在生成，请稍候";
  }
  if (Number.isFinite(eta.elapsed)) return "已用 " + timeTaken(eta.elapsed+delta);
  return j.note || waitLabel(j);
}
function timingDetails(j) {
  let value = j.timing;
  if (!value) return "";
  if (value.source === "legacy") return `<dt>历史总等待</dt><dd>${timeTaken(value.total)}</dd>`;
  if (value.source === "queued") return `<dt>排队时间</dt><dd>${timeTaken(value.total + Math.max(0,Date.now()/1000-stateReceivedAt))}</dd>`;
  if (value.source !== "measured") return "";
  if (j.status === "running") {
    const delta = Math.max(0,Date.now()/1000-stateReceivedAt);
    value = {...value, elapsed:value.elapsed+delta,total:value.total+delta};
    const phaseField = {preparing:"prepare",generating:"generation",finalizing:"finalize",uploading:"upload",validating:"validation"}[j.eta?.phase];
    if (phaseField && Number.isFinite(value[phaseField])) value[phaseField] += delta;
  }
  let html = `<dt>${value.attempt > 1 ? "本次处理" : "处理耗时"}</dt><dd>${timeTaken(value.elapsed)}</dd><dt>${value.attempt > 1 ? "本次排队" : "排队时间"}</dt><dd>${timeTaken(value.queue)}</dd><dt>总等待</dt><dd>${timeTaken(value.total)}</dd>`;
  for (const [key, label] of [["prepare","准备"],["generation",isImage(j) ? "图片请求" : "生成"],["finalize","收尾"],["upload","回传"],["validation","校验"]]) {
    if (Number.isFinite(value[key])) html += `<dt>${label}${value.phase_source === "observed" && !isImage(j) ? "（约）" : ""}</dt><dd>${timeTaken(value[key])}</dd>`;
  }
  if (value.attempt > 1) html += `<dt>本次尝试</dt><dd>第 ${value.attempt} 次</dd>`;
  if (value.prediction?.high) html += `<dt>开始时预估</dt><dd>约 ${estimateTime(value.prediction.median ?? value.prediction.high)}</dd>`;
  return html;
}
function paintTiming() {
  if (!state || document.hidden) return;
  for (const element of document.querySelectorAll("[data-time-job]")) {
    const job = state.jobs.find(j => j.id === Number(element.dataset.timeJob));
    if (job) {
      const text = timingLabel(job);
      if (element.textContent !== text) element.textContent = text;
    }
  }
  for (const element of document.querySelectorAll("[data-time-details]")) {
    const job = state.jobs.find(j => j.id === Number(element.dataset.timeDetails));
    if (job) {
      const html = timingDetails(job);
      if (element.innerHTML !== html) element.innerHTML = html;
    }
  }
}
function paintDraftEstimate() {
  const element = composer?.querySelector(".composer-estimate");
  if (!element) return;
  const estimate = draftEstimate?.duration;
  element.textContent = generationDisabled(draft) || (isAudio() && !draft.prompt.trim()) ? "" : estimate?.high
    ? (estimate.source === "legacy" ? "历史参考总耗时约 " : "约 ") + estimateTime(estimate.median ?? estimate.high)
    : draftEstimate ? "观测中" : "";
  element.title = estimate?.samples ? `参考 ${estimate.samples} 条相近记录${estimate.source === "legacy" ? "，历史记录包含排队时间" : ""}` : "";
}
function scheduleEstimate() {
  if (!state) return;
  if (generationDisabled(draft) || (isAudio() && !draft.prompt.trim())) { clearTimeout(estimateTimer);estimateSerial++;draftEstimate=null;paintDraftEstimate();return; }
  const body = {kind:draft.kind || "video", model:selectedModel(), ratio:draft.ratio, quality:Number(draft.quality),seconds:Number(draft.seconds),sampling_steps:selectedModel()==="MiniMax H3"?effectiveSteps(draft):20,resolution:draft.resolution || "1K",image_quality:draft.imageQuality || "medium",refs:isAudio()?[]:packReferences(),...(isH3()?{h3:h3Options()}:{}),...(isAudio()?{text_chars:Math.min(300,draft.prompt.length),language:/[\u4e00-\u9fff]/.test(draft.prompt)?"zh":"en",audio_instruction:draft.voiceDescription || ""}:{})};
  const key = state.me.id + JSON.stringify(body);
  if (key === estimateKey && Date.now()-estimateRequestedAt < 15000) { paintDraftEstimate(); return; }
  clearTimeout(estimateTimer);
  const serial = ++estimateSerial;
  if (key !== estimateKey) { draftEstimate = null; paintDraftEstimate(); }
  estimateKey = key;
  estimateTimer = setTimeout(async () => {
    estimateRequestedAt = Date.now();
    try {
      const value = await req("/api/estimate", body);
      if (serial !== estimateSerial) return;
      draftEstimate = value; paintDraftEstimate();
    } catch { if (serial === estimateSerial) { draftEstimate = null; paintDraftEstimate(); } }
  }, 220);
}
function paramsText() {
  const spec=flowSpec();if(spec)return {ratio:spec.ratio,size:[0,0],quality:spec.resolution};
  if (isAudio()) return {ratio:"",size:[0,0],quality:""};
  if (isMuse()) return {ratio:draft.ratio,size:[0,0],quality:"原生"};
  if (isImage()) {
    const offset = draft.resolution === "2K" ? 2 : 0;
    return {ratio: draft.ratio, size: state.images.sizes[draft.ratio].slice(offset, offset + 2), quality: draft.resolution};
  }
  const ratio = draft.ratio,
    offset = draft.quality === "480" ? 0 : 2;
  const size = state.sizes[ratio].slice(offset, offset + 2);
  return { ratio:h3Frames()&&activeReferences().length?"自动":ratio, size, quality: draft.quality + "P" };
}
function buildComposer() {
  const box = document.createElement("section");
  box.className = "composer";
  box.setAttribute("aria-label", "生成");
  box.innerHTML = `<div class="editor-row"><div class="composer-references" aria-label="参考素材"></div><div id="prompt" class="prompt" contenteditable="true" role="textbox" aria-label="提示词" aria-multiline="true" data-placeholder="描述你想生成的视频，输入文字或 @ 参考内容"></div>
    <input class="hide" id="files" type="file" accept="${IMAGE_ACCEPT}" multiple></div>
    <div class="composer-toolbar"><div class="composer-parameters">
      <button class="creation-type parameter-button" data-menu="creation" aria-label="创作类型" aria-expanded="false"></button>
      <button class="model-name parameter-button" data-menu="image-model" aria-label="选择模型" aria-expanded="false"></button>
      <button class="parameter-button h3-mode-control" data-menu="h3-mode" aria-label="选择参考模式" aria-expanded="false" hidden></button>
      <button class="parameter-button" data-menu="format" aria-expanded="false" aria-label="选择比例和分辨率"></button>
      <button class="parameter-button" data-menu="duration" aria-expanded="false" aria-label="选择视频生成时长"></button>
      </div><div class="composer-actions"><div class="composer-utilities">
      <button class="parameter-button only-icon" data-menu="mention" aria-label="引用参考">${ic("at")}</button>
      <button class="parameter-button only-icon" data-menu="advanced" aria-label="更多设置">${ic("sliders")}</button>
      </div><span class="submit-controls"><span class="composer-credit"></span><span class="composer-estimate" aria-live="polite"></span><button class="generate-button" data-act="submit" aria-label="生成" title="生成" disabled>${ic("arrow")}</button></span>
    </div></div><div class="flow-source" hidden></div><div class="composer-status" aria-live="polite"></div>`;
  box.querySelector("#prompt").addEventListener("input", () => {
    draft.prompt = serializePrompt();
    submitId = crypto.randomUUID();
    persist();
    updateComposerControls();
    const selection = getSelection();
    if (selection?.rangeCount)
      savedRange = selection.getRangeAt(0).cloneRange();
  });
  box.querySelector("#prompt").addEventListener("keyup", (event) => {
    if (event.isComposing) return;
    if (event.key === "@" && refs.length && !h3Frames()) {
      rememberSelection();
      openMenu("mention", box.querySelector('[data-menu="mention"]'));
    }
  });
  box.querySelector("#prompt").addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (
      menuKind === "mention" &&
      ["ArrowDown", "ArrowUp"].includes(event.key)
    ) {
      event.preventDefault();
      const entries = popover.querySelectorAll(".ref-entry");
      (event.key === "ArrowDown"
        ? entries[0]
        : entries[entries.length - 1]
      )?.focus();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submitCurrent().catch((error) => notify(error.message));
    }
    if (event.key === "Escape" && menuKind) {
      event.stopPropagation();
      closeMenu();
    }
  });
  box.querySelector("#prompt").addEventListener("paste", (event) => {
    event.preventDefault();
    if(event.clipboardData.files.length){uploadFiles(event.clipboardData.files);return;}
    rememberSelection();
    insertAtCaret(
      document.createTextNode(event.clipboardData.getData("text/plain")),
    );
    saveEditor();
  });
  box.querySelector("#files").addEventListener("change", async (event) => {
    await uploadFiles(event.target.files);
    event.target.value = "";
  });
  box.addEventListener("dragover", (event) => {
    if ([...event.dataTransfer.types].includes("Files")) {
      event.preventDefault();
      box.classList.add("dragging");
    }
  });
  box.addEventListener("dragleave", (event) => {
    if (!box.contains(event.relatedTarget)) box.classList.remove("dragging");
  });
  box.addEventListener("drop", (event) => {
    if (event.dataTransfer.files.length) {
      event.preventDefault();
      box.classList.remove("dragging");
      if (!isAudio()) uploadFiles(event.dataTransfer.files);
    }
  });
  renderEditor(box);
  updateComposerControls(box);
  return box;
}
function referenceToken(key) {
  return `<span class="reference-token" contenteditable="false" data-refid="${key}">${referenceMedia(key)}<span>${referenceLabel(key)}</span></span>`;
}
function renderEditor(box = composer) {
  const editor=box.querySelector('#prompt');let html='',cursor=0;
  for(const match of draft.prompt.matchAll(/<(Picture|Video|Audio) (\d+)>/g)) {
    html+=esc(draft.prompt.slice(cursor,match.index)).replace(/\n/g,'<br>');
    const key=refs.filter(k=>referenceType(k)===match[1])[Number(match[2])-1];
    html+=key&&!h3Frames()?referenceToken(key):esc(match[0]);cursor=match.index+match[0].length;
  }
  editor.innerHTML=html+esc(draft.prompt.slice(cursor)).replace(/\n/g,'<br>');
}
function serializePrompt() {
  const editor=composer?.querySelector('#prompt');if(!editor)return draft.prompt;
  function read(node) {
    if(node.nodeType===Node.TEXT_NODE)return node.textContent;
    if(node.nodeType!==Node.ELEMENT_NODE)return '';
    if(node.dataset.refid){const key=node.dataset.refid;return refs.includes(key)?`<${referenceType(key)} ${referenceIndex(key)}>`:'';}
    if(node.tagName==='BR')return '\n';
    const text=[...node.childNodes].map(read).join('');return ['DIV','P'].includes(node.tagName)?text+'\n':text;
  }
  return [...editor.childNodes].map(read).join('').replace(/\n+$/,'').replace(/@图片(\d+)/g,'<Picture $1>');
}
function rememberSelection() {
  const selection = getSelection();
  if (
    selection?.rangeCount &&
    composer?.querySelector("#prompt").contains(selection.anchorNode)
  )
    savedRange = selection.getRangeAt(0).cloneRange();
}
function insertAtCaret(node) {
  const editor = composer.querySelector("#prompt");
  editor.focus();
  let range = savedRange?.startContainer.isConnected
    ? savedRange.cloneRange()
    : null;
  if (!range || !editor.contains(range.startContainer)) {
    range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
  }
  range.deleteContents();
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  savedRange = range;
}
function insertReference(key) {
  closeMenu();
  const index = refs.indexOf(key);
  if (index < 0) return;
  if (savedRange?.startContainer.nodeType === Node.TEXT_NODE) {
    const text = savedRange.startContainer,
      offset = savedRange.startOffset;
    if (text.textContent[offset - 1] === "@")
      savedRange.setStart(text, offset - 1);
  }
  const wrapper = document.createElement("span");
  wrapper.innerHTML = referenceToken(key, index);
  insertAtCaret(wrapper.firstElementChild);
  insertAtCaret(document.createTextNode(" "));
  saveEditor();
}
function saveEditor() {
  draft.prompt = serializePrompt();
  submitId = crypto.randomUUID();
  persist();
  updateComposerControls();
}
function packReferences() { return [...new Set([...activeReferences(),...(draft.packs || []).flatMap(p=>p.media)])]; }
function checkReferenceImages(ids, existing = packReferences()) {
  const images = [...new Set(ids)];
  if (images.some(id => !state.assets.some(a => a.id === id && (!a.kind || a.kind === "ref"))))
    throw new Error("图片已移除或不在当前空间，请重新选择");
  const all = [...new Set([...existing, ...images])];
  if (all.filter(id => referenceType(id) === "Picture").length > 9)
    throw new Error("最多选择 9 张参考图片，请先移除部分图片");
  if (all.length > (isH3() ? 12 : 9)) throw new Error("参考素材已达上限，请先移除部分素材");
  return images.filter(id => !existing.includes(id));
}
function importReferenceImages(ids) {
  const added = checkReferenceImages(ids);
  if (!added.length) return;
  if (h3Frames()) {
    const previous = structuredClone(draft.h3), previousSlot = h3UploadSlot;
    try { for (const id of added) assignH3Frame(id); }
    catch (error) { draft.h3 = previous; h3UploadSlot = previousSlot; throw error; }
  } else refs.push(...added);
  submitId = crypto.randomUUID(); persist(); updateComposerControls();
}
function beginReferencePicking() {
  closeMenu();
  if (!referencePicking) referencePicking = {page, tab:libraryTab, scope:libraryScope, scroll:scrollY};
  page = "library"; libraryTab = "images"; libraryScope = "history";
  resetSelection(); detailId = null; imageId = null;
  persist(); renderPage(); scrollTo(0, 0);
}
function finishReferencePicking() {
  if (!referencePicking) return;
  const previous = referencePicking; referencePicking = null;
  page = previous.page; libraryTab = previous.tab; libraryScope = previous.scope;
  renderPage(); scrollTo(0, previous.scroll);
}
function paintReferencePicking() {
  if (!referencePicking || page !== "library") return;
  const selected = new Set(packReferences());
  const toolbar = document.querySelector("#selection-toolbar");
  if (toolbar) toolbar.innerHTML = selectionToolbar();
  for (const card of document.querySelectorAll(".asset-card[data-asset-key]")) {
    const key = card.dataset.assetKey, item = assetRecord(key);
    const id = key.startsWith("job:") ? item?.result : item?.id;
    const checked = selected.has(id), preview = card.querySelector(".asset-preview");
    card.classList.toggle("is-reference-added", checked);
    if (preview) { preview.setAttribute("aria-pressed", String(checked)); preview.setAttribute("aria-label", checked ? "已添加为参考图片" : "添加为参考图片"); }
  }
}
function updateComposerControls(box = composer) {
  if (!box) return;
  ensureModelSelection();
  const image = isImage(), audio = isAudio(), flowModel=flowSpec();
  const modeControl=box.querySelector('[data-menu="h3-mode"]');modeControl.hidden=!isH3();modeControl.disabled=uploadBusy;modeControl.innerHTML=`${ic(h3Frames()?"film":"link")}<span>${h3Frames()?"首尾帧":"全能参考"}</span>${chevron()}`;
  box.querySelector("#files").accept=isH3()&&!h3Frames()?IMAGE_ACCEPT+",video/mp4,video/webm,video/quicktime,audio/*":IMAGE_ACCEPT;
  box.querySelector("#files").multiple=!h3Frames();
  paintReferenceInputs(box);
  box.classList.toggle("audio-composer",audio);
  box.querySelector(".creation-type").innerHTML = `${ic(audio ? "voice" : image ? "picture" : "film")}<span>${audio ? "语音生成" : image ? "图片生成" : "视频生成"}</span>${chevron()}`;
  const modelButton = box.querySelector(".model-name");
  modelButton.innerHTML = `${ic("model")}<span>${esc(composerModelLabel())}</span>${chevron()}`;
  modelButton.dataset.menu = "image-model";
  modelButton.disabled = !selectedModel();
  modelButton.classList.toggle("model-unavailable",generationDisabled(draft));
  modelButton.setAttribute("aria-label", "选择模型，当前" + composerModelLabel());
  modelButton.setAttribute("aria-expanded", String(menuKind === "image-model"));
  box.querySelector("#prompt").dataset.placeholder = h3Frames()?"描述画面的运动与首尾帧之间的过渡":isH3()?"添加图片、视频或音频，输入 @ 引用参考内容":audio ? "输入要朗读的文字，最多 300 字" : `描述你想生成的${image ? "图片" : "视频"}，输入文字或 @ 参考内容`;
  box.querySelector('[data-menu="format"]').hidden=audio;
  box.querySelector('[data-menu="mention"]').hidden=audio||h3Frames();
  box.querySelector('[data-menu="advanced"]').hidden = image || isMuse() || Boolean(flowModel);
  const { ratio, quality, size } = paramsText();
  box.querySelector('[data-menu="format"]').innerHTML =
    `${ic("frame")}<span>${ratio}</span><span class="quality-label">${quality}</span>`;
  box.querySelector('[data-menu="format"]').title = flowModel?.family ? '选择生成方式和比例' : flowModel ? '该模型的固定规格' : isMuse() ? "原生分辨率" : `${size[0]} × ${size[1]}`;
  for(const kind of ['format','duration']){const control=box.querySelector(`[data-menu="${kind}"]`);const fixed=Boolean(flowModel&&!flowModel.family);control.disabled=fixed;control.classList.toggle('fixed-parameter',fixed);}
  box.querySelector('[data-menu="duration"]').hidden = image && (isMuse() || Boolean(flowModel));
  box.querySelector('[data-menu="duration"]').innerHTML =
    `${ic(audio || image ? "sliders" : "clock")}<span>${audio ? "音色描述" : image ? imageQualityLabels[draft.imageQuality] : draft.seconds + "s"}</span>${audio || image ? chevron() : ""}`;
  box.querySelector('[data-menu="duration"]').setAttribute("aria-label", audio ? "音色描述" : image ? "选择图片质量" : "选择视频生成时长");
  box.querySelector(".generate-button").disabled =
    !draft.prompt.trim() ||
    draft.prompt.length > promptLimit() ||
    uploadBusy ||
    revisionPending || generationDisabled(draft) || Boolean(flowInputIssue() || h3InputIssue()) || !creditQuote(draft).canSubmit;
  const sourceBox=box.querySelector('.flow-source');
  sourceBox.hidden=flowModel?.mode!=='extend';
  if(!sourceBox.hidden){
    const candidates=state.jobs.filter(j=>j.kind==='video'&&j.status==='done'&&flowSpec(j)&&j.actual?.flow_media_id&&j.ratio===flowModel.ratio);
    const markup=`<label>来源视频<select aria-label="续写来源视频"><option value="">请选择已完成的 Flow 视频</option>${candidates.map(j=>`<option value="${j.id}" ${Number(draft.flowSourceJob)===j.id?'selected':''}>#${j.id} · ${esc(j.prompt.slice(0,42))}</option>`).join('')}</select></label>`;
    if(sourceBox.innerHTML!==markup)sourceBox.innerHTML=markup;
    sourceBox.querySelector('select').onchange=e=>{draft.flowSourceJob=Number(e.target.value)||null;submitId=crypto.randomUUID();persist();updateComposerControls();};
  }
  const quote = creditQuote(draft);
  const credit = box.querySelector(".composer-credit");
  credit.innerHTML = !selectedModel() ? "" : quote.amount == null ? "未定价"
    : `<svg class="credit-spark" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C13.4 8.7 15.3 10.6 22 12C15.3 13.4 13.4 15.3 12 22C10.6 15.3 8.7 13.4 2 12C8.7 10.6 10.6 8.7 12 2Z"/></svg><span>${esc(quote.amount)}</span>`;
  credit.setAttribute("aria-label", selectedModel() ? quote.label : "");
  credit.title = `${quote.label}；当前空间可用 ${state.credits?.available || 0} 积分`;
  if (!uploadBusy) {
    box.querySelector(".composer-status").textContent =
      h3InputIssue() || flowInputIssue() || (draft.prompt.length > promptLimit() ? draft.prompt.length + " / "+promptLimit()+" 字" : "");
  }
  box
    .querySelector(".generate-button")
    .classList.toggle("working", revisionPending);
  for (const chip of box.querySelectorAll("[data-refid]")) {
    const index = refs.indexOf(chip.dataset.refid);
    if (index < 0) chip.remove();
    else chip.lastChild.textContent = referenceLabel(chip.dataset.refid);
  }
  scheduleEstimate();
  paintReferencePicking();
}
async function uploadFiles(files) {
  if (uploadBusy) return;
  uploadBusy = true;
  updateComposerControls();
  const hint = composer.querySelector(".composer-status");
  try {
    for (const file of files) {
      if (!h3Frames() && refs.length >= (isH3()?12:9)) {
        notify(isH3()?"最多选择 12 个参考素材":"最多上传 9 张参考图片");
        break;
      }
      hint.textContent = "上传中";
      const kind=file.type.startsWith("video/")?"video":file.type.startsWith("audio/")?"audio":"image";
      if(kind!=="image"&&(!isH3()||h3Frames()))throw new Error("这个模式只接收图片");
      const result = await req(kind==="image"?"/api/assets":"/api/h3/references?kind="+kind, file, "POST", true);
      if (result.first_frame) notify("动态图或多页图片已按首帧导入");
      else if (result.resized) notify(`图片已适配为 ${result.w} × ${result.h}`);
      state.assets.unshift({ ...result, owner: state.me.id });
      if(h3Frames())assignH3Frame(result.id);else refs.push(result.id);
      persist();
      updateComposerControls();
    }
    if (menuKind === "references") showMenuBody("references");
    await refresh();
  } catch (error) {
    notify(error.message);
  } finally {
    uploadBusy = false;
    hint.textContent = "";
    submitId = crypto.randomUUID();
    updateComposerControls();
  }
}
function closeMenu(restoreFocus = false) {
  const serial = ++menuSerial,
    anchor = menuAnchor;
  if (anchor) anchor.setAttribute("aria-expanded", "false");
  menuKind = null;
  menuAnchor = null;
  popover.classList.remove("open");
  setTimeout(() => {
    if (serial === menuSerial) {
      popover.hidden = true;
      popover.innerHTML = "";
    }
  }, 100);
  if (restoreFocus && anchor?.isConnected) anchor.focus();
}
function openMenu(kind, anchor) {
  rememberSelection();
  if (menuKind === kind && menuAnchor === anchor) {
    closeMenu();
    return;
  }
  if (menuAnchor) menuAnchor.setAttribute("aria-expanded", "false");
  menuSerial++;
  menuKind = kind;
  menuAnchor = anchor;
  anchor.setAttribute("aria-expanded", "true");
  popover.hidden = false;
  popover.className = "popover " + (kind === "account" ? "account-menu" : kind);
  showMenuBody(kind);
  positionMenu();
  requestAnimationFrame(() => popover.classList.add("open"));
  if (["duration", "workspaces", "image-model"].includes(kind))
    (popover.querySelector('[aria-selected="true"]:not(:disabled)') || popover.querySelector('[role="option"]:not(:disabled):not([hidden])'))
      ?.focus({ preventScroll: true });
}
function positionMenu() {
  if (!menuAnchor?.isConnected) {
    closeMenu();
    return;
  }
  const a = menuAnchor.getBoundingClientRect(),
    p = { width: popover.offsetWidth, height: popover.offsetHeight };
  const beside = menuKind === "workspaces" && innerWidth > 760;
  const left = Math.min(Math.max(12, beside ? a.right + 12 : a.left - 16), innerWidth - p.width - 12);
  let top = beside ? a.top : a.bottom + 8;
  const above = top + p.height > innerHeight - 14;
  if (above) top = Math.max(12, a.top - p.height - 8);
  popover.style.left = left + "px";
  popover.style.top = top + "px";
  popover.style.transformOrigin = above ? "bottom left" : "top left";
}
function radio(value, current, action, labelHTML = value) {
  return `<button type="button" role="radio" aria-checked="${String(value) === String(current)}" tabindex="${String(value) === String(current) ? 0 : -1}" data-act="${action}" data-value="${value}">${labelHTML}</button>`;
}
function showMenuBody(kind) {
  popover.setAttribute("role", "dialog");
  if (kind === "workspaces") {
    popover.setAttribute("aria-label", "选择工作区");
    popover.innerHTML = workspaceMenu();
  } else if (kind === "creation") {
    popover.setAttribute("aria-label", "创作类型");
    popover.innerHTML = `<div class="choice-list" role="listbox" aria-label="创作类型">${[["video", "视频生成", "film"], ["image", "图片生成", "picture"], ["audio", "语音生成", "voice"]].map(([value, label, icon]) => `<button role="option" aria-selected="${draft.kind === value}" data-act="creation" data-value="${value}" >${ic(icon)}<span>${label}</span>${draft.kind === value ? ic("check") : ""}</button>`).join("")}</div>`;
  } else if (kind === "image-model") {
    popover.setAttribute("aria-label", "选择模型");
    const models = FlowPicker.grouped(modelsForKind(),state.model_catalog||{},modelAvailable,selectedModel(),{ratio:draft.ratio,seconds:Number(draft.seconds)});
    const previousSearch=popover.querySelector('[data-model-search]')?.value || '';
    popover.innerHTML = `${models.length>12?`<input class="model-search" data-model-search aria-label="搜索模型" placeholder="搜索模型" value="${esc(previousSearch)}">`:''}<div class="choice-list flow-model-options" role="listbox" aria-label="选择模型">${models.map(([value,label]) => `<button role="option" aria-selected="${FlowPicker.sameFamily(state.model_catalog||{},selectedModel(),value)}" data-act="image-model" data-value="${value}" title="${esc(label)}"><span>${esc(label)}</span>${FlowPicker.sameFamily(state.model_catalog||{},selectedModel(),value) ? ic("check") : ""}</button>`).join("")}</div><p class="model-search-empty" hidden>没有匹配的模型</p>`;
    const search=popover.querySelector('[data-model-search]');
    if(search){const filter=()=>{let count=0;for(const option of popover.querySelectorAll('[role="option"]')){option.hidden=!option.textContent.toLowerCase().includes(search.value.trim().toLowerCase());if(!option.hidden)count++;}popover.querySelector('.model-search-empty').hidden=count>0;};search.oninput=filter;filter();}
  } else if(kind === "h3-mode") {
    popover.setAttribute("aria-label","选择参考模式");
    popover.innerHTML=`<div class="choice-list" role="listbox" aria-label="参考模式">${[["reference","全能参考","link"],["frames","首尾帧","film"]].map(([value,label,icon])=>`<button role="option" aria-selected="${h3Options().mode===value}" data-act="h3-mode" data-value="${value}">${ic(icon)}<span>${label}</span>${h3Options().mode===value?ic("check"):""}</button>`).join("")}</div>`;
  } else if (kind === "format") {
    const flow=flowSpec()?.family?flowOptions():null;
    popover.setAttribute("aria-label", flow ? "选择生成方式和比例" : isMuse() ? "选择比例" : "选择比例和分辨率");
    const ratios = flow ? flow.ratios : isMuse() ? (isImage() ? ["1:1","16:9","9:16","4:3","3:4"] : ["16:9","9:16"]) : ["21:9","16:9","4:3","1:1","3:4","9:16"];
    popover.innerHTML = `${flow?.modes.length>1?`<div class="popover-label">生成方式</div><div class="quality-options" role="radiogroup" aria-label="生成方式">${flow.modes.map(value=>radio(value,flowSpec().mode,"flow-mode",FlowPicker.modeLabels[value])).join('')}</div>`:''}<div class="popover-label">选择比例</div><div class="ratio-options" style="grid-template-columns:repeat(${ratios.length},1fr)" role="radiogroup" aria-label="选择比例">${ratios.map(value => radio(value,draft.ratio,"ratio",`<span class="ratio-glyph" style="--ratio:${value.replace(":","/")}"></span><span>${value}</span>`)).join("")}</div>${isMuse() || flow ? '' : `<div class="popover-label resolution-label">选择分辨率</div><div class="quality-options" role="radiogroup" aria-label="选择分辨率">${isImage() ? ["1K","2K"].map(value => radio(value,draft.resolution,"resolution")).join("") : [480,768].map(value => radio(value,draft.quality,"quality",value+"P")).join("")}</div>`}`;
    if(h3Frames()&&activeReferences().length){for(const control of popover.querySelectorAll(".ratio-options button"))control.disabled=true;popover.querySelector(".popover-label").textContent="按图片自动匹配比例";}
  } else if (kind === "duration" && isAudio()) {
    popover.setAttribute("aria-label", "音色描述");
    popover.innerHTML = `<div class="popover-label">音色描述</div><label class="formlabel"><textarea id="voice-description" rows="4" maxlength="300" aria-label="音色描述" placeholder="例如：温柔自然的女声，语速舒缓，使用普通话">${esc(draft.voiceDescription || "")}</textarea></label><button class="primary" data-act="save-voice">确定</button>`;
  } else if (kind === "duration" && isImage()) {
    popover.setAttribute("aria-label", "选择图片质量");
    popover.innerHTML = `<div class="popover-label">选择质量</div><div class="choice-list" role="listbox" aria-label="选择图片质量">${Object.entries(imageQualityLabels).map(([value,label]) => `<button role="option" aria-selected="${draft.imageQuality === value}" data-act="image-quality" data-value="${value}"><span>${label}</span>${draft.imageQuality === value ? ic("check") : ""}</button>`).join("")}</div>`;
  } else if (kind === "duration") {
    popover.setAttribute("aria-label", "选择视频生成时长");
    popover.innerHTML = `<div class="popover-label">选择时长</div><div class="duration-options" role="listbox" aria-label="选择视频生成时长">${(flowSpec()?.family ? flowOptions().seconds : isMuse() ? [5,6,8,10] : [5,10,15]).map((value) => `<button type="button" role="option" aria-selected="${String(value) === draft.seconds}" tabindex="${String(value) === draft.seconds ? 0 : -1}" data-act="seconds" data-value="${value}"><span>${value}s</span>${String(value) === draft.seconds ? ic("check") : ""}</button>`).join("")}</div>`;
  } else if (kind === "advanced") {
    popover.setAttribute("aria-label", "更多设置");
    popover.innerHTML = `<div class="popover-label">更多设置</div>${selectedModel() === "MiniMax H3" ? `<div class="advanced-mode-row"><span>快速模式</span><label class="model-switch"><input id="fast-mode" type="checkbox" role="switch" aria-label="快速模式" ${draft.fast_mode?"checked":""}><span aria-hidden="true"></span></label></div><div data-standard-sampling ${draft.fast_mode?"hidden":""}><div class="popover-label">采样步数</div><div class="quality-options sampling-options" role="radiogroup" aria-label="采样步数" data-value="${normalizedSteps(draft.sampling_steps)}">${[16,20,32,50].map(value => radio(value,normalizedSteps(draft.sampling_steps),"sampling-steps")).join("")}</div></div>` : ""}<label class="formlabel"><input id="seed" aria-label="随机种子" inputmode="numeric" value="${esc(draft.seed)}" placeholder="随机种子"></label>${retainedSeed !== null ? '<label class="check"><input id="reuse-seed" type="checkbox">沿用原种子</label>' : ""}<button class="primary" data-act="save-seed">确定</button>`;
  } else if (kind === "mention" || kind === "references") {
    popover.setAttribute("aria-label", "参考内容");
    const selected=kind==='references'?packReferences():refs;
    const row=key=>{
      const direct=refs.includes(key),label=direct?referenceLabel(key):'素材包图片';
      return `<div class="reference-row" draggable="${kind==='references'&&direct}" data-ref="${key}"><button data-act="${kind==='references'?'h3-preview':'mention'}" data-key="${key}" class="ref-entry" aria-label="${kind==='references'?'预览':'引用'}${label}">${referenceMedia(key)}<span>${label}</span></button>${kind==='references'&&direct?`<button class="icon-button" data-act="mention" data-key="${key}" aria-label="引用${label}" title="引用">${ic('at')}</button><button class="icon-button" data-act="ref-left" data-key="${key}" aria-label="前移${label}" title="前移">${ic('back')}</button><button class="icon-button" data-act="unref" data-key="${key}" aria-label="移除${label}" title="移除">${ic('close')}</button>`:''}</div>${isH3()&&referenceAsset(key).kind==='ref_video'&&referenceAsset(key).has_audio?`<label class="h3-video-audio"><input type="checkbox" data-video-audio="${key}" ${h3Options().video_audio.includes(key)?'checked':''}>同时参考${referenceLabel(key)}的声音</label>`:''}`;
    };
    popover.innerHTML=`<div class="popover-label">参考内容<span>${selected.length}/${isH3()?12:9}</span></div>${selected.length?`<div class="reference-list">${selected.map(row).join('')}</div>`:'<p class="empty-note">暂无参考内容</p>'}${kind==='references'?`<button class="menu-item" data-act="upload">${ic('plus')}上传${isH3()?'素材':'图片'}</button><button class="menu-item" data-act="choose-assets">${ic('library')}从资产选择</button><button class="menu-item" data-act="asset-packs">${ic('library')}素材包${draft.packs?.length?' · '+draft.packs.length:''}</button>${isH3()?'<p class="h3-upload-note">最多 9 张图片、3 段视频、3 段音频，合计 12 个。视频、音频各 2–15 秒，同类总时长不超过 15 秒。</p>':''}`:''}`;
  } else if (kind === "account") {
    popover.setAttribute("aria-label", "账户");
    popover.innerHTML = `<div class="account-menu-header">${avatarImage(state.me, true)}<div class="account-menu-identity"><strong data-current-name title="${esc(displayName(state.me))}">${esc(displayName(state.me))}</strong></div></div><div class="menu-divider"></div><button class="menu-item" data-nav="settings">${ic("settings")}设置</button><button class="menu-item" data-act="logout">${ic("logout")}退出登录</button>`;
  } else if (kind === "detail-more") {
    const j = state.jobs.find((x) => x.id === detailId),
      own = j && (state.me.role === "admin" || state.me.id === j.owner);
    popover.setAttribute("aria-label", "更多");
    popover.innerHTML = own
      ? `<button class="menu-item danger" data-act="delete" data-id="${j.id}">删除</button>`
      : '<span class="empty-note">暂无更多操作</span>';
  }
}
popover.addEventListener("change", (event) => {
  if(event.target.dataset.videoAudio){const key=event.target.dataset.videoAudio,options=h3Options();draft.h3={...options,video_audio:event.target.checked?[...options.video_audio,key]:options.video_audio.filter(k=>k!==key)};submitId=crypto.randomUUID();persist();}
  if (event.target.id === "fast-mode") {
    popover.querySelector("[data-standard-sampling]").hidden = event.target.checked;
    positionMenu();
  }
  if (event.target.id === "reuse-seed")
    popover.querySelector("#seed").value = event.target.checked
      ? retainedSeed
      : "";
});
popover.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeMenu(true);
    return;
  }
  if (
    ["duration", "creation", "image-model", "workspaces", "h3-mode"].includes(menuKind) &&
    ["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
  ) {
    const options = [...popover.querySelectorAll('[role="option"]:not(:disabled):not([hidden])')];
    event.preventDefault();
    let index = options.indexOf(document.activeElement);
    if (event.key === "Home") index = 0;
    else if (event.key === "End") index = options.length - 1;
    else
      index =
        (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) %
        options.length;
    options[index]?.focus();
    return;
  }
  if (menuKind === "mention" && ["ArrowUp", "ArrowDown"].includes(event.key)) {
    const entries = [...popover.querySelectorAll(".ref-entry")];
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    entries[
      (entries.indexOf(document.activeElement) + direction + entries.length) %
        entries.length
    ]?.focus();
    return;
  }
  if (
    ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) &&
    event.target.getAttribute("role") === "radio"
  ) {
    event.preventDefault();
    const radios = [
      ...event.target.parentElement.querySelectorAll('[role="radio"]'),
    ];
    const direction = ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1;
    const next =
      radios[
        (radios.indexOf(event.target) + direction + radios.length) %
          radios.length
      ];
    next.click();
    popover
      .querySelector(
        `[data-act="${next.dataset.act}"][data-value="${next.dataset.value}"]`,
      )
      ?.focus();
  }
});
let draggedRef = null;
popover.addEventListener("dragstart", (event) => {
  draggedRef = event.target.closest("[data-ref]")?.dataset.ref;
});
popover.addEventListener("dragover", (event) => {
  if (draggedRef) event.preventDefault();
});
popover.addEventListener("drop", (event) => {
  const target = event.target.closest("[data-ref]")?.dataset.ref;
  if (draggedRef && target) {
    event.preventDefault();
    const from = refs.indexOf(draggedRef),
      to = refs.indexOf(target);
    refs.splice(to, 0, refs.splice(from, 1)[0]);
    updateComposerControls();
    saveEditor();
    showMenuBody("references");
    draggedRef = null;
  }
});
document.addEventListener("pointerdown", (event) => {
  rememberSelection();
  if (
    menuKind &&
    !popover.contains(event.target) &&
    !menuAnchor?.contains(event.target)
  )
    closeMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (menuKind) closeMenu(true);
    else if (detailId !== null || imageId) closeDetail();
    else if (referencePicking && !modal.open) finishReferencePicking();
    else if (selectingAssets && !modal.open) { resetSelection(); paintSelection(); }
  }
});
window.addEventListener("resize", () => {
  if (menuKind) positionMenu();
});
document.addEventListener(
  "scroll",
  (event) => {
    if (menuKind && !popover.contains(event.target)) closeMenu();
  },
  true,
);

function dateLabel(timestamp) {
  const d = new Date(timestamp * 1000),
    today = new Date();
  return d.toDateString() === today.toDateString()
    ? "今天"
    : `${d.getMonth() + 1}月${d.getDate()}日`;
}
function durationLabel(seconds) {
  return String(Math.floor(seconds/60)).padStart(2,"0")+":"+String(seconds%60).padStart(2,"0");
}
function isFavorite(key) { return (state.favorites || []).includes(key); }
function uploadedAssets() {
  const results = new Set(state.jobs.map(j => j.result).filter(Boolean));
  return state.assets.filter(a => !results.has(a.id));
}
function matchesLibrary(key) { return libraryScope !== "favorites" || isFavorite(key); }
function libraryJobs() {
  return state.jobs.filter(j => j.kind === ({images:"image",videos:"video",audio:"audio"}[libraryTab] || "video") && matchesLibrary("job:" + j.id) && (!referencePicking || (j.status === "done" && state.assets.some(a => a.id === j.result && (!a.kind || a.kind === "ref")))));
}
function libraryUploads() { return uploadedAssets().filter(a => (a.kind||"ref")===({images:"ref",videos:"ref_video",audio:"ref_audio"}[libraryTab]) && matchesLibrary("asset:" + a.id)); }
function assetRecord(key) {
  return key.startsWith("job:") ? state.jobs.find(j => "job:" + j.id === key) : state.assets.find(a => "asset:" + a.id === key);
}
function selectable(key) { const item = assetRecord(key); return item && !["queued", "running"].includes(item.status); }
function canFavorite(key) { const item = assetRecord(key); return item && (!key.startsWith("job:") || (item.status === "done" && item.result)); }
function visibleAssetKeys() {
  return libraryJobs().map(j => "job:" + j.id).concat(libraryUploads().map(a => "asset:" + a.id)).filter(selectable);
}
function favoriteButton(key, detail = false) {
  const saved = isFavorite(key);
  return `<button class="favorite-button ${saved ? "is-favorite" : ""} ${detail ? "detail-favorite" : ""}" data-act="favorite" data-key="${key}" aria-label="${saved ? "取消收藏" : "收藏"}" aria-pressed="${saved}" title="${saved ? "取消收藏" : "收藏"}">${ic("star")}${detail ? `<span>${saved ? "已收藏" : "收藏"}</span>` : ""}</button>`;
}
function selectionButton(key, label) {
  if (referencePicking && page === "library") return `<span class="reference-pick-check" aria-hidden="true">${ic("check")}</span>`;
  if (page !== "library" || detailId !== null || imageId || !selectable(key)) return "";
  return `<button class="asset-checkbox" ${selectingAssets ? "" : "hidden"} role="checkbox" aria-checked="${selectedAssets.has(key)}" aria-label="选择${label}" data-act="select-asset" data-key="${key}">${ic("check")}</button>`;
}
function selectionToolbar() {
  if (referencePicking) return `<div class="reference-pick-toolbar"><span role="status">已添加 ${packReferences().filter(id=>referenceType(id)==="Picture").length} 张图片</span><button class="primary" data-act="finish-reference-picking">完成选择</button></div>`;
  if (!selectingAssets) return '<button class="quiet-button" data-act="start-select">多选</button>';
  const keys = [...selectedAssets], visible = visibleAssetKeys();
  const count = visible.filter(k => selectedAssets.has(k)).length;
  const checked = count && count === visible.length;
  const allSaved = keys.length && keys.every(isFavorite);
  const downloadable = keys.length && keys.every(canFavorite);
  const removable = keys.length && keys.every(key => {
    const item = assetRecord(key); return item && selectable(key) && (state.me.role === "admin" || item.owner === state.me.id);
  });
  return `<div class="bulk-toolbar" role="group" aria-label="批量操作"><button class="select-all" role="checkbox" aria-label="全选当前分类" aria-checked="${checked ? "true" : count ? "mixed" : "false"}" data-act="select-all" ${visible.length ? "" : "disabled"}><span>${checked || count ? ic("check") : ""}</span>全选</button><span class="selection-count" aria-live="polite">已选择 ${keys.length} 项内容</span><div class="bulk-actions"><button data-act="batch-delete" ${removable && !libraryBusy ? "" : "disabled"} title="${keys.length && !removable ? "只能删除自己的已结束任务和素材" : "删除"}">${ic("trash")}删除</button><button data-act="batch-download" ${downloadable && !libraryBusy ? "" : "disabled"}>${ic("download")}${downloadBusy ? "准备下载" : "下载"}</button><button data-act="batch-favorite" ${keys.length && keys.every(canFavorite) && !libraryBusy ? "" : "disabled"}>${ic("star")}${allSaved ? "取消收藏" : "收藏"}</button></div><button class="cancel-select" data-act="cancel-select" ${libraryBusy ? "disabled" : ""}>${ic("close")}取消选择</button></div>`;
}
function paintSelection() {
  for (const key of selectedAssets) if (!selectable(key)) selectedAssets.delete(key);
  const library = document.querySelector(".assets-view");
  library?.classList.toggle("is-selecting", selectingAssets);
  const toolbar = document.querySelector("#selection-toolbar");
  if (toolbar) toolbar.innerHTML = selectionToolbar();
  const floating = document.querySelector("#asset-composer");
  if (floating) floating.hidden = selectingAssets;
  for (const card of document.querySelectorAll(".asset-card[data-asset-key]")) {
    const checked = selectedAssets.has(card.dataset.assetKey);
    card.classList.toggle("is-selected", checked);
    const checkbox = card.querySelector(".asset-checkbox");
    if (checkbox) {
      checkbox.hidden = !selectingAssets;
      checkbox.setAttribute("aria-checked", String(checked));
    }
  }
  paintReferencePicking();
}
function resetSelection() { selectingAssets = false; selectedAssets.clear(); }
function toggleSelection(key) {
  if (!selectable(key) || libraryBusy) return;
  if (!selectedAssets.has(key) && selectedAssets.size >= 200) { notify("一次最多选择 200 项"); return; }
  selectingAssets = true;
  if (selectedAssets.has(key)) selectedAssets.delete(key); else selectedAssets.add(key);
  paintSelection();
}
function paintFavorites() {
  for (const button of document.querySelectorAll('[data-act="favorite"]')) {
    const saved = isFavorite(button.dataset.key);
    button.classList.toggle("is-favorite", saved);
    button.setAttribute("aria-pressed", String(saved));
    button.setAttribute("aria-label", saved ? "取消收藏" : "收藏");
    button.title = saved ? "取消收藏" : "收藏";
    const label = button.querySelector("span"); if (label) label.textContent = saved ? "已收藏" : "收藏";
    button.closest(".asset-card")?.classList.toggle("is-favorite", saved);
  }
}
async function saveFavorites(keys, favorite) {
  if (libraryBusy) return;
  libraryBusy = true; paintSelection();
  try {
    const result = await req("/api/favorites", {keys, favorite}, "PUT");
    state.favorites = result.favorites;
    if (libraryScope === "favorites" && page === "library" && detailId === null && !imageId) {
      for (const key of keys) if (!favorite) selectedAssets.delete(key);
      renderPage(false);
    } else paintFavorites();
    notify(favorite ? "已收藏" : "已取消收藏");
  } finally { libraryBusy = false; paintSelection(); }
}
function assetCards(jobs, grouped = true) {
  if (!jobs.length) return `<div class="empty-state">${page === "library" && libraryScope === "favorites" ? "暂无收藏" : "暂无相关资产"}</div>`;
  let lastDate = "";
  return (
    (grouped ? "" : '<div class="asset-grid">') +
    jobs
      .map((j) => {
        const date = dateLabel(j.created),
          heading =
            date === lastDate || !grouped
              ? ""
              : `</div><h2 class="asset-date">${date}</h2><div class="asset-grid">`;
        lastDate = date;
        return (
          heading +
          `<article class="asset-card ${isFavorite("job:" + j.id) ? "is-favorite" : ""}" data-asset-key="job:${j.id}" data-job="${j.id}" id="job-${j.id}">${selectionButton("job:" + j.id, kindLabel(j) + " #" + j.id)}
      <button class="asset-preview" data-act="detail" data-id="${j.id}" aria-label="预览${kindLabel(j)} #${j.id}">
        ${j.result ? (isAudio(j) ? `<span class="audio-cover">${ic("voice")}<span>${esc(j.prompt.slice(0,58))}</span></span>` : isImage(j) ? `<img loading="lazy" src="${mediaURL(j.result)}" alt="生成图片">` : `<video preload="metadata" muted loop playsinline src="${mediaURL(j.result)}#t=0.05"></video>`) : j.refs[0] ? `<img loading="lazy" src="${mediaURL(j.refs[0])}" alt="">` : `<span class="placeholder-media">${ic(isAudio(j) ? "voice" : isImage(j) ? "picture" : "film")}</span>`}
        <span class="asset-duration">${j.status === "done" ? (isImage(j) ? "" : durationLabel(Math.round(j.actual?.duration ?? j.seconds))) : esc(jobStatusLabel(j))}</span>
        ${!isImage(j) ? `<span class="asset-play">${ic("play")}</span>` : ""}
      </button>
      <div class="asset-actions">${j.model === "storyboard" ? "" : `<button data-act="edit" data-id="${j.id}" ${!canEditJob(j) ? "disabled" : ""} title="重新编辑">${ic("edit")}</button>`}${j.result ? `<a href="/media/${j.result}?download=true" download title="下载">${ic("download")}</a>${favoriteButton("job:" + j.id)}` : ""}</div>
      ${["running", "queued", "done"].includes(j.status) ? `<div class="pending-caption" data-time-job="${j.id}">${esc(timingLabel(j))}</div>` : ""}
    </article>`
        );
      })
      .join("")
      .replace(/^<\/div>/, "") +
    "</div>"
  );
}
function imageCards() {
  const generated = libraryJobs();
  const uploaded = libraryUploads();
  if (!generated.length && !uploaded.length) return `<div class="empty-state">${libraryScope === "favorites" ? "暂无收藏" : "暂无相关资产"}</div>`;
  return (generated.length ? assetCards(generated) : "") + (uploaded.length ? `<h2 class="asset-date">上传图片</h2><div class="asset-grid">${uploaded.map(a => `<article class="asset-card ${isFavorite("asset:" + a.id) ? "is-favorite" : ""}" data-asset-key="asset:${a.id}">${selectionButton("asset:" + a.id, "图片 " + a.id.slice(0, 6))}<button class="asset-preview" data-act="image-detail" data-key="${a.id}" aria-label="预览图片"><img loading="lazy" src="${mediaURL(a.id)}" alt="参考图片"></button><div class="asset-actions"><button data-act="use" data-key="${a.id}" title="用作参考图">${ic("plus")}</button><a href="/media/${a.id}?download=true" download title="下载">${ic("download")}</a>${favoriteButton("asset:" + a.id)}</div></article>`).join("")}</div>` : "");
}
function referenceAssetCards() {
  const items=libraryUploads();if(!items.length)return '';
  return `<h2 class="asset-date">上传${libraryTab==='videos'?'视频':'音频'}</h2><div class="asset-grid">${items.map(a=>`<article class="asset-card" data-asset-key="asset:${a.id}">${selectionButton('asset:'+a.id,'参考素材')}<button class="asset-preview" data-act="h3-preview" data-key="${a.id}" aria-label="预览参考素材">${referenceMedia(a.id)}</button><div class="asset-actions"><button data-act="use" data-key="${a.id}" title="用作参考">${ic('plus')}</button><a href="/media/${a.id}?download=true" download title="下载">${ic('download')}</a>${favoriteButton('asset:'+a.id)}</div></article>`).join('')}</div>`;
}
function homeView() {
  return `<div class="home-view"><h1>你好，今天想要<span>创作</span>什么？</h1><div id="home-composer" class="home-composer"></div>
    <section class="recent-section"><div class="section-head"><h2>生成历史</h2><button class="quiet-button" data-nav="library">查看全部 ${chevron()}</button></div><div id="recent-grid">${assetCards(state.jobs.slice(0, 8), false)}</div></section></div>`;
}
function libraryView() {
  return `<div class="assets-view ${selectingAssets ? "is-selecting" : ""} ${referencePicking ? "is-picking-reference" : ""}"><div class="asset-top"><div class="library-scopes" role="tablist" aria-label="资产视图"><button class="top-tab ${libraryScope === "history" ? "selected" : ""}" role="tab" aria-selected="${libraryScope === "history"}" data-act="library-scope" data-value="history">生成历史</button><button class="top-tab ${libraryScope === "favorites" ? "selected" : ""}" role="tab" aria-selected="${libraryScope === "favorites"}" data-act="library-scope" data-value="favorites">收藏夹</button></div><div id="selection-toolbar">${selectionToolbar()}</div></div><div class="asset-filter" role="tablist" aria-label="资产类型">${referencePicking ? "" : `<button role="tab" aria-selected="${libraryTab === "videos"}" data-tab="videos">视频</button>`}<button role="tab" aria-selected="${libraryTab === "images"}" data-tab="images">图片</button>${referencePicking ? "" : `<button role="tab" aria-selected="${libraryTab === "audio"}" data-tab="audio">语音</button>`}</div><div id="library-grid">${libraryTab !== "images" ? assetCards(libraryJobs())+referenceAssetCards() : imageCards()}</div></div><div id="asset-composer" class="floating-composer"></div>`;
}
function queueView() {
  const jobs = state.jobs
    .filter((j) => ["queued", "running"].includes(j.status))
    .reverse();
  return `<div class="management-view"><div class="page-heading"><h1>任务队列</h1></div><div class="list-surface">${jobs.length ? jobs.map((j) => `<div class="job-row"><span class="job-id">#${j.id}</span><div class="job-row-main"><button data-act="detail" data-id="${j.id}">${esc(j.prompt)}</button><div class="metadata"><span>${esc(j.author)}</span><span>${j.width && j.height ? j.width + " × " + j.height : "原生"}</span><span>${isAudio(j) ? "语音" : isImage(j) ? "图片" : j.seconds + "s"}</span></div></div><div class="job-progress"><span>${jobStatusLabel(j)}</span><small data-time-job="${j.id}">${esc(timingLabel(j))}</small></div><div class="job-actions">${j.status === "queued" && (j.owner === state.me.id || state.me.role === "admin") ? `<button class="quiet-button" data-act="cancel" data-id="${j.id}">取消</button>` : ""}</div></div>`).join("") : '<div class="empty-state">暂无待处理任务</div>'}</div></div>`;
}
function nodeList() {
  if (!state.nodes.length) return '<div class="empty-state">暂无接入实例</div>';
  return state.nodes
    .map((n) => {
      const status =
        n.stage === "offline"
          ? "离线"
          : n.control === "paused"
            ? "已暂停"
            : n.control === "draining"
              ? "完成后下线"
              : labels[n.stage];
      return `<article class="node-row"><div class="node-heading"><span class="node-icon">${ic("gpu")}</span><h2>${esc(n.name)}</h2><span class="node-state">${esc(status)}</span></div><div class="metadata"><span>${esc(n.contributor)}</span><span>${esc((n.models || ["MiniMax H3"]).map(m=>state.gpu_models?.[m]?.label || m).join(" · "))}</span>${n.profile?.gpu_name?`<span>${esc(n.profile.gpu_name)} · ${n.profile.vram_gib} GiB</span>`:""}</div>${n.detail && n.stage !== "ready" && n.detail !== "完整模式已就绪" ? `<p class="install-detail">${esc(n.detail)}</p>` : ""}${
        state.me.role === "admin"
          ? `<div class="node-actions">${(n.control === "active"
              ? [
                  ["drain", "完成后下线"],
                  ["stop", "立即断开"],
                ]
              : [["resume", "恢复接单"]]
            )
              .concat([["remove", "移除"]])
              .map(
                ([action, text]) =>
                  `<button class="quiet-button" data-act="node" data-id="${n.id}" data-op="${action}">${text}</button>`,
              )
              .join("")}</div>`
          : ""
      }</article>`;
    })
    .join("");
}
function gpuView() {
  return `<div class="management-view"><div class="page-heading"><h2>GPU 实例</h2><button class="primary" data-act="pair">${ic("plus")}接入GPU实例</button></div><div class="list-surface">${nodeList()}</div></div>`;
}
function teamView() {
  return `<div class="management-view"><div class="page-heading"><h2>成员管理</h2><div class="team-add-actions"><button class="primary" data-act="add-member">${ic("plus")}添加成员</button></div></div>
  <div class="list-surface">${state.users.map((u) => `<div class="member-row">${avatarImage(u)}<div class="member-identity"><span class="member-name">${esc(displayName(u))}</span><small>${esc(u.name)}${!u.active ? "　已停用" : ""}</small></div>${u.role === "member" ? `<div class="member-actions"><button class="quiet-button" data-act="member-password" data-id="${u.id}">修改密码</button><button class="quiet-button danger" data-act="delete-member" data-id="${u.id}">删除</button></div>` : ""}</div>`).join("")}
  </div></div>`;
}
function promptDisplay(j) {
  return esc(j.prompt).replace(/&lt;Picture (\d+)&gt;/g, (_, n) => {
    const key = j.refs[Number(n) - 1];
    return key
      ? `<span class="inline-reference"><img src="${mediaURL(key)}" alt="">图片${n}</span>`
      : esc("@图片" + n);
  });
}
function detailView() {
  const j = state.jobs.find((x) => x.id === detailId);
  if (!j) {
    detailId = null;
    return libraryView();
  }
  if (isAudio(j)) return audioDetailView(j);
  const index = state.jobs.indexOf(j);
  return `<div class="detail-view ${detailEditing ? "editing" : ""}">
    <div class="detail-stage"><button class="detail-back icon-button" data-act="close-detail" aria-label="返回">${ic("back")}</button>
      <div class="video-stage">${j.result ? (isImage(j) ? `<img class="detail-image" src="${mediaURL(j.result)}" alt="生成图片">` : playerMarkup(j)) : `<div class="result-pending">${ic(isAudio(j) ? "voice" : isImage(j) ? "picture" : "film")}<h2>${jobStatusLabel(j)}</h2><p data-time-job="${j.id}">${esc(timingLabel(j) || j.note)}</p>${j.status === "queued" && (j.owner === state.me.id || state.me.role === "admin") ? `<button class="quiet-button" data-act="cancel" data-id="${j.id}">取消生成</button>` : ""}</div>`}</div>
      <div class="detail-paging"><button class="icon-button" data-act="previous" aria-label="上一个" ${index === 0 ? "disabled" : ""}>${ic("chevron")}</button><button class="icon-button" data-act="next" aria-label="下一个" ${index === state.jobs.length - 1 ? "disabled" : ""}>${ic("chevron")}</button></div>
      <div id="detail-composer" class="detail-composer"></div>
    </div>
    <aside class="detail-info">
      <div class="detail-actions">${j.result ? `${favoriteButton("job:" + j.id, true)}<a class="download-action" href="/media/${j.result}?download=true" download>${ic("download")}下载</a>` : `<span class="muted">#${j.id}</span>`}<button class="icon-button" data-menu="detail-more" aria-label="更多">${ic("more")}</button></div>
      <div class="detail-copy"><div class="subheading">${j.model === "storyboard" ? "成片说明" : (isImage(j) ? "图片" : "视频") + "提示词"}</div><p class="prompt-text">${promptDisplay(j)}</p>${j.refs.length ? `<div class="detail-references">${j.refs.map((key, i) => `<button data-act="h3-preview" data-key="${key}" aria-label="预览参考素材${i + 1}">${referenceMedia(key)}</button>`).join("")}</div>` : ""}<div class="metadata detail-params"><span>${jobParameters(j)}</span>${isMuse(j) || j.model === "storyboard" ? "" : `<span>${j.ratio}</span>`}</div><details class="${isMuse(j) ? "muse-details" : ""}"><summary>详细信息</summary><dl><dt>尺寸</dt><dd>${j.width && j.height ? j.width + " × " + j.height : "原生"}</dd>${isMuse(j) ? `<dt>期望比例</dt><dd>${j.ratio}</dd>${isImage(j) ? "" : `<dt>期望时长</dt><dd>${j.seconds}s</dd><dt>实际时长</dt><dd>${j.actual?.duration ? j.actual.duration + "s" : "—"}</dd>`}` : ""}${isImage(j) || isMuse(j) || j.model === "storyboard" ? "" : `<dt>采样步数</dt><dd>${j.sampling_steps === 4 ? "4（快速）" : j.sampling_steps ?? 20}</dd><dt>随机种子</dt><dd>${j.seed}</dd>`}<dt>创作者</dt><dd>${esc(j.author)}</dd><dt>时间</dt><dd>${new Date(j.created * 1000).toLocaleString()}</dd><div data-time-details="${j.id}">${timingDetails(j)}</div></dl></details></div>
      <div class="detail-footer">${isImage(j) && j.result ? `<button class="full-button" data-act="image-to-video" data-key="${j.result}">${ic("film")}生成视频</button>` : ""}${j.model === "storyboard" ? (/^[a-f0-9]{32}$/.test(j.actual?.canvas_project || "") ? `<a class="full-button" href="/canvas/${j.actual.canvas_project}?workspace=${state.workspace_id}">打开来源画布</a>` : "") : `<div class="edit-actions"><button data-act="edit" data-id="${j.id}" ${!canEditJob(j) ? "disabled" : ""} class="${detailEditing ? "selected" : ""}">${ic("edit")}重新编辑</button><button data-act="again" data-id="${j.id}" ${generationDisabled(j) ? "disabled" : ""}>${ic("repeat")}再次生成</button></div>`}<button class="locate-action" data-act="locate" data-id="${j.id}">${ic("frame")}在生成页定位</button></div>
    </aside></div>`;
}
function imageView() {
  const asset = state.assets.find((a) => a.id === imageId),
    fromJob = state.jobs.some((j) => j.refs.includes(imageId));
  if (!asset && !fromJob) {
    imageId = null;
    return libraryView();
  }
  return `<div class="detail-view image-detail"><div class="detail-stage"><button class="detail-back icon-button" data-act="close-detail" aria-label="返回">${ic("back")}</button><div class="video-stage"><img class="detail-image" src="${mediaURL(imageId)}" alt="参考图片"></div></div><aside class="detail-info"><div class="detail-actions">${asset ? favoriteButton("asset:" + imageId, true) : ""}<a class="download-action" href="/media/${imageId}?download=true" download>${ic("download")}下载</a></div><div class="detail-copy">${asset ? `<div class="metadata">${asset.w} × ${asset.h}</div>` : ""}</div><div class="detail-footer"><button class="full-button" data-act="use" data-key="${imageId}">${ic("picture")}用作参考图</button>${asset && (asset.owner === state.me.id || state.me.role === "admin") ? `<button class="quiet-button danger" data-act="delete-image" data-key="${imageId}">删除</button>` : ""}</div></aside></div>`;
}
let chatLoad = null;
function chatView() { return '<div id="chat-root"></div>'; }
async function mountChat() {
  const target=document.querySelector('#chat-root');if(!target)return;
  if(!chatLoad)chatLoad=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=document.querySelector('meta[name="fm-chat-script"]')?.content||'/static/chat.js';script.onload=resolve;script.onerror=()=>{chatLoad=null;reject(new Error('对话页面加载失败，请重新打开'));};document.head.appendChild(script);});
  try {await chatLoad;if(target.isConnected)window.FumiaoChat.mount(target,{workspace:state.workspace_id,userId:state.me.id});}catch(error){notify(error.message)}
}
function renderPage(animate = true) {
  if (modal.open || modalSettling) { pageRenderPending = true; return; }
  pageRenderPending = false;
  const oldComposer = composer?.isConnected
    ? composer.getBoundingClientRect()
    : null;
  const oldPlayer = document.querySelector(".player");
  const oldVideo = document.querySelector(".detail-video");
  const oldAudio = document.querySelector('.detail-audio');
  const oldVideoRect = oldVideo?.getBoundingClientRect();
  const oldVideoSrc = oldVideo?.getAttribute("src");
  closeMenu();
  composer?.remove();
  window.FumiaoChat?.unmount();
  const previousView = document.querySelector("#view");
  if (!previousView) return;
  // Recreate the page root after dialog transitions. Keeping a main element
  // across close + redraw can leave its subtree outside WebKit's hit-test tree.
  const view = previousView.cloneNode(false);
  if (imageId) view.innerHTML = imageView();
  else if (detailId !== null) view.innerHTML = detailView();
  else
    view.innerHTML = (
      {
        home: homeView,
        chat: chatView,
        library: libraryView,
        queue: queueView,
        settings: settingsView,
      }[page] || homeView
    )();
  previousView.replaceWith(view);
  void mountChat();
  const newAudio=view.querySelector('.detail-audio');
  if (oldAudio && newAudio?.getAttribute('src')===oldAudio.getAttribute('src')) newAudio.replaceWith(oldAudio);
  else oldAudio?.pause();
  const nextPlayer = view.querySelector(".player");
  if (oldPlayer && nextPlayer?.dataset.src === oldPlayer.dataset.src)
    nextPlayer.replaceWith(oldPlayer);
  else oldVideo?.pause();
  wirePlayer();
  bindProfileForm();
  bindOpenAISettings();
  bindChatSettings();
  bindModelSettings();
  bindCreditSettings();
  const target = view.querySelector(
    detailId !== null
      ? "#detail-composer"
      : page === "library"
        ? "#asset-composer"
        : "#home-composer",
  );
  if (target && (!detailId || detailEditing) && !imageId)
    target.appendChild(composer);
  updateComposerSpace();
  for (const b of document.querySelectorAll("nav [data-nav]")) {
    const active = b.dataset.nav === page;
    b.classList.toggle("active", active);
    if (active) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  if (animate && !matchMedia("(prefers-reduced-motion: reduce)").matches)
    view.animate([{ opacity: 0.5 }, { opacity: 1 }], {
      duration: 160,
      easing: "ease-out",
    });
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (animate && !reduced) {
    const play = document.querySelector(".detail-video");
    if (oldVideoRect && play?.getAttribute("src") === oldVideoSrc)
      animateBetween(play, oldVideoRect);
    if (
      oldComposer &&
      composer.isConnected &&
      oldComposer.top >= 0 &&
      oldComposer.top < innerHeight
    )
      animateBetween(composer, oldComposer);
  }
  bindAssetPreviews(view);
  paintSelection();
}
function bindAssetPreviews(container) {
  container.querySelectorAll(".asset-preview video").forEach((video) => {
    const button = video.closest("button");
    button.addEventListener("mouseenter", () => { if (!selectingAssets) video.play().catch(() => {}); });
    button.addEventListener("mouseleave", () => video.pause());
  });
}
function animateBetween(element, before) {
  const after = element.getBoundingClientRect();
  if (!before.width || !after.width || !after.height) return;
  element.animate(
    [
      {
        transformOrigin: "top left",
        transform: `translate(${before.left - after.left}px,${before.top - after.top}px) scale(${before.width / after.width},${before.height / after.height})`,
      },
      { transformOrigin: "top left", transform: "none" },
    ],
    { duration: 260, easing: "cubic-bezier(.22,1,.36,1)" },
  );
}
function go(destination) {
  referencePicking = null;
  if (destination === "canvas") { persist(); location.assign("/canvas?workspace=" + state.workspace_id); return; }
  if (destination === "gpu" || destination === "team") {
    settingsTab = destination;
    destination = "settings";
  }
  if (!navItems[destination] && destination !== "settings") return;
  if (page === "library") assetScroll = scrollY;
  // Lab 使用 #lab 作为可直接打开的地址（fmWorker 的「打开 Lab」指向工作台路由加 #lab）。
  resetSelection();
  page = destination;
  detailId = null;
  imageId = null;
  detailEditing = false;
  renderPage();
  scrollTo({ top: 0, behavior: "instant" });
}
function openDetail(id) {
  assetScroll = scrollY;
  detailId = id;
  imageId = null;
  detailEditing = false;
  renderPage();
  scrollTo(0, 0);
}
function closeDetail() {
  if (imageId && detailId !== null) {
    imageId = null;
    renderPage();
    return;
  }
  detailId = null;
  imageId = null;
  detailEditing = false;
  renderPage();
  scrollTo(0, assetScroll);
}
function loadJob(j) {
  draft = {
    h3:isH3(j)?h3Options(j):undefined,
    flowSourceJob:j.actual?.flow_source_job || null,
    audioModel:isAudio(j)?j.model:"breeze-tts-2",voiceDescription:j.audio_settings?.instruction || "",
    kind: j.kind || "video", videoModel: !isImage(j) ? j.model : "MiniMax H3", model: isImage(j) ? j.model : "", imageQuality: j.image_quality || "medium", resolution: j.quality === 2048 ? "2K" : "1K",
    prompt: j.prompt,
    ratio: j.ratio,
    quality: isImage(j) ? "480" : String(j.quality),
    seconds: isImage(j) ? "5" : String(j.seconds),
    seed: "",
    sampling_steps: normalizedSteps(j.sampling_steps),
    fast_mode: Number(j.sampling_steps) === 4,
  };
  refs = [...j.refs];
  normalizeModelParams();
  parent = j.id;
  retainedSeed = isImage(j) || isMuse(j) || flowSpec(j) ? null : j.seed;
  submitId = crypto.randomUUID();
  renderEditor();
  updateComposerControls();
  persist();
}
async function submitJob(j = null) {
  if (revisionPending || uploadBusy) return;
  if (generationDisabled(j || draft)) return;
  const flowIssue=h3InputIssue(j || draft)||flowInputIssue(j || draft);if(flowIssue){notify(flowIssue);return;}
  if (!j && !draft.prompt.trim()) return;
  if (!j && draft.prompt.length > promptLimit()) {
    notify("最多输入 "+promptLimit()+" 字");
    return;
  }
  revisionPending = true;
  updateComposerControls();
  const submittedId = submitId;
  try {
    const body = j
      ? {
          prompt: j.prompt,
          refs: j.refs,
          ratio: j.ratio,
          quality: j.quality,
          seconds: j.seconds,
          sampling_steps: effectiveSteps(j),
          seed: null,
          parent: j.id,
          uid: crypto.randomUUID(),
        }
      : {
          ...draft,
          refs: [...refs],
          quality: Number(draft.quality),
          seconds: Number(draft.seconds),
          seed: draft.seed === "" ? null : Number(draft.seed),
          parent,
          uid: submitId,
        };
    body.model = j ? j.model || "MiniMax H3" : draft.videoModel || "MiniMax H3";
    if(isH3(j||draft)){body.h3=h3Options(j||draft);if(!j)body.refs=activeReferences();}else delete body.h3;
    body.sampling_steps = body.model === "MiniMax H3" ? effectiveSteps(body) : 20;
    body.flow_source_job = j ? j.actual?.flow_source_job || null : draft.flowSourceJob || null;
    const image = isImage(j || draft), audio=isAudio(j || draft);
    const imageBody = j ? {prompt: j.prompt, refs: j.refs, ratio: j.ratio, resolution: j.quality === 2048 ? "2K" : "1K", image_quality: flowSpec(j)?"medium":j.image_quality, model: j.model, parent: j.id, uid: crypto.randomUUID()}
      : {prompt: draft.prompt, refs: [...refs], ratio: draft.ratio, resolution: draft.resolution, image_quality: draft.imageQuality, model: draft.model || state.images.default_model, parent, uid: submitId};
    body.price_revision = imageBody.price_revision = state.pricing?.revision;
    body.asset_packs = imageBody.asset_packs = j ? [] : (draft.packs || []).map(({id,revision})=>({id,revision}));
    const audioBody={prompt:j?j.prompt:draft.prompt,instruction:j?j.audio_settings?.instruction || "":draft.voiceDescription || "",model:selectedModel(j || draft),uid:j?crypto.randomUUID():submitId,parent:j?j.id:parent,seed:j?null:draft.seed===""?null:Number(draft.seed),price_revision:state.pricing?.revision};
    const result = await req(audio ? "/api/audio-jobs" : image ? "/api/image-jobs" : "/api/jobs", audio ? audioBody : image ? imageBody : body);
    if (!Number.isSafeInteger(result.id) || result.id < 1) throw new Error("提交结果尚未确认，请重试");
    if (!j && submitId === submittedId) {
      draft.prompt = "";
      draft.packs = [];
      refs = [];
      draft.h3={mode:h3Options().mode,first_frame:null,last_frame:null,video_audio:[]};delete draft.h3ReferenceDraft;
      parent = null;
      retainedSeed = null;
      savedRange = null;
      renderEditor();
    }
    submitId = crypto.randomUUID();
    persist();
    notify("已加入生成队列");
    referencePicking = null;
    await refresh();
    page = "library";
    libraryTab = audio ? "audio" : image ? "images" : "videos";
    libraryScope = "history"; resetSelection();
    detailId = null;
    imageId = null;
    detailEditing = false;
    renderPage();
    scrollTo(0, 0);
    document.querySelector("#job-" + result.id)?.classList.add("new-result");
  } finally {
    revisionPending = false;
    updateComposerControls();
  }
}
function submitCurrent() {
  return submitJob();
}
function displayCopy(title, description, value) {
  showModal(
    `<h2>${esc(title)}</h2><p>${esc(description)}</p><label class="formlabel"><textarea class="mono" readonly rows="4">${esc(value)}</textarea></label><button class="primary" id="copy">复制</button>`,
  );
  dialogBody.querySelector("#copy").onclick = () => copyText(value);
}
async function handle(button) {
  const act = button.dataset.act,
    id = Number(button.dataset.id),
    key = button.dataset.key;
  if (button.dataset.nav) {
    go(button.dataset.nav);
    return;
  }
  if (button.dataset.tab) {
    resetSelection();
    libraryTab = button.dataset.tab;
    renderPage();
    return;
  }
  if (button.dataset.menu) {
    openMenu(button.dataset.menu, button);
    return;
  }
  switch (act) {
    case "recharge": await rechargeDialog(); break;
    case "recharge-history": await rechargeHistory(); break;
    case "recharge-order": await rechargeOrderDialog(button.dataset.order); break;
    case "start-select":
      selectingAssets = true; paintSelection(); break;
    case "cancel-select":
      resetSelection(); paintSelection(); break;
    case "select-asset":
      toggleSelection(key); break;
    case "select-all": {
      const keys = visibleAssetKeys(), all = keys.length && keys.every(k => selectedAssets.has(k));
      if (!all && keys.length > 200) notify("一次最多选择 200 项，已选中前 200 项");
      for (const key of keys.slice(0, 200)) { if (all) selectedAssets.delete(key); else selectedAssets.add(key); }
      paintSelection(); break;
    }
    case "library-scope":
      resetSelection(); libraryScope = button.dataset.value; renderPage(); break;
    case "favorite":
      await saveFavorites([key], !isFavorite(key)); break;
    case "batch-favorite": {
      const keys = [...selectedAssets];
      if (keys.length) await saveFavorites(keys, !keys.every(isFavorite));
      break;
    }
    case "batch-download": {
      if (libraryBusy || !selectedAssets.size) break;
      libraryBusy = true; downloadBusy = true; paintSelection();
      try {
        const result = await req("/api/assets/batch-download", {keys: [...selectedAssets]});
        const link = document.createElement("a");
        link.href = result.url; link.download = result.filename;
        document.body.appendChild(link); link.click(); link.remove();
        notify("已开始下载");
      } finally { libraryBusy = false; downloadBusy = false; paintSelection(); }
      break;
    }
    case "batch-delete": {
      const keys = [...selectedAssets];
      if (!keys.length || libraryBusy) break;
      confirmAction(`删除所选 ${keys.length} 项内容？`, "删除后将从团队资产和收藏夹中移除，无法恢复。", async () => {
        const result = await req("/api/assets/batch-delete", {keys});
        resetSelection(); notify(`已删除 ${result.deleted} 项内容`);
      });
      break;
    }
    case "creation":

      if (button.dataset.value === "image" && suspendedImageDraft) {
        ({draft, refs, parent, retainedSeed, submitId} = suspendedImageDraft);
        refs = refs.filter(key => state.assets.some(a => a.id === key));
        if (!state.jobs.some(j => j.id === parent)) parent = null;
        suspendedImageDraft = null; savedRange = null;
        renderEditor(); persist(); updateComposerControls(); closeMenu(true);
        break;
      }
      draft.kind = button.dataset.value;
      syncImageAvailability();
      normalizeModelParams();
      parent = null; retainedSeed = null;
      submitId = crypto.randomUUID();
      persist(); updateComposerControls(); closeMenu(true);
      break;
    case "save-voice":
      draft.voiceDescription=popover.querySelector('#voice-description').value.trim();submitId=crypto.randomUUID();persist();updateComposerControls();closeMenu(true);break;
    case "image-model":
      if (!modelAvailable(button.dataset.value)) break;
      if (isAudio()) draft.audioModel=button.dataset.value;
      else if (isImage()) draft.model = button.dataset.value;
      else { draft.videoModel = button.dataset.value; if (draft.videoModel === "muse-video") draft.seconds = "6"; }
      normalizeModelParams();
      submitId = crypto.randomUUID(); persist(); updateComposerControls(); closeMenu(true);
      break;
    case "image-quality":
      draft.imageQuality = button.dataset.value;
      submitId = crypto.randomUUID(); persist(); updateComposerControls(); closeMenu(true);
      break;
    case "resolution":
      draft.resolution = button.dataset.value;
      submitId = crypto.randomUUID(); persist(); updateComposerControls(); showMenuBody("format");
      break;
    case "image-to-video":
      draft.kind = "video"; draft.prompt = ""; draft.quality = "480"; draft.seconds = "5"; draft.seed = "";
      refs = [key]; parent = null; retainedSeed = null; submitId = crypto.randomUUID();
      renderEditor(); updateComposerControls(); persist(); go("home");
      composer.querySelector("#prompt").focus();
      break;
    case "avatar-picker":
      avatarPicker();
      break;
    case "choose-avatar": {
      state.me = await req("/api/me", { avatar: key }, "PATCH");
      paintAccount();
      closeModal();
      notify("头像已更新");
      await refresh();
      break;
    }
    case "own-password":
      passwordDialog();
      break;
    case "add-member":
      addMemberDialog();
      break;
    case "member-password": {
      const user = state.users.find((u) => u.id === id);
      if (user) passwordDialog(user);
      break;
    }
    case "delete-member": {
      const user = state.users.find((u) => u.id === id);
      if (!user) break;
      confirmAction(
        "删除 " + displayName(user) + "？",
        "该成员无法再登录，作品保留。其接入实例会断开，受影响任务重新排队。",
        () => req("/api/users/" + id, undefined, "DELETE"),
      );
      break;
    }
    case "close": closeModal(); break;
    case "switch-workspace":
      if (uploadBusy) { notify("图片正在上传，请稍候切换"); break; }
      persist();
      await req("/api/workspaces/" + id + "/select", {});
      location.assign("/studio?workspace=" + id);
      break;
    case "create-workspace":
      closeMenu(); workspaceDialog(); break;
    case "edit-workspace":
      workspaceDialog(state.workspaces.find(w => w.id === id)); break;
    case "settings-tab":
      settingsTab = button.dataset.value;
      if (
        ["team", "invites", "storage", "openai", "workspaces", "models", "prices", "creditAdmin"].includes(settingsTab) &&
        state.me.role !== "admin"
      )
        settingsTab = "general";
      renderPage();
      break;
    case "set-theme":
      window.setFumiaoTheme(button.dataset.value);
      paintThemeChoices();
      break;
    case "theme":
      window.setFumiaoTheme(
        document.documentElement.dataset.theme === "dark" ? "light" : "dark",
      );
      break;
    case "collapse": {
      const keyboard = button.matches(":focus-visible");
      collapsed = !collapsed;
      localStorage.setItem("fm-sidebar", collapsed ? "collapsed" : "expanded");
      applySidebar();
      if (keyboard)
        document
          .querySelector(collapsed ? ".expand-button" : ".collapse-button")
          .focus();
      closeMenu();
      break;
    }
    case "h3-mode": setH3Mode(button.dataset.value);break;
    case "h3-upload": h3UploadSlot=button.dataset.slot;composer.querySelector('#files').click();break;
    case "h3-swap": {const o=h3Options();draft.h3={...o,first_frame:o.last_frame,last_frame:o.first_frame};submitId=crypto.randomUUID();persist();updateComposerControls();break;}
    case "h3-remove-frame": draft.h3={...h3Options(),[button.dataset.slot]:null};submitId=crypto.randomUUID();persist();updateComposerControls();break;
    case "h3-preview": {
      const returnTo=button.closest('#popover')?composer?.querySelector('[data-act=reference]'):button;
      showModal(`<div class="h3-media-preview">${referenceMedia(key,true)}</div><button class="quiet-button" data-act="close">关闭</button>`);
      if(returnTo?.isConnected)modalReturnFocus=returnTo;
      break;
    }
    case "reference":
      openMenu("references", button);
      break;
    case "upload":
      closeMenu();
      composer.querySelector("#files").click();
      break;
    case "asset-packs": {
      closeMenu();
      showModal('<h2>素材包</h2><div id="asset-packs-host">正在加载…</div>');
      const target=dialogBody.querySelector('#asset-packs-host');
      if(!chatLoad)chatLoad=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=document.querySelector('meta[name="fm-chat-script"]')?.content||'/static/chat.js';script.onload=resolve;script.onerror=()=>{chatLoad=null;reject(new Error('素材包加载失败，请重新打开'));};document.head.appendChild(script);});
      await chatLoad;
      if(target.isConnected)window.FumiaoChat.mountPacks(target,{
        workspace:state.workspace_id,userId:state.me.id,admin:state.me.role==='admin',selected:draft.packs||[],imageRefs:packReferences(),
        onImportImages:async ids=>{state.assets=(await req("/api/state")).assets;importReferenceImages(ids);closeModal();},
        onImportPack:async pack=>{
          state.assets=(await req("/api/state")).assets;
          if(h3Frames())throw new Error('首尾帧模式请从素材包中选择图片');
          const packs=[...(draft.packs||[]).filter(p=>p.id!==pack.id),pack];
          checkReferenceImages(packs.flatMap(p=>p.media),activeReferences());
          draft.packs=packs;submitId=crypto.randomUUID();persist();updateComposerControls();closeModal();
        },
        onRemovePack:id=>{draft.packs=(draft.packs||[]).filter(p=>p.id!==id);submitId=crypto.randomUUID();persist();updateComposerControls();closeModal();}
      });
      break;
    }
    case "choose-assets":
      beginReferencePicking();
      break;
    case "finish-reference-picking":
      finishReferencePicking();
      break;
    case "mention":
      insertReference(key);
      break;
    case "ref-left": {
      const index = refs.indexOf(key);
      if (index > 0) {
        [refs[index - 1], refs[index]] = [refs[index], refs[index - 1]];
        updateComposerControls();
        saveEditor();
        showMenuBody("references");
      }
      break;
    }
    case "unref":
      refs = refs.filter((x) => x !== key);
      if(isH3())draft.h3={...h3Options(),video_audio:h3Options().video_audio.filter(k=>k!==key)};
      updateComposerControls();
      saveEditor();
      if(menuKind)showMenuBody("references");
      break;
    case "ratio":
      if(h3Frames()&&activeReferences().length)break;
      if(!setFlowParams({ratio:button.dataset.value}))draft.ratio = button.dataset.value;
      submitId = crypto.randomUUID();
      persist();
      updateComposerControls();
      showMenuBody("format");
      break;
    case "flow-mode":
      if(!setFlowParams({mode:button.dataset.value}))break;
      submitId=crypto.randomUUID();persist();updateComposerControls();showMenuBody('format');
      break;
    case "quality":
      draft.quality = button.dataset.value;
      submitId = crypto.randomUUID();
      persist();
      updateComposerControls();
      showMenuBody("format");
      break;
    case "seconds":
      if(!setFlowParams({seconds:Number(button.dataset.value)}))draft.seconds = button.dataset.value;
      submitId = crypto.randomUUID();
      persist();
      updateComposerControls();
      closeMenu(true);
      break;
    case "sampling-steps": {
      const group = button.closest('.sampling-options');
      if (!group) break;
      group.dataset.value = button.dataset.value;
      for (const radio of group.querySelectorAll('[role="radio"]')) {
        const selected = radio === button;
        radio.setAttribute('aria-checked', String(selected));radio.tabIndex=selected?0:-1;
      }
      break;
    }
    case "save-seed": {
      const value = popover.querySelector("#seed").value.trim();
      if (
        value &&
        (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
      ) {
        notify("请输入有效的非负整数");
        break;
      }
      draft.seed = value;
      draft.fast_mode = popover.querySelector("#fast-mode")?.checked ?? draft.fast_mode;
      draft.sampling_steps = normalizedSteps(popover.querySelector(".sampling-options")?.dataset.value ?? draft.sampling_steps);
      scheduleEstimate();
      submitId = crypto.randomUUID();
      persist();
      closeMenu();
      break;
    }
    case "submit":
      await submitCurrent();
      break;
    case "detail":
      if (referencePicking && page === "library") { importReferenceImages([state.jobs.find(j=>j.id===id)?.result]); break; }
      if (selectingAssets && page === "library") { toggleSelection("job:" + id); break; }
      openDetail(id);
      break;
    case "image-detail": {
      if (referencePicking && page === "library") { importReferenceImages([key]); break; }
      if (selectingAssets && page === "library") { toggleSelection("asset:" + key); break; }
      const generated = state.jobs.find(j => isImage(j) && j.result === key);
      if (generated) openDetail(generated.id);
      else { imageId = key; renderPage(); }
      break;
    }
    case "close-detail":
      closeDetail();
      break;
    case "previous":
    case "next": {
      const index = state.jobs.findIndex((j) => j.id === detailId),
        next = index + (act === "next" ? 1 : -1);
      if (state.jobs[next]) {
        detailId = state.jobs[next].id;
        detailEditing = false;
        renderPage();
      }
      break;
    }
    case "edit": {
      const j = state.jobs.find((x) => x.id === id);
      if (!j || !canEditJob(j)) break;
      loadJob(j);
      detailId = j.id;
      imageId = null;
      detailEditing = true;
      renderPage();
      composer.querySelector("#prompt").focus();
      break;
    }
    case "again":
      await submitJob(state.jobs.find((j) => j.id === id));
      break;
    case "locate":
      detailId = null;
      imageId = null;
      page = "library";
      libraryTab = isImage(state.jobs.find(j => j.id === id) || {}) ? "images" : "videos";
      libraryScope = "history"; resetSelection();
      renderPage();
      document
        .querySelector("#job-" + id)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
      document.querySelector("#job-" + id)?.classList.add("new-result");
      break;
    case "use":
      if (referenceType(key) === "Picture") {
        importReferenceImages([key]);
        if(referencePicking)break;
        imageId=null;detailId=null;detailEditing=false;page="home";renderPage();composer.querySelector("#prompt").focus();break;
      }
      if (!h3Frames() && refs.length >= (isH3()?12:9)) {
        notify(isH3()?"最多选择 12 个参考素材":"最多上传 9 张参考图片");
        break;
      }
      if(referenceType(key)!=="Picture"&&!isH3()){notify("请先选择 MiniMax H3 全能参考模式");break;}
      if(h3Frames())assignH3Frame(key);else if (!refs.includes(key)) refs.push(key);
      persist();
      updateComposerControls();
      imageId = null;
      detailId = null;
      detailEditing = false;
      page = "home";
      renderPage();
      composer.querySelector("#prompt").focus();
      break;
    case "cancel":
      await req("/api/jobs/" + id + "/cancel", {});
      await refresh(true);
      break;
    case "delete": {
      closeMenu();
      confirmAction("删除该"+kindLabel(state.jobs.find(j => j.id === detailId) || {})+"？", "删除后将从当前工作区移除。", async () => {
        await req("/api/jobs/" + id, undefined, "DELETE");
        detailId = null;
        page = "library";
      });
      break;
    }
    case "delete-image":
      confirmAction(
        "删除该图片？",
        "正在被任务或作品引用的图片会保留。",
        async () => {
          await req("/api/assets/" + key, undefined, "DELETE");
          imageId = null;
        },
      );
      break;
    case "logout":
      await req("/api/logout", {});
      location.reload();
      break;
    case "pair": {
      button.disabled = true;
      try {
        const suggested = await req("/api/pairs/default-name");
        showModal(
          `<h2>接入GPU实例</h2><form id="pair"><label class="formlabel">实例名称<input name="node" value="${esc(suggested.name)}" required maxlength="45"></label><fieldset class="install-models"><legend>安装模型</legend>${Object.entries(state.gpu_models || {}).map(([model,spec])=>`<label class="check"><input type="checkbox" name="models" value="${esc(model)}" ${model==="MiniMax H3"?"checked":""}>${esc(spec.label)}<small>${spec.min_vram_gib} GiB 显存起</small></label>`).join("")}</fieldset><button class="primary">生成接入命令</button></form>`,
        );
        dialogBody.querySelector("#pair").onsubmit = async (event) => {
          event.preventDefault();
          const form = event.target, submit = form.querySelector("button");
          if (submit.disabled) return;
          submit.disabled = true;
          try {
            const value = form.node.value.trim();
            const models=[...form.querySelectorAll('[name="models"]:checked')].map(input=>input.value);
            const result = await req("/api/pairs", {name: value === suggested.name ? "" : value,models});
            displayCopy(
              "接入命令 · " + result.name,
              "在实例终端运行。30 分钟内有效，限用一次。",
              result.command,
            );
          } catch (error) {
            notify(error.message);
            submit.disabled = false;
          }
        };
      } finally { button.disabled = false; }
      break;
    }
    case "node": {
      const op = button.dataset.op,
        j = state.jobs.find((x) => x.node === id && x.status === "running");
      confirmAction(
        button.textContent + "？",
        (j ? `正在生成 #${j.id}。` : "") +
          {
            drain: "当前任务回传后停止接单。",
            stop: "当前任务可能需要重新生成。",
            remove: "此实例的接入凭据将失效。",
            resume: "实例在线后将继续接单。",
          }[op],
        () => req(`/api/nodes/${id}/${op}`, {}),
      );
      break;
    }
    case "invite": inviteDialog(); break;
    case "edit-invite": inviteDialog(state.invite_codes.find(i => i.id === Number(id))); break;
    case "copy-invite": {
      const code = state.invite_codes.find(i => i.id === Number(id))?.code;
      try { await navigator.clipboard.writeText(code); notify('邀请码已复制'); }
      catch { displayCopy('邀请码', '复制后分享给需要注册的成员。', code); }
      break;
    }
    case "toggle-invite": {
      const item = state.invite_codes.find(i => i.id === Number(id));
      confirmAction(item.enabled ? '停用这个邀请码？' : '启用这个邀请码？', item.enabled ? '停用后无法继续注册，已注册账户不受影响。' : '启用后将按原有有效期、积分和团队设置接受注册。', () => req(`/api/invite-codes/${id}`, {enabled: !item.enabled, expected_revision: item.revision}, 'PATCH'));
      break;
    }
    case "credit-adjust": creditAdjustment(Number(button.dataset.id)); break;
    case "credit-history": await creditHistoryDialog(Number(button.dataset.id)); break;
    case "credit-more": await showMoreCredits(button); break;
    case "disable":
      confirmAction("停用该成员？", "该成员创建的作品将留在团队资产中。", () =>
        req(`/api/users/${id}/disable`, {}),
      );
      break;
  }
}
document.addEventListener("click", (event) => {
  const button = event.target.closest(
    "[data-act],[data-nav],[data-tab],[data-menu]",
  );
  if (button && !button.disabled)
    handle(button).catch((error) => notify(error.message));
});
function refresh(force = false) {
  refreshForced ||= force;
  if (refreshing) return refreshing;
  refreshing = (async () => {
    do {
      const forceThisRead = refreshForced;
      refreshForced = false;
      await readState(forceThisRead);
    } while (refreshForced);
  })().finally(() => {
    refreshing = null;
    if (refreshForced) return refresh(true);
  });
  return refreshing;
}
async function readState(force = false) {
  try {
    const next = await req("/api/state"),
      old = state;
    // A mutation completed while this older request was in flight. Read again
    // before applying it, so stale data cannot undo the mutation's UI update.
    if (refreshForced) return;
    state = next;
    workspaceId = String(next.workspace_id);
    stateReceivedAt = Date.now()/1000;
    if (old) {
      const valid = new Set(next.assets.map(a => a.id));
      if (refs.some(key => !valid.has(key))) { refs = refs.filter(key => valid.has(key)); updateComposerControls(); saveEditor(); }
      if (parent && !next.jobs.some(j => j.id === parent)) { parent = null; retainedSeed = null; persist(); }
    }
    if (!old) {
      restoreDraft();
      syncImageAvailability();
      mountShell();
      const returnedOrder = new URLSearchParams(location.search).get('recharge');
      if (returnedOrder) {
        const clean = new URL(location.href); clean.searchParams.delete('recharge'); history.replaceState(null, '', clean);
        settingsTab = 'credits'; go('settings');
        if (returnedOrder === 'history') rechargeHistory().catch(e => notify(e.message));
        else rechargeOrderDialog(returnedOrder).catch(e => notify(e.message));
      }
      return;
    }
    paintTiming();
    scheduleEstimate();
    const workspacesChanged = JSON.stringify(old.workspaces) !== JSON.stringify(next.workspaces);
    const policyChanged = JSON.stringify([old.model_policy,old.model_access,old.team_model_policies]) !== JSON.stringify([next.model_policy,next.model_access,next.team_model_policies]);
    let repaint = force;
    if (workspacesChanged) {
      const trigger = document.querySelector('.workspace-switch');
      const updated = workspaceButtonElement();
      if (trigger) {
        trigger.innerHTML = updated.innerHTML;
        trigger.title = updated.title;
        trigger.setAttribute('aria-label', updated.getAttribute('aria-label'));
      }
      if (menuKind === 'workspaces') closeMenu();
      if (page === 'settings' && settingsTab === 'workspaces') repaint = true;
    }
    if (JSON.stringify(old.me) !== JSON.stringify(next.me)) paintAccount();
    if (JSON.stringify([old.images,old.flow]) !== JSON.stringify([next.images,next.flow]) || policyChanged) syncImageAvailability();
    if (JSON.stringify([old.credits,old.pricing]) !== JSON.stringify([next.credits,next.pricing])) updateComposerControls();
    if (page === 'settings' && settingsTab === 'models' && !modelPolicyBusy && policyChanged) repaint = true;
    if (repaint) { renderPage(false); return; }
    const jobContent = jobs => jobs.map(({eta,timing,...job}) => job);
    const jobsChanged = JSON.stringify(jobContent(old.jobs)) !== JSON.stringify(jobContent(next.jobs));
    const assetsChanged =
      JSON.stringify(old.assets) !== JSON.stringify(next.assets);
    const favoritesChanged = JSON.stringify(old.favorites) !== JSON.stringify(next.favorites);
    if (favoritesChanged) paintFavorites();
    if ((jobsChanged || assetsChanged || favoritesChanged) && detailId === null && !imageId) {
      const container = document.querySelector(
        page === "home" ? "#recent-grid" : "#library-grid",
      );
      if (container && !container.querySelector("video:not([muted])")) {
        container.innerHTML =
          page === "home"
            ? assetCards(next.jobs.slice(0, 8), false)
            : libraryTab !== "images"
              ? assetCards(libraryJobs())
              : imageCards();
        bindAssetPreviews(container);
        paintSelection();
      }
    }
    if (detailId !== null) {
      const previous = old.jobs.find((x) => x.id === detailId),
        updated = next.jobs.find((x) => x.id === detailId);
      if (previous?.status !== updated?.status) renderPage(false);
      else if (updated && !updated.result) {
        const message = document.querySelector(".result-pending p");
        if (message)
          message.textContent = timingLabel(updated) || updated.note;
      }
    }
    if (!modal.open && !menuKind) {
      if (page === 'queue' && jobsChanged) renderPage(false);
      if (page === 'settings') {
        const settingsData = value => ({
          gpu:value.nodes, team:value.users, invites:[value.invite_codes,value.workspaces],
          storage:[value.used,value.reserved,value.quota,value.disk_free],
          openai:value.images, credits:[value.credits,value.credit_history], creditAdmin:value.credit_accounts,
        })[settingsTab];
        const before=settingsData(old), after=settingsData(next);
        if (before !== undefined && JSON.stringify(before) !== JSON.stringify(after)) renderPage(false);
      }
    }
  } catch (error) {
    if (error.status === 401) {
      if (state || !app.querySelector(".auth")) auth();
    } else if (error.status === 403 && workspaceId) {
      app.replaceChildren(); state = null;
      const spaces = await req('/api/workspaces');
      location.replace('/studio?workspace=' + spaces.workspace_id);
    } else notify(error.message);
  }
}
function sync(force = false) {
  return refresh(force);
}
refresh(true);
setInterval(() => {
  if (state && !document.hidden) refresh();
}, 6000);

function playerMarkup(j) {
  return `<div class="player" data-src="${mediaURL(j.result)}" data-width="${j.width}" data-height="${j.height}">
    <video class="detail-video" playsinline preload="metadata" src="${mediaURL(j.result)}" aria-label="视频">${j.model === "storyboard" && /^[a-f0-9]{32}$/.test(j.actual?.storyboard_export || "") ? `<track kind="captions" label="旁白字幕" srclang="zh" src="/api/storyboard-exports/${j.actual.storyboard_export}/subtitles?format=vtt" default>` : ""}</video>
    <div class="player-controls"><input class="seek-slider" type="range" min="0" max="1" step="0.01" value="0" aria-label="调整视频的播放进度">
      <div class="player-bottom"><button class="player-toggle" aria-label="播放">${ic("play")}</button><span class="player-time">00:00 / 00:00</span><span class="player-fill"></span>
      <div class="volume-control"><button class="player-mute" aria-label="静音">${ic("volume")}</button><input type="range" min="0" max="1" step=".05" value="1" aria-label="视频音量"></div>
      <span class="player-quality">原画</span><button class="player-fullscreen" aria-label="在浏览器中全屏显示">${ic("fullscreen")}</button></div>
    </div></div>`;
}
let playerSizeObserver = null;
function fitPlayer(player) {
  if (!player.isConnected || !player.parentElement) return;
  const stage = player.parentElement.getBoundingClientRect(), video = player.querySelector("video");
  const ratio = (video.videoWidth || Number(player.dataset.width)) / (video.videoHeight || Number(player.dataset.height));
  const limit = parseFloat(getComputedStyle(player).maxHeight);
  const height = Math.min(stage.height, Number.isFinite(limit) ? limit : stage.height);
  const width = Math.min(stage.width, height * ratio);
  player.style.width = width + "px";
  player.style.height = width / ratio + "px";
}
function wirePlayer() {
  playerSizeObserver?.disconnect();
  const player = document.querySelector(".player");
  if (!player) return;
  playerSizeObserver = new ResizeObserver(() => fitPlayer(player));
  playerSizeObserver.observe(player.parentElement);
  fitPlayer(player);
  if (player.dataset.wired) return;
  player.dataset.wired = "1";
  const video = player.querySelector("video"),
    seek = player.querySelector(".seek-slider"),
    toggle = player.querySelector(".player-toggle"),
    time = player.querySelector(".player-time");
  function stamp(value) {
    return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
  }
  function update() {
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    seek.max = duration || 1;
    seek.value = video.currentTime;
    seek.style.setProperty(
      "--progress",
      (duration ? (video.currentTime / duration) * 100 : 0) + "%",
    );
    time.textContent = stamp(video.currentTime) + " / " + stamp(duration);
    toggle.innerHTML = ic(video.paused ? "play" : "pause");
    toggle.setAttribute("aria-label", video.paused ? "播放" : "暂停");
    player.classList.toggle("is-playing", !video.paused);
  }
  const play = () => {
    if (video.paused)
      video.play().catch(() => notify("视频加载中，请稍后播放"));
    else video.pause();
  };
  toggle.onclick = play;
  video.onclick = play;
  video.addEventListener("timeupdate", update);
  video.addEventListener("loadedmetadata", () => { update(); fitPlayer(player); });
  video.addEventListener("play", update);
  video.addEventListener("pause", update);
  seek.oninput = () => {
    video.currentTime = Number(seek.value);
    update();
  };
  const volume = player.querySelector(".volume-control input"),
    mute = player.querySelector(".player-mute");
  function sound() {
    mute.innerHTML = ic(video.muted || video.volume === 0 ? "muted" : "volume");
    mute.setAttribute("aria-label", video.muted ? "取消静音" : "静音");
  }
  mute.onclick = () => {
    video.muted = !video.muted;
    sound();
  };
  volume.oninput = () => {
    video.volume = Number(volume.value);
    video.muted = false;
    sound();
  };
  player.querySelector(".player-fullscreen").onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await player.requestFullscreen();
    } catch {
      notify("请使用浏览器的全屏功能");
    }
  };
  update();
}

function paintThemeChoices() {
  const current = document.documentElement.dataset.theme;
  for (const button of document.querySelectorAll('[data-act="set-theme"]')) {
    const selected = button.dataset.value === current;
    button.setAttribute("aria-checked", String(selected));
    button.classList.toggle("selected", selected);
  }
}
function settingsView() {
  const sections = [
    ["profile", "个人资料", "account"],
    ["general", "常规", "settings"],
    ["credits", "积分", "drive"],
    ["gpu", state.me.role === "admin" ? "GPU 实例" : "GPU 接入", "gpu"],
    ...(state.me.role === "admin"
      ? [
          ["models", "模型管理", "model"],
          ["prices", "生成定价", "sliders"],
          ["creditAdmin", "积分管理", "drive"],
          ["openai", "OpenAI", "picture"],
          ["chatService", "对话服务", "chat"],
          ["workspaces", "团队空间", "library"],
          ["team", "成员管理", "team"],
          ["invites", "邀请码", "link"],
          ["storage", "存储空间", "drive"],
        ]
      : []),
  ];
  let content;
  if (settingsTab === "profile") content = profileView();
  else if (settingsTab === "credits") content = creditsView();
  else if (settingsTab === "prices" && state.me.role === "admin") content = pricesView();
  else if (settingsTab === "creditAdmin" && state.me.role === "admin") content = creditAdminView();
  else if (settingsTab === "invites" && state.me.role === "admin") content = inviteCodesView();
  else if (settingsTab === "gpu") content = gpuView();
  else if (settingsTab === "models" && state.me.role === "admin") content = modelSettingsView();
  else if (settingsTab === "chatService" && state.me.role === "admin") content = chatSettingsView();
  else if (settingsTab === "openai" && state.me.role === "admin") content = openAISettingsView();
  else if (settingsTab === "workspaces" && state.me.role === "admin") content = workspacesView();
  else if (settingsTab === "team" && state.me.role === "admin")
    content = teamView();
  else if (settingsTab === "storage" && state.me.role === "admin") {
    const used = (state.used / state.quota) * 100;
    content = `<div class="settings-section"><h2>存储空间</h2><div class="storage-total"><strong>${gb(state.used)} GB</strong><span> / ${state.quota / 1e9} GB</span></div><div class="storage-track" role="progressbar" aria-label="已用空间" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${used.toFixed(2)}"><span style="width:${used}%"></span></div><dl class="settings-facts"><dt>素材与成片</dt><dd>${gb(state.used)} GB</dd><dt>任务预留</dt><dd>${gb(state.reserved)} GB</dd><dt>可用空间</dt><dd>${gb(Math.max(0, state.quota - state.used - state.reserved))} GB</dd>${state.me.role === "admin" ? `<dt>服务器可用磁盘</dt><dd>${gb(state.disk_free)} GB</dd>` : ""}</dl><button class="quiet-button" data-nav="library">管理资产</button></div>`;
  } else {
    const dark = document.documentElement.dataset.theme === "dark";
    content = `<div class="settings-section"><h2>常规</h2><div class="setting-row"><div class="setting-label">外观</div><div class="theme-choices" role="radiogroup" aria-label="外观"><button role="radio" aria-checked="${!dark}" data-act="set-theme" data-value="light" class="${!dark ? "selected" : ""}">${ic("sun")}浅色</button><button role="radio" aria-checked="${dark}" data-act="set-theme" data-value="dark" class="${dark ? "selected" : ""}">${ic("moon")}深色</button></div></div></div>`;
  }
  return `<div class="settings-page"><header class="settings-title"><h1>设置</h1></header><div class="settings-layout"><nav class="settings-navigation" aria-label="设置分类">${sections.map(([key, text, icon]) => `<button data-act="settings-tab" data-value="${key}" class="${settingsTab === key ? "active" : ""}" aria-current="${settingsTab === key ? "page" : "false"}">${ic(icon)}${text}</button>`).join("")}</nav><div class="settings-content">${content}</div></div></div>`;
}
window.addEventListener("storage", () => paintThemeChoices());

function displayName(user) {
  return user.nickname || user.name;
}
function avatarImage(user, current = false) {
  return `<img class="user-avatar" src="${esc(user.avatar_url || "/avatars/alpine.svg")}" alt="" ${current ? 'data-current-avatar=""' : ""}>`;
}
function paintAccount() {
  for (const el of document.querySelectorAll("[data-current-avatar]"))
    el.src = state.me.avatar_url;
  for (const el of document.querySelectorAll("[data-current-name]"))
    el.textContent = displayName(state.me);
  const account = document.querySelector(".side .account");
  if (account) account.title = displayName(state.me);
}
function profileView() {
  if (profileDraft === null) profileDraft = displayName(state.me);
  return `<div class="settings-section profile-section"><h2>个人资料</h2>
    <div class="profile-field-row"><span class="profile-field-label">头像</span><div class="profile-avatar-control">${avatarImage(state.me, true)}<button class="profile-secondary" data-act="avatar-picker">更改头像</button></div></div>
    <form id="profile-form">
      <div class="profile-field-row profile-name-row"><label for="nickname" class="profile-field-label">昵称</label><div class="profile-input-action"><input id="nickname" name="nickname" value="${esc(profileDraft)}" maxlength="40" required autocomplete="nickname"><button class="profile-save" type="submit">保存</button></div></div>
      <div class="profile-save-status"><span class="form-message" role="status"></span></div>
    </form>
    <div class="profile-field-row"><span class="profile-field-label">用户名</span><span class="profile-readonly">${esc(state.me.name)}</span></div>
    <div class="profile-field-row profile-password-row"><span class="profile-field-label">密码</span><div><button class="profile-secondary" data-act="own-password">更改密码</button></div></div></div>`;
}
function bindProfileForm() {
  const form = document.querySelector("#profile-form");
  if (!form) return;
  const saveButton = form.querySelector('button[type="submit"]');
  const updateSave = () => {
    saveButton.disabled =
      !form.nickname.value.trim() ||
      form.nickname.value.trim() === displayName(state.me);
  };
  updateSave();
  form.nickname.oninput = () => {
    profileDraft = form.nickname.value;
    form.querySelector(".form-message").textContent = "";
    updateSave();
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const result = await req(
        "/api/me",
        { nickname: form.nickname.value.trim() },
        "PATCH",
      );
      state.me = result;
      profileDraft = result.nickname;
      paintAccount();
      form.querySelector(".form-message").textContent = "已保存";
      await refresh();
    } catch (error) {
      notify(error.message);
    } finally {
      updateSave();
    }
  };
}
function avatarPicker() {
  showModal(
    `<h2>更改头像</h2><div class="avatar-library" role="group" aria-label="头像库">${state.avatars.map((a) => `<button type="button" data-act="choose-avatar" data-key="${a.id}" aria-label="${a.label}" aria-pressed="${state.me.avatar === a.id}"><img src="${a.url}" alt=""></button>`).join("")}</div><div class="avatar-upload-row"><button class="quiet-button" id="avatar-upload">${ic("picture")}上传头像</button><span class="muted">支持 HEIC 等常见图片，最大 5 MB</span><input class="hide" id="avatar-file" type="file" accept="${IMAGE_ACCEPT}"></div>`,
  );
  const file = dialogBody.querySelector("#avatar-file");
  dialogBody.querySelector("#avatar-upload").onclick = () => file.click();
  file.onchange = async () => {
    if (!file.files[0]) return;
    const button = dialogBody.querySelector("#avatar-upload");
    button.disabled = true;
    button.textContent = "上传中";
    try {
      const result = await req("/api/me/avatar", file.files[0], "PUT", true);
      state.me = result;
      paintAccount();
      closeModal();
      notify("头像已更新");
      await refresh();
    } catch (error) {
      notify(error.message);
      button.disabled = false;
      button.innerHTML = ic("picture") + "上传头像";
    }
  };
}
function passwordDialog(user = null) {
  const own = !user;
  showModal(`<h2>${own ? "更改密码" : "修改密码"}</h2>${user ? `<p>${esc(displayName(user))}</p>` : ""}<form id="password-form">${own ? '<label class="formlabel">当前密码<input type="password" name="current" autocomplete="current-password" required maxlength="200"></label>' : ""}
    <label class="formlabel">新密码<input type="password" name="password" minlength="10" maxlength="200" placeholder="至少 10 位" autocomplete="new-password" required></label>
    <label class="formlabel">确认新密码<input type="password" name="confirm" minlength="10" maxlength="200" autocomplete="new-password" required></label>
    <button class="primary" type="submit">保存</button></form>`);
  const form = dialogBody.querySelector("#password-form");
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (form.password.value !== form.confirm.value) {
      notify("两次输入的密码不一致");
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await req(
        own ? "/api/me/password" : `/api/users/${user.id}/password`,
        own
          ? {
              current_password: form.current.value,
              password: form.password.value,
            }
          : { password: form.password.value },
      );
      closeModal();
      notify(own ? "密码已更新" : "密码已修改，原登录会话已退出");
    } catch (error) {
      notify(error.message);
      button.disabled = false;
    }
  };
}
function addMemberDialog() {
  showModal(
    `<h2>添加成员</h2><form id="add-member-form"><label class="formlabel">用户名<input name="username" minlength="2" maxlength="32" autocomplete="off" required></label><label class="formlabel">昵称 <small>选填</small><input name="nickname" maxlength="40" autocomplete="off"></label><label class="formlabel">初始密码<input type="password" name="password" minlength="10" maxlength="200" placeholder="至少 10 位" autocomplete="new-password" required></label><button class="primary" type="submit">添加</button></form>`,
  );
  const form = dialogBody.querySelector("#add-member-form");
  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await req("/api/users", {
        name: form.username.value.trim(),
        nickname: form.nickname.value.trim(),
        password: form.password.value,
      });
      closeModal();
      await refresh(true);
      notify("成员已添加");
    } catch (error) {
      notify(error.message);
      button.disabled = false;
    }
  };
}

let modelPolicyBusy=false, modelPolicyScope="global", modelPolicySearch="";
function displayedModelPolicy() {
  return modelPolicyScope === "global" ? state.model_policy : state.team_model_policies[modelPolicyScope];
}
function modelSettingsView() {
  const teams=state.workspaces.filter(w=>w.kind==='team');
  if (modelPolicyScope!=='global' && !teams.some(w=>String(w.id)===modelPolicyScope)) modelPolicyScope='global';
  const policy=displayedModelPolicy();
  const groups=[['视频生成','video'],['图片生成','image'],['语音生成','audio'],['AI 对话','chat']].map(([label,kind])=>[label,Object.entries(state.model_groups || {}).filter(([,m])=>m.kind===kind)]);
  const row=(title,model,group)=>{
    const open=group.models.filter(id=>policy.enabled[id]).length;
    const globalOpen=group.models.filter(id=>state.model_policy.enabled[id]).length;
    const partial=open>0&&open<group.models.length;
    const notes=[partial?'部分开放':'',modelPolicyScope!=='global'?(globalOpen===0?'全站已关闭':globalOpen<group.models.length?'全站部分开放':''):'',model==='gpt-image-2.6-sunburst'&&!state.images.configured?'未配置':''].filter(Boolean);
    return `<div class="setting-row"><div class="model-setting-name"><span>${esc(group.label)}</span>${notes.length?`<small>${notes.join(' · ')}</small>`:''}</div><label class="model-switch"><input type="checkbox" role="switch" data-model="${esc(model)}" aria-label="开放${title}模型 ${esc(group.label)}${partial?'（部分开放）':''}" ${open>0?'checked':''}><span aria-hidden="true"></span></label></div>`;
  };
  return `<section class="settings-section model-settings"><h2>模型管理</h2><input class="model-search" id="model-policy-search" aria-label="搜索模型管理" placeholder="搜索模型" value="${esc(modelPolicySearch)}"><label class="settings-scope">应用范围<select id="model-policy-scope"><option value="global">全站</option>${teams.map(w=>`<option value="${w.id}" ${String(w.id)===modelPolicyScope?'selected':''}>${esc(w.name)}</option>`).join('')}</select></label>${groups.map(([title,models]) => `<section class="model-group"><h3>${title}</h3>${models.map(([model,group])=>row(title,model,group)).join('')}</section>`).join('')}</section>`;
}
function bindModelSettings() {
  const section=document.querySelector('.model-settings');if (!section) return;
  const search=section.querySelector('#model-policy-search');const filter=()=>{modelPolicySearch=search.value;for(const row of section.querySelectorAll('.setting-row'))row.hidden=!row.textContent.toLowerCase().includes(modelPolicySearch.trim().toLowerCase());for(const group of section.querySelectorAll('.model-group'))group.hidden=![...group.querySelectorAll('.setting-row')].some(row=>!row.hidden);};search.oninput=filter;filter();
  section.querySelector('#model-policy-scope').onchange=e=>{modelPolicyScope=e.target.value;renderPage(false)};
  for (const control of section.querySelectorAll('[data-model]')) control.onchange=async()=>{
    const model=control.dataset.model, enabled=control.checked;
    modelPolicyBusy=true;
    for (const input of section.querySelectorAll('input,select')) input.disabled=true;
    try {
      await req('/api/settings/models',{model,enabled,group:true,expected_revision:displayedModelPolicy().revision,
        workspace:modelPolicyScope==='global'?null:Number(modelPolicyScope)},'PATCH');
      await refresh(true); notify(enabled ? '模型已开放' : '模型已关闭');
    } catch(error) { notify(error.message);await refresh(true); }
    finally {
      modelPolicyBusy=false;
      if (page==='settings' && settingsTab==='models') {
        renderPage(false);document.querySelector(`.model-settings [data-model="${model}"]`)?.focus();
      }
    }
  };
}
function openAISettingsView() {
  const config=state.images;
  return `<section class="settings-section openai-settings"><h2>OpenAI</h2><div class="setting-row"><span>连接状态</span><span>${config.configured ? '已配置' : '未配置'}</span></div><div class="setting-row"><span>模型</span><span>gpt-image-2.6</span></div><form id="openai-settings-form"><div class="openai-actions"><button class="profile-secondary" type="button" id="openai-check" ${config.configured ? '' : 'disabled'}>测试连接</button><a class="quiet-button" href="https://platform.openai.com/usage" target="_blank" rel="noopener noreferrer">查看用量 ↗</a></div><p class="form-message" role="status"></p></form></section>`;
}
function bindOpenAISettings() {
  const form = document.querySelector("#openai-settings-form");
  if (!form) return;
  const status = form.querySelector(".form-message");
  form.onsubmit = event => event.preventDefault();
  form.querySelector("#openai-check").onclick = async event => {
    const button = event.currentTarget; button.disabled = true; status.textContent = "正在连接";
    try { await req("/api/settings/openai/check", {}); status.textContent = "连接正常"; }
    catch(error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  };
}

setInterval(paintTiming, 1000);

document.addEventListener("fullscreenchange", () => { const player = document.querySelector(".player"); if (player) fitPlayer(player); });

function creditQuote(j = draft) {
  const model=selectedModel(j), image=isImage(j), current=j===draft;
  const tier=flowSpec(j)?'native':isAudio(j)?'standard':model==='muse-image'?'native':model==='muse-video'?String(j.seconds):image
    ? `${current?j.resolution:(j.quality===2048?'2K':'1K')}|${current?j.imageQuality:j.image_quality}`
    : `${j.quality}|${j.seconds}`;
  const amount=state.pricing?.items.find(p=>p.key===model+'|'+tier)?.amount;
  const available=state.credits?.available || 0;
  return {amount,canSubmit:amount!=null && available>=amount,
    label:amount==null?'未定价':available<amount?`${amount} 积分 · 余额不足`:`${amount} 积分`};
}
function inviteCodesView() {
  const items = state.invite_codes || [];
  return `<section class="management-view invite-management"><div class="page-heading"><h2>邀请码</h2><button class="primary" data-act="invite">${ic('plus')}创建邀请码</button></div>
    <p class="invite-intro">同一个邀请码可供多人注册，初始积分发放至每位新成员的个人空间。</p>
    <div class="invite-code-list">${items.map(i => {
      const expired = i.expires !== null && i.expires <= Date.now()/1000;
      const status = !i.enabled ? '已停用' : expired ? '已过期' : '有效';
      const team = i.team_id ? (state.workspaces.find(w => w.id === i.team_id)?.name || '团队已删除') : '仅个人空间';
      return `<article class="invite-code-row"><div class="invite-code-heading"><strong>${esc(i.name || '邀请码')}</strong><span class="invite-status ${status === '有效' ? '' : 'inactive'}">${status}</span></div>
        <div class="invite-code-value"><code>${esc(i.code)}</code><button class="quiet-button" data-act="copy-invite" data-id="${i.id}" aria-label="复制邀请码 ${esc(i.code)}">${ic('copy')}复制</button></div>
        <dl class="invite-code-facts"><div><dt>有效期</dt><dd>${i.expires === null ? '长期有效' : new Date(i.expires*1000).toLocaleString([], {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</dd></div><div><dt>初始积分</dt><dd>${i.grant_credits ? i.initial_credits.toLocaleString()+' / 人' : '不赠送'}</dd></div><div><dt>加入空间</dt><dd>${esc(team)}</dd></div><div><dt>已注册</dt><dd>${i.uses} 人</dd></div></dl>
        <div class="invite-code-actions"><button class="quiet-button" data-act="edit-invite" data-id="${i.id}">编辑</button><button class="quiet-button ${i.enabled ? 'danger' : ''}" data-act="toggle-invite" data-id="${i.id}">${i.enabled ? '停用' : '启用'}</button></div></article>`;
    }).join('') || '<div class="invite-empty"><h3>还没有邀请码</h3><p>创建后，成员即可从登录页注册。</p></div>'}</div></section>`;
}
function inviteDialog(item = null) {
  const teams = state.workspaces.filter(w => w.kind === 'team');
  const localDate = seconds => { const d = new Date(seconds*1000); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16); };
  const expiry = item ? (item.expires === null ? 'never' : 'custom') : '30';
  showModal(`<form id="invite-form"><h2>${item ? '编辑邀请码' : '创建邀请码'}</h2>
    ${item ? `<div class="invite-edit-code"><code>${esc(item.code)}</code><span>已注册 ${item.uses} 人</span></div>` : ''}
    <label class="formlabel">名称<input name="label" maxlength="40" placeholder="如：创作体验、项目组" value="${esc(item?.name || '')}" required></label>
    <label class="formlabel">有效期<select name="expiry">${[['7','7 天'],['30','30 天'],['custom','指定到期时间'],['never','长期有效']].map(([v,t])=>`<option value="${v}" ${v===expiry?'selected':''}>${t}</option>`).join('')}</select></label>
    <label class="formlabel" id="invite-date" ${expiry==='custom'?'':'hidden'}>到期时间<input name="expires" type="datetime-local" value="${localDate(item?.expires || Date.now()/1000+30*86400)}"></label>
    <div class="invite-grant-row"><span id="invite-grant-label">赠送初始积分</span><label class="model-switch"><input type="checkbox" role="switch" name="grant" aria-labelledby="invite-grant-label" ${item?.grant_credits?'checked':''}><span aria-hidden="true"></span></label></div>
    <label class="formlabel" id="invite-amount" ${item?.grant_credits?'':'hidden'}>每人积分<input name="amount" type="number" min="1" max="1000000000" step="1" value="${item?.initial_credits || 100}"><small>发放至新成员的个人空间</small></label>
    <label class="formlabel">注册后加入<select name="team"><option value="">仅个人空间</option>${teams.map(w=>`<option value="${w.id}" ${item?.team_id===w.id?'selected':''}>${esc(w.name)}</option>`).join('')}</select></label>
    ${item ? '<p class="invite-form-help">修改只影响之后注册的成员。</p>' : ''}
    <p class="form-message" role="alert"></p><div class="invite-form-actions"><button type="button" class="quiet-button" id="cancel-invite">取消</button><button class="primary" type="submit">${item ? '保存' : '创建邀请码'}</button></div></form>`);
  const form = dialogBody.querySelector('form');
  const fields = form.elements;
  const updateFields = () => {
    form.querySelector('#invite-date').hidden = fields.expiry.value !== 'custom';
    fields.expires.required = fields.expiry.value === 'custom';
    fields.expires.disabled = fields.expiry.value !== 'custom';
    form.querySelector('#invite-amount').hidden = !fields.grant.checked;
    fields.amount.disabled = !fields.grant.checked; fields.amount.required = fields.grant.checked;
  };
  fields.expiry.onchange = fields.grant.onchange = updateFields; updateFields();
  form.querySelector('#cancel-invite').onclick = closeModal;
  form.onsubmit = async e => {
    e.preventDefault(); const button = form.querySelector('[type=submit]'); button.disabled = true;
    form.querySelector('.form-message').textContent = '';
    try {
      const expires = fields.expiry.value === 'never' ? null : fields.expiry.value === 'custom' ? Math.floor(new Date(fields.expires.value).getTime()/1000) : Math.floor(Date.now()/1000) + Number(fields.expiry.value)*86400;
      const body = {name: fields.label.value.trim(), expires, grant_credits: fields.grant.checked, initial_credits: fields.grant.checked ? Number(fields.amount.value) : 0, team_id: fields.team.value ? Number(fields.team.value) : null, ...(item ? {expected_revision:item.revision} : {})};
      await req(item ? `/api/invite-codes/${item.id}` : '/api/invite-codes', body, item ? 'PATCH' : 'POST');
      await closeModal(); await refresh(true); notify(item ? '邀请码已保存' : '邀请码已创建');
    } catch (error) { form.querySelector('.form-message').textContent = error.message; button.disabled = false; }
  };
}
function creditRows(rows) {
  const labels={reserve:'冻结',spend:'扣除',refund:'退回',adjust:'调整',recharge:'充值'};
  return rows.map(r=>`<div class="credit-ledger-row"><div><strong>${labels[r.action] || r.action}${r.job?` · #${r.job}`:''}</strong><small>${esc(r.actor_name || '')}${r.note?' · '+esc(r.note):''}</small></div><span class="credit-amount">${['adjust','recharge'].includes(r.action)?(r.amount>0?'+':''):r.action==='spend'?'−':''}${r.amount}</span><time>${new Date(r.created*1000).toLocaleString()}</time></div>`).join('');
}
function creditsView() {
  const c=state.credits, rows=state.credit_history || [];
  return `<section class="settings-section"><div class="recharge-heading"><h2>积分</h2><button class="primary" data-act="recharge">充值</button></div><div class="credit-summary"><div><span>可用积分</span><strong>${c.available.toLocaleString()}</strong></div><div><span>冻结积分</span><strong>${c.reserved.toLocaleString()}</strong></div></div><div class="recharge-info"><span>¥1 = 10 积分</span><button class="quiet-button" data-act="recharge-history">充值记录</button></div><h3 class="credit-heading">积分明细</h3><div class="credit-ledger">${creditRows(rows) || '<p class="empty-note">暂无记录</p>'}</div>${rows.length===50?`<button class="quiet-button" data-act="credit-more" data-before="${rows.at(-1).id}">加载更多</button>`:''}</section>`;
}
function creditAdminView() {
  const accounts=state.credit_accounts || [];
  return `<section class="settings-section credit-admin"><h2>积分管理</h2>${[['team','团队积分'],['personal','个人积分']].map(([kind,label])=>`<h3 class="credit-heading">${label}</h3>${accounts.filter(a=>a.kind===kind).map(a=>`<div class="credit-account-row"><div><strong>${esc(a.name)}</strong>${a.username&&a.username!==a.name?`<small>${esc(a.username)}</small>`:''}</div><span>${a.available.toLocaleString()}<small>可用 · 冻结 ${a.reserved.toLocaleString()}</small></span><button class="quiet-button" data-act="credit-history" data-id="${a.workspace}">明细</button><button class="profile-secondary" data-act="credit-adjust" data-id="${a.workspace}">调整</button></div>`).join('')}`).join('')}</section>`;
}
function pricesView() {
  const groups=[['MiniMax H3','MiniMax H3 · 视频'],['muse-video','Muse · 视频'],['gpt-image-2.6-sunburst','gpt-image-2.6 · 图片'],['muse-image','Muse · 图片'],['breeze-tts-2','Breeze TTS 2 · 语音'],['deepseek-flash','DeepSeek Flash · 对话'],['gpt-4.1','GPT-4.1 · 对话'],['flow:image','Flow · 图片'],['flow:video','Flow · 视频']];
  const rowsFor=model=>state.pricing.items.filter(p=>!state.model_catalog?.[p.model]?.hidden&&(model==='flow:image'||model==='flow:video'?p.model.startsWith('flow:')&&p.kind===model.split(':')[1]:p.model===model));
  return `<section class="settings-section"><h2>生成定价</h2><form id="price-form">${groups.filter(([model])=>rowsFor(model).length).map(([model,label])=>`<h3 class="credit-heading">${label}</h3>${rowsFor(model).map(p=>`<label class="price-row"><span>${p.label}</span><span><input type="number" data-price="${p.key}" value="${p.amount??''}" min="1" max="1000000000" step="1" placeholder="未定价" aria-label="${esc(label+' '+p.label)}"><span>积分</span></span></label>`).join('')}`).join('')}<p class="form-message" role="status"></p><button class="primary" type="submit">保存价格</button></form></section>`;
}
function bindCreditSettings() {
  const form=document.querySelector('#price-form');if (!form) return;
  const revision=state.pricing.revision;
  form.onsubmit=async e=>{
    e.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;
    const values=Object.fromEntries(state.pricing.items.map(p=>[p.key,p.amount]));
    for(const input of form.querySelectorAll('[data-price]'))values[input.dataset.price]=input.value===''?null:Number(input.value);
    try {await req('/api/settings/prices',{values,expected_revision:revision},'PUT');await refresh(true);notify('价格已保存')}
    catch(error){form.querySelector('.form-message').textContent=error.message;button.disabled=false}
  };
}
function creditAdjustment(wid) {
  const account=state.credit_accounts.find(a=>a.workspace===wid);if (!account)return;
  const uid=crypto.randomUUID();
  showModal(`<form id="credit-adjust-form"><h2>调整积分</h2><p>${esc(account.name)} · 可用 ${account.available} 积分</p><label class="formlabel">操作<select name="direction"><option value="1">发放积分</option><option value="-1">扣减积分</option></select></label><label class="formlabel">积分数量<input name="amount" type="number" min="1" max="1000000000" step="1" required></label><label class="formlabel">原因<input name="note" maxlength="200" required></label><p class="form-message" role="alert"></p><button class="primary" type="submit">确认调整</button></form>`);
  const form=dialogBody.querySelector('form');
  form.onsubmit=async e=>{
    e.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;
    try {await req('/api/admin/credits/adjust',{workspace:wid,amount:Number(form.elements.amount.value)*Number(form.elements.direction.value),note:form.elements.note.value.trim(),uid});await closeModal();await refresh(true);notify('积分已调整')}
    catch(error){form.querySelector('.form-message').textContent=error.message;button.disabled=false}
  };
}
async function creditHistoryDialog(wid) {
  const result=await req('/api/admin/credits?workspace='+wid), account=result.accounts.find(a=>a.workspace===wid);
  showModal(`<h2>${esc(account?.name || '')} · 积分明细</h2><div class="credit-ledger">${creditRows(result.history) || '<p class="empty-note">暂无记录</p>'}</div>${result.history.length===50?`<button class="quiet-button" data-act="credit-more" data-workspace="${wid}" data-before="${result.history.at(-1).id}">加载更多</button>`:''}`);
}
async function showMoreCredits(button) {
  button.disabled=true;
  try {
    const result=await req(button.dataset.workspace?`/api/admin/credits?workspace=${button.dataset.workspace}&before=${button.dataset.before}`:`/api/credits?before=${button.dataset.before}`);
    button.previousElementSibling.insertAdjacentHTML('beforeend',creditRows(result.history));
    if (result.history.length<50)button.remove();else button.dataset.before=result.history.at(-1).id;
  } finally {button.disabled=false}
}

function audioDetailView(j) {
  const own=state.me.role==='admin' || j.owner===state.me.id;
  return `<div class="detail-view audio-detail ${detailEditing ? "editing" : ""}"><div class="detail-stage"><button class="detail-back icon-button" data-act="close-detail" aria-label="返回">${ic('back')}</button><div class="audio-stage">${ic('voice')}${j.result?`<audio class="detail-audio" controls preload="metadata" src="${mediaURL(j.result)}" aria-label="生成语音"></audio>`:`<div class="result-pending"><h2>${jobStatusLabel(j)}</h2><p data-time-job="${j.id}">${esc(timingLabel(j) || j.note)}</p>${j.status==='queued' && own?`<button class="quiet-button" data-act="cancel" data-id="${j.id}">取消生成</button>`:''}</div>`}</div><div id="detail-composer" class="detail-composer"></div></div><aside class="detail-info"><div class="detail-actions">${j.result?`${favoriteButton('job:'+j.id,true)}<a class="download-action" href="/media/${j.result}?download=true" download>${ic('download')}下载</a>`:`<span class="muted">#${j.id}</span>`}<button class="icon-button" data-menu="detail-more" aria-label="更多">${ic('more')}</button></div><div class="detail-copy"><div class="subheading">朗读文字</div><p class="prompt-text">${esc(j.prompt)}</p><div class="subheading">音色描述</div><p>${esc(j.audio_settings?.instruction || '')}</p><div class="metadata detail-params">${esc(jobParameters(j))}</div><details><summary>详细信息</summary><dl><dt>创作者</dt><dd>${esc(j.author)}</dd><dt>时间</dt><dd>${new Date(j.created*1000).toLocaleString()}</dd><div data-time-details="${j.id}">${timingDetails(j)}</div></dl></details></div><div class="detail-footer"><div class="edit-actions"><button data-act="edit" data-id="${j.id}" ${!canEditJob(j)?'disabled':''}>${ic('edit')}重新编辑</button><button data-act="again" data-id="${j.id}" ${generationDisabled(j)?'disabled':''}>${ic('repeat')}再次生成</button></div></div></aside></div>`;
}

function chatSettingsView(){return `<section class="settings-section fm-chat-service"><h2>对话服务</h2>${[['deepseek','DeepSeek'],['openai','OpenAI']].map(([id,label])=>`<form data-chat-provider="${id}"><header><h3>${label}</h3><span class="muted" data-chat-status>载入中…</span></header><div class="service-secret"><input type="password" name="secret" autocomplete="new-password" placeholder="输入新密钥以替换" aria-label="${label} API 密钥"><button type="submit" class="profile-secondary">保存</button><button type="button" class="quiet-button" data-chat-test>测试连接</button></div><p class="form-message" role="status"></p></form>`).join('')}</section>`}
function bindChatSettings(){
 const forms=[...document.querySelectorAll('[data-chat-provider]')];if(!forms.length)return;
 req('/api/admin/chat').then(data=>forms.forEach(form=>{if(form.isConnected)form.querySelector('[data-chat-status]').textContent=data.providers[form.dataset.chatProvider].configured?'已配置':'未配置';})).catch(e=>notify(e.message));
 forms.forEach(form=>{
  const perform=async(test)=>{const message=form.querySelector('.form-message');const buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);message.textContent='';try{const provider=form.dataset.chatProvider;const key=form.elements.secret.value.trim();if(!test&&!key)throw new Error('请输入密钥');await req('/api/admin/chat/'+provider+(test?'/test':''),test?{}:{key},test?'POST':'PUT');if(!test){form.elements.secret.value='';form.querySelector('[data-chat-status]').textContent='已配置';}message.textContent=test?'连接正常':'已保存';}catch(e){message.textContent=e.message}finally{buttons.forEach(b=>b.disabled=false)}};
  form.addEventListener('submit',e=>{e.preventDefault();void perform(false)});form.querySelector('[data-chat-test]').addEventListener('click',()=>void perform(true));
 });
}


// Recharge uses the captured workspace and an idempotency key for each form.
let rechargePoll = null;
modal.addEventListener('close', () => clearInterval(rechargePoll));
async function rechargeDialog() {
  const wid = state.workspace_id;
  const workspace = state.workspaces.find(w => w.id === wid);
  const config = await req('/api/recharge');
  if (state.workspace_id !== wid) return;
  clearInterval(rechargePoll);
  showModal(`<form id="recharge-form" class="recharge-form"><h2>充值积分</h2>
    <p class="recharge-destination">充值到 <strong>${esc(workspace?.name || '当前空间')}</strong>${workspace?.kind === 'team' ? ' · 团队共用' : ''}</p>
    <label class="formlabel">充值金额（元）<input name="yuan" type="number" min="${config.min_yuan}" max="${config.max_yuan}" step="1" value="10" inputmode="numeric" required></label>
    <div class="recharge-presets">${[1,10,50,100].map(n => `<button type="button" class="profile-secondary" data-yuan="${n}">¥${n}</button>`).join('')}</div>
    <div class="recharge-total"><span>到账积分</span><strong id="recharge-total">100</strong></div>
    <p class="recharge-rate">¥1 = 10 积分</p>
    <fieldset class="recharge-methods"><legend>付款方式</legend>${config.methods.map((m,i) => `<label><input type="radio" name="method" value="${esc(m.id)}" ${i===0?'checked':''}><span>${esc(m.label)}</span></label>`).join('') || '<p>充值暂不可用，请稍后再试</p>'}</fieldset>
    <p class="recharge-network" hidden>使用 Plasma 网络转账，应付 USDT 数量以收银台为准。</p>
    <p class="form-message" role="alert"></p><button class="primary" type="submit" ${config.methods.length?'':'disabled'}>创建充值订单</button></form>`);
  const form = document.querySelector('#recharge-form');
  let uid = crypto.randomUUID(), lastBody = '', busy = false;
  const update = () => {
    const value = Number(form.elements.yuan.value), valid = Number.isInteger(value) && value >= config.min_yuan && value <= config.max_yuan;
    form.querySelector('#recharge-total').textContent = valid ? (value*10).toLocaleString() : '—';
    form.querySelector('.recharge-network').hidden = form.elements.method?.value !== 'usdt_plasma';
    form.querySelectorAll('[data-yuan]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.yuan) === value)));
  };
  form.oninput = update;
  form.querySelectorAll('[data-yuan]').forEach(b => b.onclick = () => {if (!busy) {form.elements.yuan.value = b.dataset.yuan; update();}});
  update();
  form.onsubmit = async e => {
    e.preventDefault(); if (busy || !form.reportValidity()) return;
    const payload = {workspace:wid, yuan:Number(form.elements.yuan.value), method:form.elements.method.value};
    const fingerprint = JSON.stringify(payload); if (lastBody && fingerprint !== lastBody) uid = crypto.randomUUID(); lastBody = fingerprint;
    busy = true; form.querySelectorAll('input,button').forEach(b => b.disabled = true);
    const message = form.querySelector('.form-message'); message.textContent = '正在创建订单…';
    try {
      const order = await req('/api/recharge/orders', {...payload,uid});
      if (form.isConnected && modal.open) await rechargeOrderDialog(order.id, order);
    } catch (error) {message.textContent = error.message;}
    finally {busy = false; form.querySelectorAll('input,button').forEach(b => b.disabled = false);}
  };
}
const rechargeStateLabel = {pending:'待支付',paid:'已到账',expired:'已过期',unconfirmed:'待核对'};
async function rechargeHistory() {
  const wid = state.workspace_id, config = await req('/api/recharge');
  if (state.workspace_id !== wid) return;
  clearInterval(rechargePoll);
  showModal(`<h2>充值记录</h2><div class="recharge-orders">${rechargeOrderRows(config.orders) || '<p class="empty-note">暂无充值记录</p>'}</div>${config.orders.length === 30 ? '<button class="quiet-button" id="recharge-more">加载更多</button>' : ''}`);
  let before = config.orders.at(-1)?.id;
  const more = document.querySelector('#recharge-more');
  if (more) more.onclick = async () => {
    more.disabled = true;
    try {const result = await req('/api/recharge?before='+encodeURIComponent(before));
      if (wid !== state.workspace_id || !more.isConnected) return;
      document.querySelector('.recharge-orders').insertAdjacentHTML('beforeend',rechargeOrderRows(result.orders));
      before = result.orders.at(-1)?.id; if (result.orders.length < 30) more.remove();
    } catch (e) {notify(e.message);} finally {more.disabled = false;}
  };
}
function rechargeOrderRows(orders) {
  return orders.map(o => `<button class="recharge-order-row" data-act="recharge-order" data-order="${esc(o.id)}"><span><strong>¥${(o.amount/100).toFixed(2)} · ${o.credits.toLocaleString()} 积分</strong><small>${new Date(o.created*1000).toLocaleString()} · ${o.method==='alipay'?'支付宝':'USDT-Plasma'}</small></span><span>${rechargeStateLabel[o.state] || '待核对'} ${ic('chevron')}</span></button>`).join('');
}
async function rechargeOrderDialog(oid, initial) {
  clearInterval(rechargePoll);
  let order = initial || await req('/api/recharge/orders/'+encodeURIComponent(oid));
  const workspace = state.workspaces.find(w => w.id === order.workspace);
  showModal(`<section class="recharge-detail" data-order="${esc(oid)}"><h2>充值订单</h2><div class="recharge-order-total"><strong>${order.credits.toLocaleString()} 积分</strong><span>¥${(order.amount/100).toFixed(2)}</span></div>
    <dl class="settings-facts"><dt>充值空间</dt><dd>${esc(workspace?.name || '原充值空间')}</dd><dt>付款方式</dt><dd>${order.method==='alipay'?'支付宝':'USDT-Plasma'}</dd><dt>订单号</dt><dd class="recharge-order-id">${esc(order.id)}</dd></dl>
    <p class="recharge-status" role="status"></p><div class="recharge-actions"><a class="primary" id="recharge-pay" href="${esc(order.payment_url)}" target="_blank" rel="noopener">前往支付 ↗</a><button class="profile-secondary" id="recharge-check">刷新支付结果</button></div>
    <p class="recharge-hint"></p><p class="form-message" role="alert"></p></section>`);
  const section = document.querySelector('.recharge-detail'), check = section.querySelector('#recharge-check');
  const paint = () => {
    section.querySelector('.recharge-status').textContent = rechargeStateLabel[order.state] || '待核对';
    section.querySelector('#recharge-pay').hidden = !order.can_pay;
    section.querySelector('.recharge-hint').textContent = order.state==='paid' ? '积分已加入原充值空间。' : order.state==='unconfirmed' ? '支付通道尚未确认订单，请稍后刷新或联系管理员核对。' : order.state==='expired' ? '订单已过期，请新建充值订单。已付款的订单确认后仍会到账。' : '付款后自动更新到账状态，关闭页面也不影响到账。';
    section.querySelector('.form-message').textContent = order.warning || '';
  };
  let checking = false;
  const poll = async () => {
    if (checking || !section.isConnected || !modal.open || document.hidden) return;
    checking = true; check.disabled = true;
    try {
      const next = await req('/api/recharge/orders/'+encodeURIComponent(oid));
      if (!section.isConnected || !modal.open) return;
      const justPaid = order.state !== 'paid' && next.state === 'paid'; order = next; paint();
      if (order.state === 'paid') {clearInterval(rechargePoll); await refresh(true); if (justPaid) notify('充值成功，积分已到账');}
    } catch (e) {section.querySelector('.form-message').textContent = e.message;}
    finally {checking = false; check.disabled = false;}
  };
  check.onclick = poll; paint();
  if (order.state !== 'paid') rechargePoll = setInterval(poll, 5000);
}
