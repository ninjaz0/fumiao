import type {Asset,H3Options} from './types';
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
