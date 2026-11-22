export function chatFreshness() {
  const revisions = new Map<string, number>();
  return (conversation: { id: string; revision: number }) => {
    const previous = revisions.get(conversation.id);
    if (previous !== undefined && conversation.revision < previous) return false;
    revisions.set(conversation.id, conversation.revision);
    return true;
  };
}
