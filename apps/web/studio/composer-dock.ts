/**
 * One-line notice for the collapsed phone composer, in priority order: a
 * reason that blocks sending, the stashed-draft reminder, then progress.
 * `status` already carries the credit shortfall from `composerFeedback`.
 */
export function dockNotice(input: {
  status: string;
  busy: boolean;
  canRestoreDraft: boolean;
}): string {
  const { status, busy, canRestoreDraft } = input;
  if (status && !busy) return status;
  if (canRestoreDraft) return "原草稿已暂存，点按恢复";
  if (status && busy) return status;
  return "";
}
