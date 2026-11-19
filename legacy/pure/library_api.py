"""Private favorites over shared assets, and atomic permission-aware bulk deletion."""
import re
import io
import json
import zipfile
from contextlib import ExitStack, closing
from urllib.parse import quote
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from core import actor, db, fail, now, store, token, hashed, protect_canvas_media

from workspace_access import active_workspace, require_resource

router = APIRouter()


class AssetKeys(BaseModel):
    keys: list[str] = Field(min_length=1, max_length=200)


class FavoriteChange(AssetKeys):
    favorite: bool


def favorite_keys(con, uid, workspace=None):
    return [
        f'job:{row["job"]}' if row["job"] is not None else f'asset:{row["media"]}'
        for row in con.execute("""SELECT f.job,f.media FROM favorites f
            LEFT JOIN jobs j ON j.id=f.job LEFT JOIN media m ON m.id=f.media
            WHERE f.user=? AND coalesce(j.workspace,m.workspace)=?
            ORDER BY f.created DESC,f.id DESC""", (uid,workspace))
    ]


def resolve(con, key):
    if re.fullmatch(r"job:[1-9][0-9]{0,15}", key):
        return "job", con.execute("SELECT * FROM jobs WHERE id=?", (int(key[4:]),)).fetchone()
    if re.fullmatch(r"asset:[0-9a-f]{32}", key):
        # Generated images have one canonical entry, even if selected as references.
        job = con.execute("SELECT * FROM jobs WHERE result=?", (key[6:],)).fetchone()
        if job:
            return "job", job
        return "asset", con.execute("SELECT * FROM media WHERE id=? AND kind IN ('ref','ref_video','ref_audio')", (key[6:],)).fetchone()
    fail(400, "资产标识无效")


def archive_entry(media, name):
    extension = {"audio/wav": "wav", "video/mp4": "mp4", "video/webm": "webm",
                 "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}.get(media["mime"])
    if not extension:
        fail(400, "不支持下载此文件类型")
    return {"key": media["id"], "size": media["size"], "name": f"{name}.{extension}"}


def archive_ticket(con, user, manifest):
    secret = token()
    con.execute("DELETE FROM downloads WHERE expires<=?", (now(),))
    con.execute("INSERT INTO downloads VALUES(?,?,?,?)", (hashed(secret), user["id"], json.dumps(manifest), now()+900))
    filename = archive_filename(manifest)
    return {"url": "/api/downloads/" + secret, "filename": filename}


def archive_filename(manifest):
    kind = "镜头" if all(entry["name"].startswith("镜头-") for entry in manifest) else "资产"
    return f"弗淼-{kind}-{len(manifest)}项.zip"


@router.put("/api/favorites")
def change_favorites(body: FavoriteChange, request: Request):
    user = actor(request)
    with db(True) as con:
        workspace=active_workspace(con,user,request)
        for key in dict.fromkeys(body.keys):
            kind, row = resolve(con, key)
            if row is None:
                if body.favorite:
                    fail(404, "部分资产已删除，请刷新后重试")
                continue
            require_resource(con,user,row,workspace)
            if kind == "job" and body.favorite and (row["status"] != "done" or not row["result"]):
                fail(409, "只有已完成的作品可以收藏")
            column = "job" if kind == "job" else "media"
            if body.favorite:
                con.execute(f"INSERT OR IGNORE INTO favorites(user,{column},created) VALUES(?,?,?)", (user["id"], row["id"], now()))
            else:
                con.execute(f"DELETE FROM favorites WHERE user=? AND {column}=?", (user["id"], row["id"]))
        return {"favorites": favorite_keys(con, user["id"],workspace)}


@router.post("/api/assets/batch-delete")
def batch_delete(body: AssetKeys, request: Request):
    user = actor(request)
    jobs = {}
    media = set()
    entries = set()
    with db(True) as con:
        workspace=active_workspace(con,user,request)
        for key in dict.fromkeys(body.keys):
            kind, row = resolve(con, key)
            if row is None:
                continue
            require_resource(con,user,row,workspace)
            if user["role"] != "admin" and row["owner"] != user["id"]:
                fail(403, "所选内容包含其他成员的资产，只有管理员可以删除")
            if kind == "job":
                if row["status"] in ("queued", "running"):
                    fail(409, "所选内容包含未完成任务，请先取消或等待生成结束")
                jobs[row["id"]] = row
                if row["result"]:
                    media.add(row["result"])
            else:
                media.add(row["id"])
            entries.add((kind, row["id"]))
        job_ids = list(jobs)
        # References held only by other selected jobs may be deleted together.
        placeholders = ",".join("?" for _ in job_ids)
        exclude_selected = f"id NOT IN ({placeholders}) AND " if job_ids else ""
        for key in media:
            protect_canvas_media(con, key)
            used = con.execute(
                f"SELECT 1 FROM jobs WHERE {exclude_selected}(result=? OR EXISTS(SELECT 1 FROM json_each(jobs.refs) r WHERE r.value=?)) LIMIT 1",
                (*job_ids, key, key),
            ).fetchone()
            if used:
                fail(409, "所选素材仍被其他作品或任务引用，请先移除相关版本；本次未删除任何内容")
        con.executemany("DELETE FROM jobs WHERE id=?", [(i,) for i in job_ids])
        con.executemany("DELETE FROM media WHERE id=?", [(key,) for key in media])
    for key in media:
        store.delete(key)
    return {"deleted": len(entries)}


@router.post("/api/assets/batch-download")
def prepare_download(body: AssetKeys, request: Request):
    user = actor(request)
    manifest = []
    seen = set()
    with db(True) as con:
        workspace=active_workspace(con,user,request)
        for key in dict.fromkeys(body.keys):
            kind, row = resolve(con, key)
            if row is None:
                fail(404, "部分资产已删除，请刷新后重试")
            require_resource(con,user,row,workspace)
            if kind == "job":
                if row["status"] != "done" or not row["result"]:
                    fail(409, "所选内容包含未生成完成的作品，暂时无法下载")
                media = con.execute("SELECT * FROM media WHERE id=?", (row["result"],)).fetchone()
                identity = str(row["id"])
                label = {'video':'视频','image':'图片','audio':'语音'}.get(row['kind'],'作品')
            else:
                media, identity, label = row, row["id"][:12], "素材"
            if not media:
                fail(404, "部分文件已不存在，请刷新后重试")
            if media["id"] in seen:
                continue
            seen.add(media["id"])
            manifest.append(archive_entry(media, f"{len(manifest)+1:03d}-{label}-{identity}"))
        return archive_ticket(con, user, manifest)


class ZipSink(io.RawIOBase):
    """Non-seekable output: let ZipFile emit data descriptors as files arrive."""
    def __init__(self):
        self.offset = 0
        self.chunks = []

    def writable(self):
        return True

    def seekable(self):
        return False

    def tell(self):
        return self.offset

    def write(self, chunk):
        self.offset += len(chunk)
        if chunk:
            self.chunks.append(chunk)
        return len(chunk)

    def drain(self):
        chunks, self.chunks = self.chunks, []
        return chunks


def zip_stream(manifest, streams, resources):
    sink = ZipSink()
    try:
        with zipfile.ZipFile(sink, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
            for entry, source in zip(manifest, streams):
                info = zipfile.ZipInfo(entry["name"])
                info.file_size = entry["size"]
                info.external_attr = 0o600 << 16
                with archive.open(info, "w", force_zip64=True) as target:
                    yield from sink.drain()
                    size = 0
                    while chunk := source.read(256 * 1024):
                        size += len(chunk)
                        if size > entry["size"]:
                            raise OSError("Download source size changed")
                        target.write(chunk)
                        yield from sink.drain()
                    if size != entry["size"]:
                        raise OSError("Download source is incomplete")
                yield from sink.drain()
        yield from sink.drain()
    finally:
        resources.close()


class ArchiveResponse(StreamingResponse):
    def __init__(self, content, resources, **kwargs):
        self.resources = resources
        super().__init__(content, **kwargs)

    async def __call__(self, scope, receive, send):
        try:
            await super().__call__(scope, receive, send)
        finally:
            # Also covers a disconnect before the generator's first iteration.
            self.resources.close()


@router.get("/api/downloads/{secret}")
def download_archive(secret: str, request: Request):
    user = actor(request)
    with db() as con:
        ticket = con.execute("SELECT * FROM downloads WHERE key=? AND expires>?", (hashed(secret), now())).fetchone()
        if not ticket:
            fail(410, "下载链接已过期，请重新选择下载")
        if ticket["user"] != user["id"]:
            fail(403, "下载链接不属于当前账户")
        manifest = json.loads(ticket["manifest"])
        for entry in manifest:
            require_resource(con,user,con.execute("SELECT * FROM media WHERE id=?",(entry["key"],)).fetchone())
    resources = ExitStack()
    try:
        # Open before returning headers. Local file handles survive concurrent deletion.
        streams = [resources.enter_context(closing(store.open(entry["key"]))) for entry in manifest]
    except Exception:
        resources.close()
        fail(404, "部分文件暂时无法读取，请重新选择下载")
    return ArchiveResponse(
        zip_stream(manifest, streams, resources),
        resources,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename*=UTF-8''" + quote(archive_filename(manifest)), "X-Accel-Buffering": "no"},
    )
