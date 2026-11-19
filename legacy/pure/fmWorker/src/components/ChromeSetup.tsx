import {useState} from 'react';
import {Puzzle, FolderOpen, ExternalLink, Check, Copy} from 'lucide-react';
import type {Method, Snapshot} from '../api';
import {Button, Card, StatusPill} from './ui';

export function ChromeSetup({snap,pending,act}:{snap:Snapshot;pending:string|null;act:(m:Method,p?:Record<string,unknown>)=>Promise<unknown>}){
  const [help,setHelp]=useState(false);
  const [copyState,setCopyState]=useState('');
  const c=snap.chrome;
  if(!c)return null;
  const busy=!!pending;
  const copy=async()=>{
    try{await navigator.clipboard.writeText(c.folder||'');setCopyState('已复制')}
    catch{setCopyState('请选中路径手动复制')}
  };
  return <Card className="chrome-setup" title="连接当前 Chrome 用户" icon={<Puzzle size={15}/>} actions={
    <><StatusPill tone={c.connected?'ok':'paused'}>{c.connected?'扩展已连接':c.stage==='update_required'?'扩展需要更新':c.prepared?'等待安装或连接':'尚未安装扩展'}</StatusPill>
      {c.connected&&<Button variant="ghost" size="sm" onClick={()=>setHelp(!help)}>{help?'收起':'安装帮助'}</Button>}</>}>
    {c.connected&&!help?<p className="hint"><Check size={13} aria-hidden="true"/>沿用安装此扩展的 Chrome 用户和 Flow 登录状态。</p>:<>
      <p className="hint">安装一次后，保持 Chrome 和 fmWorker 打开即可。当前版本从本机安装。</p>
      <ol className="chrome-steps">
        <li><div><strong>准备连接助手</strong><p className="hint">读取 Flow 与 Google 账号的登录状态，并与本机 fmWorker 通信。</p></div>
          <Button size="sm" variant={c.prepared?'secondary':'primary'} busy={pending==='chrome.prepare'} disabled={busy} onClick={()=>act('chrome.prepare')}>{c.prepared?'重新准备扩展':'准备扩展'}</Button></li>
        <li><div><strong>在当前 Chrome 用户中安装</strong><p className="hint">打开扩展管理，开启“开发者模式”，点击“加载已解压的扩展程序”，选择 fmWorker 扩展文件夹。</p></div>
          <div className="actions"><Button size="sm" icon={<ExternalLink size={13}/>} disabled={!c.prepared||busy} onClick={()=>act('chrome.open_extensions')}>打开扩展管理</Button>
            <Button size="sm" icon={<FolderOpen size={13}/>} disabled={!c.prepared||busy} onClick={()=>act('chrome.reveal')}>显示扩展文件夹</Button>
            {c.folder&&<Button size="sm" icon={<Copy size={13}/>} onClick={copy}>复制扩展路径</Button>}</div>
          {c.folder&&<><label className="extension-path">扩展文件夹路径<input readOnly value={c.folder} onFocus={e=>e.currentTarget.select()}/></label>
            <p className="hint" role="status">{copyState?copyState+' · ':''}{snap.os==='Darwin'?'在文件选择窗口按 ⌘⇧G，粘贴路径后选择“打开”。':'在文件选择窗口粘贴路径，选择该文件夹。'}</p></>}</li>
        <li><div><strong>等待连接检测</strong><p className="hint">检测自动更新。若未连接，点击 Chrome 工具栏中的“fmWorker 连接助手”，确认它已启用。</p></div>
          <StatusPill tone={c.connected?'ok':'off'}>{c.connected?'已连接':'等待扩展'}</StatusPill></li>
      </ol>
      {c.stage==='update_required'&&<p role="status" className="hint">点击“重新准备扩展”，再在 Chrome 扩展管理中点击连接助手的“重新加载（Reload）”。</p>}
    </>}
  </Card>;
}
