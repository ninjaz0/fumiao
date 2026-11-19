"""Chrome Native Messaging host. Only the bundled extension is accepted."""
import json
import secrets
import struct
import threading
import urllib.request
from .state import home
from .chrome_bridge import extension_id, extension_manifest, MAX_PACKET


def read_packet(stream):
    header=stream.read(4)
    if not header:return None
    if len(header)!=4:raise ValueError('Truncated native header')
    length=struct.unpack('=I',header)[0]
    if not 0<length<=MAX_PACKET:raise ValueError('Invalid native packet size')
    data=stream.read(length)
    if len(data)!=length:raise ValueError('Truncated native payload')
    value=json.loads(data)
    if not isinstance(value,dict):raise ValueError('Invalid native packet')
    return value


def local_request(packet):
    info=json.loads((home()/'chrome-bridge.json').read_text())
    port=int(info['port'])
    if not 1024<=port<=65535:raise ValueError('Invalid bridge port')
    request=urllib.request.Request(f'http://127.0.0.1:{port}/bridge',data=json.dumps(packet).encode(),
        headers={'Authorization':'Bearer '+info['secret'],'Content-Type':'application/json'},method='POST')
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request,timeout=5) as response:
        value=json.load(response)
    if value.get('error'):raise RuntimeError(value['error'])
    return value['result']


def run(args,input_stream,output_stream):
    origin='chrome-extension://'+extension_id()+'/'
    if not args or args[0]!=origin:return 2
    client=secrets.token_urlsafe(24);stop=threading.Event();lock=threading.Lock()
    version={'value':''}
    def send(value):
        raw=json.dumps(value,ensure_ascii=False).encode()
        if len(raw)>MAX_PACKET:raise ValueError('Response too large')
        with lock:output_stream.write(struct.pack('=I',len(raw))+raw);output_stream.flush()
    def poll():
        while not stop.is_set():
            try:
                result=local_request({'op':'poll','client':client,'version':version['value']})
                send({'type':'status','connected':True})
                for command in result.get('commands',[]):send({'type':'command',**command})
            except RuntimeError:send({'type':'status','connected':False,'reason':'another_profile'})
            except (OSError,ValueError):send({'type':'status','connected':False,'reason':'app_closed'})
            except Exception:stop.set();break
            stop.wait(2)
    thread=threading.Thread(target=poll,daemon=True)
    started=False
    try:
        while True:
            packet=read_packet(input_stream)
            if packet is None:break
            if packet.get('type')=='hello':
                version['value']=str(packet.get('version',''))[:32]
                if not started:thread.start();started=True
            elif packet.get('type')=='result' and started:
                try:local_request({'op':'result','client':client,'id':packet.get('id'),'result':packet.get('result')})
                except Exception:pass
    except (ValueError,OSError):pass
    finally:
        stop.set()
        if started:
            try:local_request({'op':'disconnect','client':client})
            except Exception:pass
    return 0
