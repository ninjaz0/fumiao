import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../resources/chrome-extension/background.js',import.meta.url),'utf8');
function environment({tabs=[{id:7,active:true}],email='user@example.com',cookies=[],accountCookies=[],denyAccount=false,projectTabs=[]}={}){
  const calls={created:0,updated:0,cookies:0,actions:[]};
  const event={addListener(){},removeListener(){}};
  const chrome={
    tabs:{query:async({url})=>typeof url==='string'?projectTabs:tabs,create:async options=>{calls.created++;calls.createdOptions=options;return{id:8}},update:async()=>{calls.updated++},get:async()=>({status:'complete'}),onUpdated:event},
    cookies:{
      getAll:async()=>{calls.cookies++;return cookies},
      get:async({url,name})=>{calls.cookies++;assert.equal(url,'https://flow.google.com/projects');if(denyAccount)throw new Error('Missing cookie permission');return [...cookies,...accountCookies].find(c=>c.name===name)||null}
    },
    scripting:{executeScript:async options=>{if(options.args)calls.actions.push(options.args[0]);return[{result:options.args?{token:'synthetic-verification',user_agent:'Test Chrome',accept_language:'en-GB'}:{email,host:'flow.google.com',ready:'complete'}}]}},
    runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,getManifest:()=>({version:'0.3.0'}),onMessage:event,
      connectNative:()=>({onMessage:event,onDisconnect:event,postMessage(){}})},
    storage:{local:{get:async()=>({enabled:false}),set:async()=>{}}},
    alarms:{create(){},onAlarm:event}
  };
  const context=vm.createContext({chrome,setTimeout,clearTimeout,console});
  vm.runInContext(source,context);
  return {calls,run:command=>context.runCommand(command)};
}

test('reuse existing Flow tab in current user; do not create a window or profile',async()=>{
  const e=environment();
  assert.equal((await e.run({kind:'open_flow',payload:{expected_email:'user@example.com'}})).ok,true);
  assert.equal(e.calls.updated,1);assert.equal(e.calls.created,0);
  assert.ok(!source.includes('chrome.windows.create'));
});
test('only create a normal tab when this Chrome user has no Flow tab',async()=>{
  const e=environment({tabs:[]});
  await e.run({kind:'open_flow',payload:{expected_email:'user@example.com'}});
  assert.equal(e.calls.created,1);
});
test('wrong Google account cannot export cookies',async()=>{
  const e=environment({email:'other@example.com'});
  assert.equal((await e.run({kind:'session',payload:{expected_email:'user@example.com'}})).error,'wrong_account');
  assert.equal(e.calls.cookies,0);
});
test('session export excludes unrelated domains and browser metadata',async()=>{
  const e=environment({cookies:[
    {name:'OSID',value:'synthetic-flow',domain:'flow.google.com',path:'/',secure:true,httpOnly:true,hostOnly:true,storeId:'private-metadata',sameSite:'lax'},
    {name:'other',value:'excluded',domain:'.example.com',path:'/'}],accountCookies:[
    {name:'SID',value:'synthetic-account',domain:'.google.com',path:'/',secure:true,httpOnly:true}]});
  const result=await e.run({kind:'session',payload:{expected_email:'user@example.com'}});
  assert.equal(result.cookies.length,2);assert.equal(result.cookies[0].sameSite,'Lax');
  assert.ok(!JSON.stringify(result).includes('private-metadata'));
  assert.ok(!JSON.stringify(result).includes('excluded'));
});
test('cookie read failure is reported without asking for a fresh login',async()=>{
  const e=environment({denyAccount:true});
  assert.equal((await e.run({kind:'session',payload:{expected_email:'user@example.com'}})).error,'cookie_read_failed');
});
test('incomplete cookies never become a connected session',async()=>{
  const e=environment({cookies:[{name:'OSID',domain:'flow.google.com',path:'/',value:'synthetic'}]});
  assert.equal((await e.run({kind:'session',payload:{expected_email:'user@example.com'}})).error,'account_cookies_missing');
});
test('arbitrary commands and captcha actions are rejected',async()=>{
  const e=environment();
  for(const command of [{kind:'eval',payload:{}},{kind:'captcha',payload:{action:'eval'}}]){
    command.payload.expected_email='user@example.com';
    assert.equal((await e.run(command)).error,'unsupported');
  }
});
test('video verification opens the matching project in the same Chrome user',async()=>{
  const e=environment();const project='3cd40566-37e3-4b2e-9865-f9f4b5304ca4';
  const result=await e.run({kind:'captcha',payload:{expected_email:'user@example.com',action:'VIDEO_GENERATION',project_id:project}});
  assert.equal(result.token,'synthetic-verification');
  assert.equal(e.calls.createdOptions.url,'https://flow.google.com/project/'+project);
  assert.equal(e.calls.createdOptions.active,false);
  assert.equal(result.user_agent,'Test Chrome');
});
test('verification reuses an existing matching project and rejects foreign URLs',async()=>{
  const e=environment({projectTabs:[{id:10}]});
  const result=await e.run({kind:'captcha',payload:{expected_email:'user@example.com',action:'VIDEO_GENERATION',project_id:'3cd40566-37e3-4b2e-9865-f9f4b5304ca4'}});
  assert.equal(result.ok,true);assert.equal(e.calls.created,0);
  const bad=await e.run({kind:'captcha',payload:{expected_email:'user@example.com',action:'VIDEO_GENERATION',project_id:'https://other.example/'}});
  assert.equal(bad.ok,false);assert.equal(e.calls.created,0);
});

test('reference upload preserves its distinct verification action before video generation',async()=>{
  const e=environment({projectTabs:[{id:10}]});
  for(const action of ['UPLOAD_IMAGE','VIDEO_GENERATION']){
    const result=await e.run({kind:'captcha',payload:{expected_email:'user@example.com',action,project_id:'3cd40566-37e3-4b2e-9865-f9f4b5304ca4'}});
    assert.equal(result.ok,true);
  }
  assert.deepEqual(e.calls.actions,['UPLOAD_IMAGE','VIDEO_GENERATION']);
  assert.equal(e.calls.created,0);
});
