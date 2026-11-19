import { workspaceURL as canvasURL } from "../canvas/api";

let workspaceId: string | null = null;
export function initializeWorkspace() {
  workspaceId = new URLSearchParams(location.search).get("workspace");
}
export function setWorkspace(id: number) {
  workspaceId = String(id);
  const url = new URL(location.href); url.searchParams.set("workspace", workspaceId);
  history.replaceState(null, "", url);
}
export function workspaceURL(path: string) {
  return canvasURL(path, workspaceId);
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(workspaceId ? {"X-Workspace-Id": workspaceId} : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      typeof value.detail === "string" ? value.detail : "请求未完成，请重试",
      response.status,
    );
  return value;
}
export function upload(
  file: File,
  onProgress: (n: number) => void,
  source?: {media: string; seconds: number},
): Promise<{ id: string; w: number; h: number; first_frame?:boolean; resized?:boolean }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/assets");
    xhr.withCredentials = true;
    if(source){xhr.setRequestHeader("X-Frame-Source",source.media);xhr.setRequestHeader("X-Frame-Time",String(source.seconds));}
    if (workspaceId) xhr.setRequestHeader("X-Workspace-Id",workspaceId);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        reject(new Error("上传失败"));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(body.detail || "上传失败"));
    };
    xhr.onerror = () => reject(new Error("上传中断，请重试"));
    xhr.send(file);
  });
}
export function downloadJSON(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function uploadH3(file:File):Promise<any> {
  const kind=file.type.startsWith('video/')?'video':file.type.startsWith('audio/')?'audio':'image';
  const response=await fetch(kind==='image'?'/api/assets':'/api/h3/references?kind='+kind,{method:'POST',credentials:'same-origin',headers:{...(workspaceId?{'X-Workspace-Id':workspaceId}:{}),'X-File-Name':encodeURIComponent(file.name)},body:file});
  const result=await response.json();if(!response.ok)throw new Error(typeof result.detail==='string'?result.detail:'上传失败，请重试');return result;
}
