import {useState} from 'react';
import {FlaskConical, ChevronDown} from 'lucide-react';
import {DemoClient, scenarios, type ScenarioId} from './demoClient';

/** 演示控制面板：仅演示构建渲染。用于切换关键状态供核对。 */
export function DemoPanel({client}:{client:DemoClient}){
  const [open,setOpen]=useState(true);
  const [scenario,setScenario]=useState<ScenarioId>(client.scenario);
  const [os,setOs]=useState(client.os);
  const pick=(id:ScenarioId,nextOs=os)=>{setScenario(id);setOs(nextOs);client.load(id,nextOs)};
  return <div className={'demo-panel'+(open?' open':'')} aria-label="演示控制">
    <button className="demo-toggle" onClick={()=>setOpen(!open)} aria-expanded={open}><FlaskConical size={13}/>演示状态<ChevronDown size={13} className="chev"/></button>
    {open&&<div className="demo-body">
      <label>场景<select value={scenario} onChange={e=>pick(e.target.value as ScenarioId)}>{scenarios.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
      <label>系统<select value={os} onChange={e=>pick(scenario,e.target.value)}><option value="Darwin">Mac</option><option value="Windows">Windows</option></select></label>
    </div>}
  </div>;
}
