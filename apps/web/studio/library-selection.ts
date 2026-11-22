import { MAX_ASSET_SELECTION } from "../../../packages/original-api/src/asset-limits";

export function allAssetsSelected(keys: string[], visible: string[]) {
  const count = visible.filter((key) => keys.includes(key)).length;
  return count > 0 && count >= Math.min(visible.length, MAX_ASSET_SELECTION);
}

export function selectAllAssets(keys: string[], visible: string[]) {
  return allAssetsSelected(keys, visible)
    ? keys.filter((key) => !visible.includes(key))
    : [...new Set([...keys, ...visible])].slice(0, MAX_ASSET_SELECTION);
}
