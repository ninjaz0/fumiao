"""Independent Colab release watchdog; no Google account refresh credentials."""
import json
import os
import signal
import subprocess
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parent


def read(name, default):
    try:return json.loads((ROOT/name).read_text())
    except (OSError,ValueError):return default


def reason(config, status, controller, timestamp):
    if config.get('cloud'):
        # A Colab belongs to the user until an explicit release. Loss of the
        # desktop, idleness, worker failure and elapsed time are not permission.
        return 'drained' if not status.get('ticket') and (ROOT/'drain').exists() else None
    if timestamp >= config['deadline']:return 'maximum-runtime'
    if status.get('stage') in ('error','stopped'):return 'worker-stopped'
    started=config['started_at']
    if timestamp-started>7200 and status.get('stage')=='preparing':return 'initialization-timeout'
    if timestamp-status.get('at',started)>180:return 'worker-unresponsive'
    idle=status.get('stage') in ('ready','error','stopped') and not status.get('ticket')
    if not status.get('ticket') and (ROOT/'drain').exists():return 'drained'
    if idle and timestamp-controller.get('at',started)>180:return 'controller-offline'
    if idle and timestamp-status.get('last_busy',started)>config['idle_minutes']*60:return 'idle'
    return None


def release():
    from google.colab import runtime
    runtime.unassign()


def main():
    config=read('config.json',{})
    while True:
        if read('config.json',{}).get('run_id')!=config.get('run_id'):return
        now=time.time();status=read('worker-status.json',{})
        if status.get('run_id')!=config.get('run_id'):status={}
        controller=read('controller.json',{})
        if not config.get('cloud') and now-controller.get('at',config['started_at'])>180:(ROOT/'drain').touch()
        why=reason(config,status,controller,now)
        if why:
            (ROOT/'release-requested.json').write_text(json.dumps({'reason':why,'at':now}))
            pid=status.get('pid')
            if pid and pid>1:
                try:
                    command=(Path('/proc')/str(pid)/'cmdline').read_bytes().split(b'\0')
                    if str(ROOT/'cloud_entry.py').encode() in command:os.kill(pid,signal.SIGTERM)
                except (ProcessLookupError,FileNotFoundError):pass
            if config.get('cloud'):
                try:release()
                except Exception:pass
            else:
                try:
                    env=dict(os.environ,BREEZE_HOME=str(ROOT/'models/breeze'))
                    subprocess.run([str(ROOT/'venv/bin/python'),'-c',
                        "import sys;sys.path.insert(0,"+repr(str(ROOT/'agent'))+");import breeze_adapter;breeze_adapter.stop_service()"],
                        env=env,timeout=30,check=False)
                except Exception:pass
                return
            # A failed release must be retried. Only the controller can confirm
            # disappearance from Google's assignment list.
        time.sleep(15)

if __name__=='__main__':main()
