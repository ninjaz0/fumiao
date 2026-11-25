export function groupHistoryJobs<T extends { created: number }>(
  jobs: readonly T[],
  now = new Date(),
) {
  const groups: { day: string; key: string; label: string; jobs: T[] }[] = [];
  const segments = new Map<string, number>();
  const today = now.toDateString();
  const currentYear = now.getFullYear();
  for (const job of jobs) {
    const date = new Date(job.created * 1000);
    const day = date.toDateString();
    const previous = groups.at(-1);
    if (previous?.day === day) {
      previous.jobs.push(job);
      continue;
    }
    const year = date.getFullYear();
    const monthDay = `${date.getMonth() + 1}月${date.getDate()}日`;
    const label =
      day === today
        ? "今天"
        : year === currentYear
          ? monthDay
          : `${year}年${monthDay}`;
    // Imported jobs may interleave dates when ordered by public ID.
    const segment = segments.get(day) ?? 0;
    segments.set(day, segment + 1);
    groups.push({ day, key: day + ":" + segment, label, jobs: [job] });
  }
  return groups;
}
