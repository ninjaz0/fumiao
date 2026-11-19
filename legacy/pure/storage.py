"""Private media adapters. A media ID is also its object key on both backends."""

import os
import re
from fastapi import HTTPException
from fastapi.responses import FileResponse, RedirectResponse


class DiskStore:
    def __init__(self, root):
        self.root = root
        root.mkdir(exist_ok=True)

    def path(self, key):
        if not re.fullmatch("[0-9a-f]{32}", key):
            raise HTTPException(404, "文件不存在")
        return self.root / key

    def put(self, staged, key):
        os.replace(staged, self.path(key))

    def read(self, key):
        return self.path(key).read_bytes()

    def open(self, key):
        return self.path(key).open("rb")

    def delete(self, key):
        self.path(key).unlink(missing_ok=True)

    def serve(self, key, mime, filename=None):
        return FileResponse(self.path(key), media_type=mime, filename=filename)


class COSStore:
    """Optional private bucket; credentials are loaded only when explicitly selected."""

    def __init__(self):
        from qcloud_cos import CosConfig, CosS3Client

        self.bucket = os.environ["FUMIAO_COS_BUCKET"]
        self.region = os.environ["FUMIAO_COS_REGION"]
        self.origin = f"https://{self.bucket}.cos.{self.region}.myqcloud.com"
        conf = CosConfig(
            Region=self.region,
            SecretId=os.environ["FUMIAO_COS_ID"],
            SecretKey=os.environ["FUMIAO_COS_KEY"],
            Scheme="https",
        )
        self.client = CosS3Client(conf)

    def put(self, staged, key):
        self.client.upload_file(
            Bucket=self.bucket, LocalFilePath=str(staged), Key="studio/" + key
        )

    def delete(self, key):
        self.client.delete_object(Bucket=self.bucket, Key="studio/" + key)

    def read(self, key):
        response = self.client.get_object(Bucket=self.bucket, Key="studio/" + key)
        return response["Body"].get_raw_stream().read()

    def open(self, key):
        response = self.client.get_object(Bucket=self.bucket, Key="studio/" + key)
        return response["Body"].get_raw_stream()

    def serve(self, key, mime, filename=None):
        params = {"response-content-type": mime}
        if filename:
            from urllib.parse import quote

            params["response-content-disposition"] = (
                "attachment; filename*=UTF-8''" + quote(filename)
            )
        url = self.client.get_presigned_url(
            Method="GET",
            Bucket=self.bucket,
            Key="studio/" + key,
            Expired=300,
            Params=params,
        )
        return RedirectResponse(url, status_code=307)
