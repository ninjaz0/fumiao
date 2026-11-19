"""Model-aware preflight used by the shell entry point before enrollment/downloads."""
import json,os,sys
from pathlib import Path
from node_models import GPU_MODELS,plan,execution_plan
from hardware_probe import probe,budget_probe


def main():
    slugs=(sys.argv[1] if len(sys.argv)>1 else 'minimax-h3').split(',')
    by_slug={value['slug']:key for key,value in GPU_MODELS.items()}
    if not slugs or any(s not in by_slug for s in slugs):raise SystemExit('模型选项无效，请重新复制接入命令')
    selected=list(dict.fromkeys(by_slug[s] for s in slugs))
    root=Path(__file__).resolve().parent;state=root/'state';state.mkdir(exist_ok=True)
    hardware=probe(os.getenv('FUMIAO_CACHE_ROOT','/opt'))
    report=plan(hardware,selected,check_disk=False)
    print(f"系统内存 {hardware['ram_gib']:.1f} GiB；磁盘可用 {hardware['disk_free_gib']:.1f} GiB",flush=True)
    for gpu in hardware['devices']:print(f"GPU {gpu['index']}：{gpu['name']} ({gpu['backend'].upper()})，显存 {gpu['vram_gib']:.1f} GiB，可用 {gpu.get('free_gib',0):.1f} GiB",flush=True)
    if not report['ok']:raise SystemExit('\n'.join(report['issues']))
    report['execution']=execution_plan(hardware,selected)
    if report['execution']['mode']=='parallel' and not all(budget_probe(sys.executable,index) for index in {lane['device'] for lane in report['execution']['lanes'].values()}):
        report['execution']={'mode':'serial','policy':'gpu-budget-v1','reason':'运行环境未通过显存额度检查'}
        print('显存额度接口不可用，采用自动切换的顺序模式',flush=True)
    if report['execution'].get('initial_available') is False:print('当前显存已有占用，服务会根据实时空闲资源领取任务',flush=True)
    print('执行方式：'+('视频与语音可并行，启用独立资源预算' if report['execution']['mode']=='parallel' else '按队列依次执行'),flush=True)
    print('硬件规格满足所选模型：'+', '.join(GPU_MODELS[m]['label'] for m in selected),flush=True)
    (state/'hardware-plan.json').write_text(json.dumps({'hardware':hardware,'plan':report},ensure_ascii=False))
    (state/'requested-models.json').write_text(json.dumps(selected))


if __name__=='__main__':main()
