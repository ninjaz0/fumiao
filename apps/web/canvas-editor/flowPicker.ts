/** One model name in the picker; concrete variant IDs remain on jobs. */
type Spec = {label:string;provider?:string;family?:string;family_label?:string;mode?:string;ratio?:string;seconds?:number;hidden?:boolean};
type Catalog = Record<string,Spec>;
type Available = (model:string)=>boolean;
type Preferences = {ratio?:string;seconds?:number;mode?:string};
export const modeLabels:Record<string,string> = {t2v:'文生视频',i2v:'图生视频',r2v:'参考图视频',extend:'视频续写',omni:'自动'};

export function family(catalog:Catalog, model:string):string {
  return catalog[model]?.family || model;
}
export function label(catalog:Catalog, model:string):string {
  return catalog[model]?.family_label || catalog[model]?.label || model;
}
export function sameFamily(catalog:Catalog, a:string, b:string):boolean {
  return family(catalog,a)===family(catalog,b);
}
function variants(catalog:Catalog, model:string, available:Available):[string,Spec][] {
  return Object.entries(catalog).filter(([id,spec])=>sameFamily(catalog,id,model)&&!spec.hidden&&available(id));
}
export function resolve(catalog:Catalog, model:string, available:Available, want:Preferences={}):string {
  if (!catalog[model]?.family) return available(model)?model:'';
  let pool=variants(catalog,model,available);
  if (!pool.length) return '';
  const modes=[...new Set(pool.map(([,spec])=>spec.mode))];
  const preferredMode=want.mode || catalog[model]?.mode;
  const mode=modes.includes(preferredMode)?preferredMode:['t2v','omni','i2v','r2v','extend'].find(m=>modes.includes(m));
  pool=pool.filter(([,spec])=>spec.mode===mode);
  const ratios=[...new Set(pool.map(([,spec])=>spec.ratio))];
  const ratio=ratios.includes(want.ratio)?want.ratio:ratios.includes('16:9')?'16:9':ratios[0];
  pool=pool.filter(([,spec])=>spec.ratio===ratio);
  const seconds=Number.isFinite(want.seconds)?Number(want.seconds):8;
  pool.sort(([a,sa],[b,sb])=>Math.abs(Number(sa.seconds)-seconds)-Math.abs(Number(sb.seconds)-seconds)
    || Number(sa.seconds)-Number(sb.seconds) || Number(a===family(catalog,a))-Number(b===family(catalog,b)) || a.localeCompare(b));
  return pool[0]?.[0] || '';
}
export function options(catalog:Catalog, model:string, available:Available) {
  const pool=variants(catalog,model,available), current=catalog[model];
  const modes=[...new Set(pool.map(([,spec])=>spec.mode).filter((m):m is string=>Boolean(m)))];
  const inMode=pool.filter(([,spec])=>spec.mode===current?.mode);
  const ratios=[...new Set(inMode.map(([,spec])=>spec.ratio).filter((r):r is string=>Boolean(r)))];
  const seconds=[...new Set(inMode.filter(([,spec])=>spec.ratio===current?.ratio).map(([,spec])=>Number(spec.seconds)))].sort((a,b)=>a-b);
  return {modes,ratios,seconds};
}
export function grouped(models:Record<string,string>, catalog:Catalog, available:Available, current:string, want:Preferences={}):[string,string][] {
  const seen=new Set<string>(), result:[string,string][]=[];
  for (const [id,title] of Object.entries(models)) {
    if(!available(id)||catalog[id]?.hidden)continue;
    const key=family(catalog,id);
    if(seen.has(key))continue;
    seen.add(key);
    const model=resolve(catalog,id,available,{...want,mode:sameFamily(catalog,id,current)?catalog[current]?.mode:undefined});
    if(model)result.push([model,catalog[id]?.family?label(catalog,id):title]);
  }
  return result;
}
