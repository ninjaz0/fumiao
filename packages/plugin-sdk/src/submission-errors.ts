import type { OriginalDraft, OriginalTask, OriginalPlan } from "./original.js";
export class OriginalSubmissionError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 429 | 503 = 400,
  ) {
    super(message);
  }
}

export function originalParent(
  draft: OriginalDraft,
  parent: OriginalTask | undefined,
  kind: OriginalPlan["parentKind"],
) {
  if (draft.parent && (!parent || (kind !== "any" && parent.kind !== kind)))
    throw new OriginalSubmissionError("内容不存在或无权访问", 404);
}

export class InputPreparationError extends Error {}
