//! Native Messaging transport. Runs before Tauri/Python initialization.
use serde_json::{json, Value};
use std::{io::{self, Read, Write}, net::{SocketAddr,TcpStream}, path::PathBuf,
    sync::{Arc,Mutex,atomic::{AtomicBool,Ordering}}, thread, time::{Duration,SystemTime,UNIX_EPOCH}};

const LIMIT:usize=262144;
const EXTENSION_ID:&str=include_str!("../../resources/chrome-extension/id.txt");

fn read_packet<R:Read>(input:&mut R)->io::Result<Option<Value>>{
    let mut header=[0u8;4];
    if input.read(&mut header[..1])?==0{return Ok(None)}
    input.read_exact(&mut header[1..])?;
    let count=u32::from_ne_bytes(header) as usize;
    if count==0||count>LIMIT{return Err(io::Error::new(io::ErrorKind::InvalidData,"Invalid packet size"))}
    let mut body=vec![0;count];input.read_exact(&mut body)?;
    let value:Value=serde_json::from_slice(&body)?;
    if !value.is_object(){return Err(io::Error::new(io::ErrorKind::InvalidData,"Expected object"))}
    Ok(Some(value))
}

fn write_packet<W:Write>(output:&mut W,value:&Value)->io::Result<()>{
    let body=serde_json::to_vec(value)?;
    if body.len()>LIMIT{return Err(io::Error::new(io::ErrorKind::InvalidData,"Response too large"))}
    output.write_all(&(body.len() as u32).to_ne_bytes())?;
    output.write_all(&body)?;output.flush()
}

fn state_root()->Option<PathBuf>{
    if let Some(path)=std::env::var_os("FMWORKER_HOME"){return Some(PathBuf::from(path))}
    if cfg!(target_os="windows"){return std::env::var_os("LOCALAPPDATA").map(|p|PathBuf::from(p).join("fmWorker"))}
    std::env::var_os("HOME").map(|p|PathBuf::from(p).join("Library/Application Support/fmWorker"))
}

fn relay(packet:Value)->Result<Value,&'static str>{
    let path=state_root().ok_or("app_closed")?.join("chrome-bridge.json");
    let raw=std::fs::read(path).map_err(|_|"app_closed")?;
    let info:Value=serde_json::from_slice(&raw).map_err(|_|"app_closed")?;
    let port=info["port"].as_u64().filter(|p|*p>=1024&&*p<=65535).ok_or("app_closed")? as u16;
    let secret=info["secret"].as_str().filter(|s|s.len()>=20&&s.len()<=200&&s.bytes().all(|c|c.is_ascii_alphanumeric()||c==b'-'||c==b'_')).ok_or("app_closed")?;
    let body=serde_json::to_vec(&packet).map_err(|_|"app_closed")?;
    let address=SocketAddr::from(([127,0,0,1],port));
    let mut stream=TcpStream::connect_timeout(&address,Duration::from_secs(3)).map_err(|_|"app_closed")?;
    stream.set_read_timeout(Some(Duration::from_secs(6))).map_err(|_|"app_closed")?;
    stream.set_write_timeout(Some(Duration::from_secs(3))).map_err(|_|"app_closed")?;
    let header=format!("POST /bridge HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {secret}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",body.len());
    stream.write_all(header.as_bytes()).and_then(|_|stream.write_all(&body)).map_err(|_|"app_closed")?;
    let mut response=Vec::new();stream.take((LIMIT+4096) as u64).read_to_end(&mut response).map_err(|_|"app_closed")?;
    let end=response.windows(4).position(|w|w==b"\r\n\r\n").ok_or("app_closed")?;
    let head=std::str::from_utf8(&response[..end]).map_err(|_|"app_closed")?;
    if head.lines().next().and_then(|s|s.split_whitespace().nth(1))!=Some("200"){return Err("app_closed")}
    let value:Value=serde_json::from_slice(&response[end+4..]).map_err(|_|"app_closed")?;
    if value.get("error").is_some(){return Err("another_profile")}
    value.get("result").cloned().ok_or("app_closed")
}

pub fn try_run(args:&[String])->Option<i32>{
    let origin=args.first()?;
    if !origin.starts_with("chrome-extension://"){return None}
    if origin!=&format!("chrome-extension://{}/",EXTENSION_ID.trim()){return Some(2)}
    let client=format!("chrome-{}-{:032x}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos());
    let output=Arc::new(Mutex::new(io::stdout()));
    let stop=Arc::new(AtomicBool::new(false));
    let version=Arc::new(Mutex::new(String::new()));
    let mut started=false;let stdin=io::stdin();let mut input=stdin.lock();
    loop{
        let packet=match read_packet(&mut input){Ok(Some(v))=>v,_=>break};
        match packet["type"].as_str(){
            Some("hello")=>{
                if let Ok(mut v)=version.lock(){*v=packet["version"].as_str().unwrap_or("").chars().take(32).collect()}
                if started{continue}started=true;
                let (out,ended,revision,owner)=(output.clone(),stop.clone(),version.clone(),client.clone());
                thread::spawn(move||{
                    while !ended.load(Ordering::SeqCst){
                        let ver=revision.lock().map(|v|v.clone()).unwrap_or_default();
                        let messages=match relay(json!({"op":"poll","client":owner,"version":ver})){
                            Ok(value)=>{
                                let mut items=vec![json!({"type":"status","connected":value["connected"],"reason":value["reason"]})];
                                if let Some(commands)=value["commands"].as_array(){for command in commands{
                                    items.push(json!({"type":"command","id":command["id"],"kind":command["kind"],"payload":command["payload"]}));
                                }}items
                            },
                            Err(reason)=>vec![json!({"type":"status","connected":false,"reason":reason})],
                        };
                        if let Ok(mut writer)=out.lock(){for message in messages{
                            if write_packet(&mut *writer,&message).is_err(){ended.store(true,Ordering::SeqCst);return}
                        }}else{return}
                        thread::sleep(Duration::from_secs(2));
                    }
                });
            },
            Some("result") if started=>{let _=relay(json!({"op":"result","client":client,"id":packet["id"],"result":packet["result"]}));},
            _=>{},
        }
    }
    stop.store(true,Ordering::SeqCst);
    if started{let _=relay(json!({"op":"disconnect","client":client}));}
    Some(0)
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]fn utf8_frame_round_trip(){let value=json!({"type":"hello","text":"中文"});let mut data=Vec::new();write_packet(&mut data,&value).unwrap();assert_eq!(read_packet(&mut &data[..]).unwrap(),Some(value));}
    #[test]fn rejects_oversized_or_truncated_frames(){assert!(read_packet(&mut &((LIMIT+1) as u32).to_ne_bytes()[..]).is_err());assert!(read_packet(&mut &b"x"[..]).is_err());}
    #[test]fn rejects_other_extensions_before_loading_state(){assert_eq!(try_run(&["chrome-extension://invalid/".into()]),Some(2));assert_eq!(try_run(&[]),None);}
    #[test]fn extension_id_is_fixed_and_well_formed(){let id=EXTENSION_ID.trim();assert_eq!(id.len(),32);assert!(id.bytes().all(|c|(b'a'..=b'p').contains(&c)));}
}
