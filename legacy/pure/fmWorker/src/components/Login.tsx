import {useState, type FormEvent} from 'react';
import {ArrowUpRight, LoaderCircle} from 'lucide-react';
import type {Method} from '../api';
import {Button, Mark} from './ui';

export function Login({online,pending,act}:{online:boolean;pending:string|null;act:(m:Method,p?:Record<string,unknown>)=>Promise<unknown>}){
  const [name,setName]=useState(''); const [password,setPassword]=useState('');
  async function submit(e:FormEvent){e.preventDefault();await act('login',{name,password});setPassword('')}
  return <main className="login">
    <form className="login-card" onSubmit={submit} aria-labelledby="login-title">
      <Mark size={40}/>
      <h1 id="login-title">登录弗淼</h1>
      <p className="muted">登录后管理这台电脑接入的资源。</p>
      <label>用户名<input autoComplete="username" value={name} onChange={e=>setName(e.target.value)} required maxLength={40} autoFocus/></label>
      <label>密码<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required maxLength={200}/></label>
      <Button type="submit" variant="primary" className="full" busy={pending==='login'} disabled={!!pending||!online}>登录</Button>
      {!online&&<p className="small muted center" role="status"><LoaderCircle size={13} className="spin" aria-hidden="true"/> 正在连接后台…</p>}
      <div className="login-foot"><span className="muted small">没有账号请先在网页注册</span>
        <Button variant="ghost" size="sm" icon={<ArrowUpRight size={14}/>} disabled={!online} onClick={()=>act('open_platform')}>前往弗淼</Button></div>
    </form>
  </main>;
}
