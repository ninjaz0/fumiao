import type { ViewBlock, ViewLeaf } from "./contributions.js";

export function viewLeaves(blocks: readonly ViewBlock[]): ViewLeaf[] {
  return blocks.flatMap((block) =>
    block.type === "tabs" ? block.tabs.flatMap((tab) => tab.blocks) : [block],
  );
}
