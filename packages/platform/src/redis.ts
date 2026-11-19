import type { RedisOptions } from "bullmq";

export function redisConnection(value: string): RedisOptions {
  try {
    const url = new URL(value);
    if (
      !["redis:", "rediss:"].includes(url.protocol) ||
      !url.hostname ||
      !/^\/?\d*$/.test(url.pathname) ||
      url.search ||
      url.hash
    )
      throw new Error();
    return {
      host: url.hostname.replace(/^\[|\]$/g, ""),
      port: Number(url.port || 6379),
      username: decodeURIComponent(url.username) || undefined,
      password: decodeURIComponent(url.password) || undefined,
      db: Number(url.pathname.slice(1) || 0),
      ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    };
  } catch {
    throw new Error(
      "Set REDIS_URL to a valid redis:// or rediss:// URL with an optional database number",
    );
  }
}
