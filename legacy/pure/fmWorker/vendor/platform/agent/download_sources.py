"""Probe real file throughput, choose a source, resume across byte-identical mirrors."""
import errno
import concurrent.futures
import hashlib
import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path


class StorageFullError(OSError):
    """A storage failure must not be retried against a different download mirror."""


def valid(path,entry,progress=lambda _:None,cancel=lambda:False):
    if not path.is_file() or path.stat().st_size!=entry['bytes']:return False
    h=hashlib.sha256() if entry.get('sha256') else hashlib.sha1(f"blob {entry['bytes']}\0".encode())
    name=Path(entry['path']).name;done=0;last=time.monotonic()
    progress('校验 '+name)
    with path.open('rb') as src:
        while block:=src.read(8*1024**2):
            if cancel():raise InterruptedError('下载校验已停止')
            h.update(block);done+=len(block)
            if time.monotonic()-last>=3:
                progress(f'校验 {name} {done*100//max(1,entry["bytes"])}%');last=time.monotonic()
    return h.hexdigest()==(entry.get('sha256') or entry['git_blob'])


def range_response(response,offset,total,probe=False):
    if response.status==206:
        m=re.fullmatch(r'bytes (\d+)-(\d+)/(\d+)',response.headers.get('Content-Range',''))
        if not m or int(m[1])!=offset or int(m[3])!=total:raise ValueError('下载源返回了错误的字节范围')
    elif response.status==200:
        size=response.headers.get('Content-Length')
        if size and int(size)!=total:raise ValueError('下载源文件大小不符')
    else:raise ValueError('下载源响应无效')


def probe_source(source,entry,probe_bytes=8*1024**2,timeout=8):
    start=time.monotonic();size=min(entry['bytes'],probe_bytes);received=0
    try:
        request=urllib.request.Request(source['url'],headers={'Range':f'bytes=0-{size-1}','Accept-Encoding':'identity','User-Agent':'Fumiao-Model-Installer/1'})
        with urllib.request.urlopen(request,timeout=timeout) as response:
            range_response(response,0,entry['bytes'],True)
            first=time.monotonic()
            while received<size:
                block=response.read(min(256*1024,size-received))
                if not block:break
                received+=len(block)
                if time.monotonic()-start>timeout:break
        elapsed=time.monotonic()-start
        if received<min(size,64*1024):raise ValueError('测速数据不足')
        return {**source,'ok':True,'bytes':received,'seconds':round(elapsed,3),'first_byte_s':round(first-start,3),'bytes_per_second':received/max(elapsed,.001)}
    except Exception as error:
        return {**source,'ok':False,'bytes_per_second':0,'error':type(error).__name__}


def rank_sources(entries,report=None,progress=lambda _:None,probe_bytes=8*1024**2,timeout=8):
    # Use a real large weight present on all candidate sources, not a website or ping.
    entry=max(entries,key=lambda e:e['bytes']);sources=entry['sources']
    progress('正在测试模型下载源')
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(4,len(sources))) as pool:
        results=list(pool.map(lambda source:probe_source(source,entry,probe_bytes,timeout),sources))
    ordered=sorted(results,key=lambda r:r['bytes_per_second'],reverse=True)
    if report:
        dest=Path(report);dest.parent.mkdir(parents=True,exist_ok=True);temp=dest.with_name(dest.name+'.tmp')
        temp.write_text(json.dumps({'checked_at':int(time.time()),'sample_file':entry['path'],'sources':ordered},ensure_ascii=False,indent=2));temp.replace(dest)
    for result in ordered:
        progress(result['name']+'：'+(f"{result['bytes_per_second']/1e6:.1f} MB/s" if result['ok'] else '不可用'))
    if not any(r['ok'] for r in ordered):raise RuntimeError('没有可用的模型下载源，请检查网络后重试')
    progress('优先使用 '+next(r['name'] for r in ordered if r['ok']))
    return ordered


def fetch(entry,path,ranking,progress=lambda _:None,cancel=lambda:False):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    if valid(path,entry,progress,cancel):return
    if path.exists():raise RuntimeError('已有模型文件校验失败，请先检查并移开：'+path.name)
    partial=path.with_name(path.name+'.partial')
    if valid(partial,entry,progress,cancel):partial.replace(path);return
    if partial.exists() and partial.stat().st_size>entry['bytes']:partial.unlink()
    by_id={s['id']:s for s in entry['sources']}
    preferred=[r for r in ranking if r['ok'] and r['id'] in by_id]
    # Different files can have distinct CDN availability; keep other same-version sources as fallback.
    preferred += [dict(s,bytes_per_second=0) for s in entry['sources'] if s['id'] not in {r['id'] for r in preferred}]
    errors=[]
    for attempt,ranked in enumerate(preferred):
        if cancel():raise RuntimeError('下载已停止')
        source=by_id[ranked['id']];offset=partial.stat().st_size if partial.exists() else 0
        if offset==entry['bytes']:
            if valid(partial,entry,progress,cancel):partial.replace(path);return
            partial.unlink();offset=0
        headers={'Accept-Encoding':'identity','User-Agent':'Fumiao-Model-Installer/1'}
        if offset:headers['Range']=f'bytes={offset}-'
        progress(('切换至 ' if attempt else '下载源：')+source['name']+' · '+path.name)
        try:
            request=urllib.request.Request(source['url'],headers=headers)
            with urllib.request.urlopen(request,timeout=20) as response:
                range_response(response,offset,entry['bytes'])
                if response.status==200:offset=0 # A mirror that ignores Range restarts safely.
                began=window=time.monotonic();window_start=offset;last=0
                with partial.open('ab' if offset else 'wb') as out:
                    while block:=response.read(1024*1024):
                        if cancel():raise InterruptedError('下载已停止')
                        offset+=len(block)
                        if offset>entry['bytes']:raise ValueError('文件超出声明大小')
                        out.write(block)
                        stamp=time.monotonic()
                        if stamp-last>=1:
                            rate=(offset-window_start)/max(stamp-window,.001)
                            progress(f"{source['name']} · {path.name} {offset*100//entry['bytes']}% · {offset/1e9:.2f}/{entry['bytes']/1e9:.2f} GB · {rate/1e6:.1f} MB/s")
                            last=stamp
                        if stamp-window>=30:
                            rate=(offset-window_start)/(stamp-window)
                            alternatives=preferred[attempt+1:]
                            if alternatives and max(r.get('bytes_per_second',0) for r in alternatives)>max(rate*4,1024**2):
                                raise TimeoutError('当前下载源变慢，尝试更快来源')
                            window=stamp;window_start=offset
            if not valid(partial,entry,progress,cancel):
                if partial.stat().st_size==entry['bytes']:partial.unlink()
                raise ValueError('模型文件摘要或大小不符')
            partial.replace(path);return
        except InterruptedError:raise
        except OSError as error:
            if error.errno in (errno.ENOSPC,errno.EDQUOT):raise StorageFullError(str(path)) from error
            errors.append(source['name']+': '+type(error).__name__)
        except (ValueError,urllib.error.URLError) as error:
            errors.append(source['name']+': '+type(error).__name__)
    raise RuntimeError('所有下载源均失败；断点已保留。'+ '；'.join(errors))


if __name__=='__main__':
    import sys
    lock=json.loads(Path(sys.argv[1]).read_text())
    result=rank_sources(lock['files'],sys.argv[2] if len(sys.argv)>2 else None,print)
    print(json.dumps([{k:r[k] for k in ('id','name','ok','bytes_per_second')} for r in result],ensure_ascii=False))
