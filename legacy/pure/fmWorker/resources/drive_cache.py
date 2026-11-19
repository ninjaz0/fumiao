"""Content-addressed Drive cache. Short-lived credentials only, no FUSE."""
import hashlib
import json
import os
import time
from pathlib import Path
import requests


class DriveCache:
    def __init__(self, credential_file, progress=lambda message:None):
        self.path=Path(credential_file);self.progress=progress

    def headers(self):
        value=json.loads(self.path.read_text())
        if set(value)-{'access_token','expires_at'}:raise ValueError('Unexpected cloud credential fields')
        if value['expires_at']<time.time()+15:raise RuntimeError('Drive 短期授权已过期，等待电脑重新连接')
        return {'Authorization':'Bearer '+value['access_token']}

    def request(self, method, url, **kwargs):
        response=requests.request(method,url,headers=self.headers()|kwargs.pop('headers',{}),timeout=90,**kwargs)
        response.raise_for_status();return response

    def lookup(self, digest):
        # drive.file only returns files this OAuth client is allowed to access.
        q="trashed=false and appProperties has { key='fmworker_sha256' and value='"+digest+"' }"
        response=self.request('GET','https://www.googleapis.com/drive/v3/files',params={'q':q,'fields':'files(id,size)','pageSize':10}).json()
        return response.get('files',[])

    def restore(self, entry, path):
        path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
        for file in self.lookup(entry['sha256']):
            if int(file.get('size',-1))!=entry['bytes']:continue
            part=path.with_suffix(path.suffix+'.drive-part')
            offset=part.stat().st_size if part.exists() else 0
            if offset>entry['bytes']:part.unlink();offset=0
            self.progress('从 Drive 恢复 '+path.name)
            response=self.request('GET','https://www.googleapis.com/drive/v3/files/'+file['id'],params={'alt':'media'},
                                  headers={'Range':f'bytes={offset}-'} if offset else {},stream=True)
            if offset and response.status_code!=206:offset=0
            with part.open('ab' if offset else 'wb') as out:
                for chunk in response.iter_content(8*1024*1024):out.write(chunk)
            with part.open('rb') as incoming:valid=hashlib.file_digest(incoming,'sha256').hexdigest()==entry['sha256']
            if valid and part.stat().st_size==entry['bytes']:part.replace(path);return True
            part.unlink(missing_ok=True)
        return False

    def store(self, entry, path):
        path=Path(path)
        if any(int(item.get('size',-1))==entry['bytes'] for item in self.lookup(entry['sha256'])):return
        response=self.request('POST','https://www.googleapis.com/upload/drive/v3/files',params={'uploadType':'resumable'},
            headers={'X-Upload-Content-Type':'application/octet-stream','X-Upload-Content-Length':str(entry['bytes'])},
            json={'name':path.name,'appProperties':{'fmworker_sha256':entry['sha256'],'application':'fmWorker'}})
        url=response.headers['Location']
        if not url.startswith('https://www.googleapis.com/'):raise RuntimeError('Drive 上传地址无效')
        size=entry['bytes'];offset=0;chunk_size=8*1024*1024
        with path.open('rb') as source:
            while offset<size:
                chunk=source.read(chunk_size)
                if not chunk:raise RuntimeError('模型缓存文件不完整')
                result=requests.put(url,data=chunk,headers=self.headers()|{'Content-Length':str(len(chunk)),
                    'Content-Range':f'bytes {offset}-{offset+len(chunk)-1}/{size}'},timeout=120)
                if result.status_code not in (200,201,308):result.raise_for_status()
                offset+=len(chunk)
