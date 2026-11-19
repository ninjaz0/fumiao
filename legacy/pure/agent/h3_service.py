"""Restart only this node's verified, idle ComfyUI process when its budget changes."""
import json,os,signal,time,urllib.request
from pathlib import Path
from rocm_attention_patch import process_started,boot_id


def stop_owned(source,receipt,url):
    source=Path(source)
    try:
        value=json.loads(Path(receipt).read_text());pid=int(value['pid'])
        if value['boot_id']!=boot_id() or value['started']!=process_started(pid):return False
        command=Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0')
        if str(source/'main.py').encode() not in command or os.getpgid(pid)!=pid:return False
        with urllib.request.urlopen(url+'/queue',timeout=5) as r:queue=json.load(r)
        if queue.get('queue_running') or queue.get('queue_pending'):raise RuntimeError('H3 仍在处理任务，稍后再调整资源预算')
        os.killpg(pid,signal.SIGTERM)
        for _ in range(50):
            try:
                fields=Path(f'/proc/{pid}/stat').read_text().rsplit(')',1)[1].split()
                if fields[0] in ('Z','X'):return True
            except OSError:return True
            time.sleep(.2)
        raise RuntimeError('H3 服务尚未退出，请稍后重试')
    except (OSError,ValueError,KeyError):return False
