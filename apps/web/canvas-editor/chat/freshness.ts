type Version = { id: string; revision: number };

export function chatFreshness() {
  const revisions = new Map<string, { revision: number; deleted: boolean; epoch: number }>();
  let epoch = 0;
  const record = (conversation: Version, deleted: boolean) => {
    const previous = revisions.get(conversation.id);
    if (previous && (conversation.revision < previous.revision ||
      (conversation.revision === previous.revision && previous.deleted && !deleted))) return false;
    revisions.set(conversation.id, { revision: conversation.revision, deleted, epoch: ++epoch });
    return true;
  };
  const accept = (conversation: Version) => record(conversation, false);
  return Object.assign(accept, {
    remove: (conversation: Version) => record(conversation, true),
    startList: () => epoch,
    reconcile<T extends Version & { updated: number }>(incoming: T[], current: T[], started: number): T[] {
      const existing = new Map(current.map(item => [item.id, item]));
      const result: T[] = [];
      for (const item of incoming) {
        if (accept(item)) result.push(item);
        else {
          const previous = existing.get(item.id);
          if (previous && !revisions.get(item.id)?.deleted) result.push(previous);
        }
        existing.delete(item.id);
      }
      for (const item of existing.values()) {
        const known = revisions.get(item.id);
        if (known && !known.deleted && known.epoch > started) result.push(item);
      }
      return result.sort((a, b) => b.updated - a.updated);
    },
  });
}
