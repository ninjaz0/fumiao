#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{io::{BufRead, BufReader, Write}, process::{Child, ChildStdin, ChildStdout, Command, Stdio}, sync::{Arc, Mutex,atomic::{AtomicBool,Ordering}}, time::Duration};
use serde_json::{json, Value};
use tauri::{Manager, tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState}};
mod chrome_native;

struct Bridge { child: Child, input: ChildStdin, output: BufReader<ChildStdout>, sequence: u64 }
impl Bridge {
    fn start() -> Result<Self,String> {
        let exe = std::env::current_exe().map_err(|e|e.to_string())?;
        let helper = exe.parent().ok_or("应用目录无效")?.join(if cfg!(windows){"fmworker-bridge.exe"}else{"fmworker-bridge"});
        let mut command = if helper.exists() { Command::new(helper) } else {
            if !cfg!(debug_assertions) { return Err("后台组件缺失，请重新安装 fmWorker".into()) }
            let root=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
            let python=root.join(if cfg!(windows){".venv/Scripts/python.exe"}else{".venv/bin/python"});
            let mut c=Command::new(python); c.arg(root.join("runtime/bridge.py")); c
        };
        command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        command.env("PYTHONUTF8","1").env("PYTHONIOENCODING","utf-8");
        command.env("FMWORKER_NATIVE_EXECUTABLE",&exe);
        #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
        let mut child=command.spawn().map_err(|_|"后台组件启动失败，请重新安装或查看诊断记录".to_string())?;
        let input=child.stdin.take().ok_or("无法连接后台")?;
        let output=BufReader::new(child.stdout.take().ok_or("无法读取后台状态")?);
        Ok(Self{child,input,output,sequence:0})
    }
    fn call(&mut self, method:&str, params:Value)->Result<Value,String>{
        self.sequence+=1;
        let message=json!({"id":self.sequence,"method":method,"params":params});
        writeln!(self.input,"{}",message).map_err(|_|"后台连接已断开".to_string())?;
        self.input.flush().map_err(|_|"后台连接已断开".to_string())?;
        let mut line=String::new();
        if self.output.read_line(&mut line).map_err(|_|"无法读取后台状态".to_string())?==0 { return Err("后台已停止，请重新打开 fmWorker".into()) }
        let response:Value=serde_json::from_str(&line).map_err(|_|"后台返回格式无效".to_string())?;
        if response.get("id").and_then(Value::as_u64)!=Some(self.sequence) {return Err("后台响应序号不符".into())}
        if let Some(error)=response.get("error").and_then(Value::as_str){return Err(error.into())}
        Ok(response["result"].clone())
    }
}
impl Drop for Bridge {fn drop(&mut self){let _=self.child.kill();}}
type Shared=Arc<Mutex<Option<Bridge>>>;
struct ExitControl {requested:AtomicBool,allowed:AtomicBool}
fn request(shared:&Shared,method:&str,params:Value)->Result<Value,String>{
    let mut guard=shared.lock().map_err(|_|"后台状态不可用".to_string())?;
    if guard.is_none(){*guard=Some(Bridge::start()?)}
    guard.as_mut().unwrap().call(method,params)
}
#[tauri::command]
async fn rpc(method:String,params:Value,state:tauri::State<'_,Shared>)->Result<Value,String>{
    let shared=state.inner().clone();
    tauri::async_runtime::spawn_blocking(move||request(&shared,&method,params)).await.map_err(|_|"后台操作未完成".to_string())?
}
fn begin_shutdown(app:&tauri::AppHandle){
    if app.state::<ExitControl>().requested.swap(true,Ordering::SeqCst){return}
    let handle=app.clone();let state=app.state::<Shared>().inner().clone();
    if state.lock().map(|bridge|bridge.is_none()).unwrap_or(false){
        // A preview or not-yet-initialized window owns no controller. Do not
        // start a real resource backend merely to close that window.
        handle.state::<ExitControl>().allowed.store(true,Ordering::SeqCst);
        handle.exit(0);return
    }
    std::thread::spawn(move||{
        if request(&state,"shutdown",json!({})).is_err(){
            // A dead controller must not trap the shell. Independently running
            // resources retain their watchdog deadline and recovery record.
            handle.state::<ExitControl>().allowed.store(true,Ordering::SeqCst);
            handle.exit(0);return
        }
        loop{std::thread::sleep(Duration::from_secs(2));match request(&state,"status",json!({})){
            Ok(v) if v["can_quit"]==true=>{
                handle.state::<ExitControl>().allowed.store(true,Ordering::SeqCst);handle.exit(0);break
            },
            Err(_)=>{
                handle.state::<ExitControl>().allowed.store(true,Ordering::SeqCst);
                handle.exit(0);break
            },_=>{}
        }}
    });
}
#[tauri::command]
fn quit_app(app:tauri::AppHandle){begin_shutdown(&app)}

fn main(){
    if let Some(code)=chrome_native::try_run(&std::env::args().skip(1).collect::<Vec<_>>()){
        std::process::exit(code);
    }
    let shared:Shared=Arc::new(Mutex::new(None));
    let application=tauri::Builder::default().manage(shared)
        .manage(ExitControl{requested:AtomicBool::new(false),allowed:AtomicBool::new(false)})
        .invoke_handler(tauri::generate_handler![rpc,quit_app])
        .setup(|app|{
            let mut tray=TrayIconBuilder::new().tooltip("打开 fmWorker").show_menu_on_left_click(false)
                .on_tray_icon_event(|tray,event|{
                    if let TrayIconEvent::Click{button:MouseButton::Left,button_state:MouseButtonState::Up,..}=event{
                        if let Some(window)=tray.app_handle().get_webview_window("main"){
                            let _=window.unminimize();let _=window.show();let _=window.set_focus();
                        }
                    }
                });
            if let Some(icon)=app.default_window_icon(){tray=tray.icon(icon.clone());}
            tray.build(app)?; Ok(())
        }).on_window_event(|window,event|{if let tauri::WindowEvent::CloseRequested{api,..}=event{api.prevent_close();let _=window.hide();}})
        .build(tauri::generate_context!()).expect("fmWorker failed to start");
    application.run(|app,event|{
        if let tauri::RunEvent::ExitRequested{api,..}=event{
            if !app.state::<ExitControl>().allowed.load(Ordering::SeqCst){api.prevent_exit();begin_shutdown(app);}
        }
    });
}
