'use strict';
let enabled = true;
async function refresh() {
  const state = await chrome.runtime.sendMessage({type: 'status'});
  enabled = state.enabled;
  document.getElementById('status').textContent = !enabled ? '已断开' : state.connected ? '已连接本机 fmWorker' :
    state.reason === 'another_profile' ? '另一个 Chrome 用户已连接，请先从那里断开' :
    state.reason === 'update_required' ? '请在 Chrome 扩展管理中重新加载连接助手' :
    state.reason === 'host_missing' ? '请回到 fmWorker，点击“准备扩展”完成安装' : '等待 fmWorker 打开';
  document.getElementById('toggle').textContent = enabled ? '断开连接' : '连接 fmWorker';
}
document.getElementById('toggle').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({type: 'toggle', enabled: !enabled}); await refresh();
});
void refresh(); setInterval(refresh, 2000);
