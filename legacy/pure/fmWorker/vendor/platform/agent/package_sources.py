"""Retry dependency installation on known indexes without relaxing hash/TLS checks."""
import os,subprocess,time
from urllib.parse import urlsplit

FALLBACKS=('https://pypi.org/simple','https://pypi.tuna.tsinghua.edu.cn/simple')

def install(python,arguments,cancel=lambda:False,progress=print):
    configured=os.getenv('PIP_INDEX_URL','').strip()
    if not configured:
        result=subprocess.run([str(python),'-m','pip','config','get','global.index-url'],capture_output=True,text=True,timeout=15)
        if result.returncode==0:configured=result.stdout.strip()
    indexes=list(dict.fromkeys([configured or None,*os.getenv('FUMIAO_PYPI_INDEX_URLS','').split(),*FALLBACKS]))
    for attempt,index in enumerate(indexes):
        if cancel():raise RuntimeError('依赖安装已取消')
        label=urlsplit(index).hostname if index else '当前配置'
        progress(('尝试备用依赖源：' if attempt else '依赖下载源：')+str(label))
        env=dict(os.environ)
        command=[str(python),'-m','pip','install','--disable-pip-version-check','--timeout','20','--retries','2']
        if index:command+=['--index-url',index]
        if attempt:
            # Avoid a broken mirror's cached response or extra-index configuration.
            env.update(PIP_CONFIG_FILE=os.devnull,PIP_EXTRA_INDEX_URL='',PIP_FIND_LINKS='')
            env.pop('PIP_TRUSTED_HOST',None)
            command.append('--no-cache-dir')
        command+=list(arguments)
        process=subprocess.Popen(command,env=env,stdin=subprocess.DEVNULL)
        try:
            while process.poll() is None:
                if cancel():
                    process.terminate()
                    try:process.wait(timeout=10)
                    except subprocess.TimeoutExpired:process.kill();process.wait()
                    raise RuntimeError('依赖安装已取消')
                time.sleep(.5)
        except BaseException:
            if process.poll() is None:process.terminate()
            raise
        if process.returncode==0:return
        progress('当前依赖源安装未完成，将保留已验证的环境并换源重试')
    raise RuntimeError('所有依赖源安装均未完成，请查看上方的具体错误')

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--python',required=True)
    options,args=parser.parse_known_args()
    install(options.python,args[1:] if args[:1]==['--'] else args,
            progress=lambda message:print('FM_STAGE '+message,flush=True))
