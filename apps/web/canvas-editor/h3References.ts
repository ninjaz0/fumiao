import type { Asset, CanvasNode, Doc, H3Options } from "./types";

export function portableReferences(
  document: Doc,
  targetId: string,
  assets: Asset[],
  resolveMedia: (node: CanvasNode) => string | null,
): Doc {
  const target = document.nodes.find((node) => node.id === targetId);
  if (!target?.params.model || target.params.model === "MiniMax H3")
    return document;

  const params = target.params;
  const frames = params.h3;
  const ids = new Set([
    ...(params.h3_refs || []),
    ...(frames?.mode === "frames"
      ? [frames.first_frame, frames.last_frame]
      : []),
  ]);
  const images = [...ids].filter(
    (id): id is string =>
      !!id && assets.some((asset) => asset.id === id && asset.kind === "ref"),
  );
  if (!images.length) return document;

  const nodes = [...document.nodes];
  const edges = [...document.edges];
  for (const [index, id] of images.entries()) {
    let source = nodes.find(
      (node) =>
        node.id !== targetId && node.type === "image" && resolveMedia(node) === id,
    );
    if (!source) {
      source = {
        ...target,
        id: crypto.randomUUID(),
        type: "image",
        title: "参考图片",
        prompt: "",
        media_id: id,
        active_job: null,
        asset_packs: [],
        params: { ...params, model: "muse-image", h3: null, h3_refs: [] },
        x: target.x - 300,
        y: target.y + index * 80,
      };
      nodes.push(source);
    }
    const sourceId = source.id;
    if (!edges.some((edge) => edge.target === targetId && edge.source === sourceId)) {
      edges.push({ id: crypto.randomUUID(), source: sourceId, target: targetId });
    }
  }
  const updatedParams: CanvasNode["params"] = {
    ...params,
    h3_refs: (params.h3_refs || []).filter((id) => !images.includes(id)),
    h3: frames
      ? {
          ...frames,
          first_frame:
            frames.first_frame && images.includes(frames.first_frame)
              ? null
              : frames.first_frame,
          last_frame:
            frames.last_frame && images.includes(frames.last_frame)
              ? null
              : frames.last_frame,
        }
      : null,
  };
  return {
    ...document,
    edges,
    nodes: nodes.map((node) =>
      node.id === targetId ? { ...node, params: updatedParams } : node,
    ),
  };
}

export const h3MediaType=(id:string,assets:Asset[])=>assets.find(a=>a.id===id)?.kind==='ref_video'?'Video':assets.find(a=>a.id===id)?.kind==='ref_audio'?'Audio':'Picture';
export function h3TokenKey(type:string,index:number,ids:string[],assets:Asset[]) {return ids.filter(k=>h3MediaType(k,assets)===type)[index-1];}
export function remapH3Prompt(prompt:string,before:string[],after:string[],assets:Asset[],frames?:H3Options) {
 return prompt.replace(/<(Picture|Video|Audio) (\d+)>/g,(_,type,n)=>{
  const key=h3TokenKey(type,Number(n),before,assets);if(!key)return '';
  if(frames?.mode==='frames')return key===frames.first_frame&&key===frames.last_frame?'首尾帧':key===frames.first_frame?'首帧':key===frames.last_frame?'尾帧':'';
  const index=after.filter(k=>h3MediaType(k,assets)===type).indexOf(key);return index<0?'':`<${type} ${index+1}>`;
 });
}
export function frameAspectMatches(a?:{w:number;h:number},b?:{w:number;h:number}) {return !a||!b||Math.abs(Math.log((a.w/a.h)/(b.w/b.h)))<=.035;}
