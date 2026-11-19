import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import {realClient} from './api';
import './styles/app.css';

const root = createRoot(document.getElementById('root')!);

if(__FM_DEMO__){
  // 演示构建：动态加载内存模拟后台。生产构建中此分支被常量折叠并移除。
  void Promise.all([import('./demo/demoClient'),import('./demo/DemoPanel')]).then(([{DemoClient,scenarios},{DemoPanel}])=>{
    const q = new URLSearchParams(location.search);
    const id = scenarios.find(s=>s.id===q.get('scenario'))?.id ?? 'connected';
    const client = new DemoClient(id, q.get('os')==='Windows'?'Windows':'Darwin');
    if(q.get('theme')==='dark') void client.call('settings',{theme:'dark'});
    const subscribe = (fn:()=>void)=>client.subscribe(fn);
    root.render(<React.StrictMode><App client={client} subscribe={subscribe} demoSlot={q.has('clean')?null:<DemoPanel client={client}/>}/></React.StrictMode>);
  });
}else{
  root.render(<React.StrictMode><App client={realClient}/></React.StrictMode>);
}
