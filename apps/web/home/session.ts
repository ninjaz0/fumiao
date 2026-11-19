import { headers } from "next/headers";
import { originalBackend } from "../proxy-backend";

export async function homepageMember() {
  const cookie = (await headers()).get("cookie");
  if (!cookie) return false;
  try {
    const response = await fetch(
      new URL("/api/workspaces", originalBackend()),
      {
        headers: { cookie },
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(3000),
      },
    );
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}
