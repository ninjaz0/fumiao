export function groupHistoryJobs<T extends { created: number }>(
  jobs: readonly T[],
  now = new Date(),
) {
  const groups = new Map<string, { day: string; label: string; jobs: T[] }>();
  const today = now.toDateString();
  const currentYear = now.getFullYear();
  for (const job of jobs) {
    const date = new Date(job.created * 1000);
    const day = date.toDateString();
    const group = groups.get(day);
    if (group) {
      group.jobs.push(job);
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
    groups.set(day, { day, label, jobs: [job] });
  }
  return [...groups.values()];
}
