"""Fresh memory checks before a parallel lane accepts another task; unknown is busy."""
import json,os,time,urllib.request
from pathlib import Path
from limited_runtime import process_rss


def memory_available():
    values=[]
    try:
        for line in Path('/proc/meminfo').read_text().splitlines():
            if line.startswith('MemAvailable:'):values.append(int(line.split()[1])*1024)
    except OSError:pass
    for maximum,current,stats,hierarchical in [('/sys/fs/cgroup/memory.max','/sys/fs/cgroup/memory.current','/sys/fs/cgroup/memory.stat',False),('/sys/fs/cgroup/memory/memory.limit_in_bytes','/sys/fs/cgroup/memory/memory.usage_in_bytes','/sys/fs/cgroup/memory/memory.stat',True)]:
        try:
            limit=Path(maximum).read_text().strip()
            if not limit.isdigit():continue
            limit=int(limit);used=int(Path(current).read_text());reclaimable=0
            try:
                counters=dict(line.split() for line in Path(stats).read_text().splitlines())
                def counter(name):
                    key='total_'+name if hierarchical and 'total_'+name in counters else name
                    return max(0,int(counters.get(key,0)))
                # Re-reading verified weights promotes their clean pages to the
                # active file LRU. Both file LRUs are reclaimable; counting only
                # inactive pages makes a restored, idle model wait indefinitely.
                # Anonymous/locked pages are outside these LRUs. Cap by normal
                # file cache so tmpfs and dirty writes remain charged.
                dirty=counter('dirty' if hierarchical else 'file_dirty')
                writeback=counter('writeback' if hierarchical else 'file_writeback')
                clean_files=counter('inactive_file')+counter('active_file')
                cache_key='cache' if hierarchical else 'file'
                if cache_key in counters or 'total_'+cache_key in counters:
                    clean_files=min(clean_files,max(0,counter(cache_key)-counter('shmem')))
                reclaimable=min(used,max(0,clean_files-dirty-writeback))
            except (OSError,ValueError):pass
            values.append(min(limit,max(0,limit-used+reclaimable)))
        except (OSError,ValueError):pass
    return min(values) if values else None


def valid_receipt(path,budget):
    try:
        r=json.loads(Path(path).read_text());fields=Path(f"/proc/{r['pid']}/stat").read_text().rsplit(')',1)[1].split()
        return r if r.get('allocator')=='native' and fields[0] not in ('Z','X') and fields[19]==r['started'] and r['boot']==Path('/proc/sys/kernel/random/boot_id').read_text().strip() and abs(r['budget_gib']-budget)<.01 else None
    except (OSError,ValueError,KeyError,IndexError,TypeError):return None


def enough(lane,plan,free_gpu,own_gpu,free_ram,own_ram):
    device=str(lane['device']);gpu_margin=min(4,plan['reserve_vram_gib'][device])*2**30
    # The plan's larger reserve also covers already allocated driver/library workspaces.
    ram_margin=plan['reserve_ram_gib']*2**30
    if free_gpu+own_gpu+32*1024**2 < lane['gpu_budget_gib']*2**30+gpu_margin:return False,'等待可用显存'
    if free_ram is None or free_ram+own_ram < lane['ram_budget_gib']*2**30+ram_margin:return False,'等待可用系统内存'
    return True,'资源就绪'


def check(model,plan,root):
    lane=plan['lanes'][model]
    if model=='MiniMax H3':
        endpoint='http://127.0.0.1:'+os.getenv('H3_PORT','18388')+'/fumiao/resources'
        receipt=Path(os.getenv('H3_CACHE','/opt/fumiao-h3'))/'memory-limit.json'
    else:
        endpoint='http://127.0.0.1:'+os.getenv('BREEZE_PORT','18389')+'/fumiao/resources'
        receipt=Path(os.getenv('BREEZE_HOME','/opt/fumiao-breeze'))/'memory-limit.json'
    verified=valid_receipt(receipt,lane['gpu_budget_gib'])
    if not verified:return False,'等待显存预算检查'
    try:
        with urllib.request.urlopen(endpoint,timeout=3) as response:value=json.load(response)
        free=value['free_bytes'];own=value['reserved_bytes'];rss=value.get('anonymous_bytes',0)
        return enough(lane,plan,free,own,memory_available(),rss)
    except (OSError,ValueError,KeyError,IndexError):return False,'等待模型服务就绪'
