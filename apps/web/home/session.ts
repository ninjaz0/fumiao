import { headers } from "next/headers";
import { backend } from "../proxy-backend";

export async function homepageMember() {
  const cookie = (await headers()).get("cookie");
  if (!cookie) return false;
  try {
    const response = await fetch(
      new URL("/api/workspaces", backend()),
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
