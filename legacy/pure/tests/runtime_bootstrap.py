"""Missing ensurepip must remain isolated and unrelated filesystem failures must fail."""
import os,subprocess,sys,tempfile
from pathlib import Path
from unittest.mock import patch
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'agent'))
import runtime_cache as rc

with tempfile.TemporaryDirectory() as d:
    venv=Path(d)/'venv';python=venv/'bin/python';calls=[];messages=[]
    def run(args,**kwargs):
        calls.append(args)
        if args[1:3]==['-m','venv'] and '--without-pip' not in args:
            return subprocess.CompletedProcess(args,1,'',"Error: ensurepip returned non-zero exit status 1")
        return subprocess.CompletedProcess(args,0,'','')
    with patch.object(rc.subprocess,'run',side_effect=run),patch.object(rc,'pip_ready',side_effect=[False,True]):
        assert rc.create_environment('/base/python',venv,True,messages.append)==python
    assert any('--without-pip' in c and '--system-site-packages' in c for c in calls)
    installs=[c for c in calls if 'install' in c]
    assert installs==[['/base/python','-m','pip','--python',str(python),'install','pip>=23']]
    assert len(messages)==2
    with patch.object(rc.subprocess,'run',return_value=subprocess.CompletedProcess([],1,'','Permission denied')) as call:
        try:rc.create_environment('/base/python',venv);raise AssertionError('Filesystem error was hidden')
        except RuntimeError as e:assert 'Permission denied' in str(e)
        assert call.call_count==1

# Exercise the real isolation boundary without network or changing the base environment.
with tempfile.TemporaryDirectory() as d:
    venv=Path(d)/'venv';real_run=subprocess.run
    def absent_ensurepip(args,**kwargs):
        if args[1:3]==['-m','venv'] and '--without-pip' not in args:
            return subprocess.CompletedProcess(args,1,'','ensurepip unavailable')
        assert 'install' not in args,'This fixture must reuse the inherited pip without downloads'
        return real_run(args,**kwargs)
    # The test runner may itself be in a venv. Expose its pip as Colab exposes
    # the global pip, without downloading anything or changing either prefix.
    import pip
    with patch.dict(os.environ,{'PYTHONPATH':str(Path(pip.__file__).parent.parent)}):
        with patch.object(rc.subprocess,'run',side_effect=absent_ensurepip):python=rc.create_environment(sys.executable,venv,True,lambda _:None)
        prefix=subprocess.check_output([str(python),'-c','import sys;print(sys.prefix);print(sys.base_prefix)'],text=True).splitlines()
        assert Path(prefix[0]).resolve()==venv.resolve() and prefix[0]!=prefix[1]
        assert rc.pip_ready(python)
print('PASS missing ensurepip fallback, target-only pip bootstrap, filesystem failures and real isolated prefix')
