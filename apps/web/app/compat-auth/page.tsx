import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Auth from "../../auth/Auth";
import { originalUI } from "../../../../packages/web-compat/src/ui";
export const dynamic = "force-dynamic";
export const metadata = { title: "弗淼 AIGC 工作台", description: null };
export default async function Page() {
  if ((await headers()).get("x-fumiao-auth") !== "1") notFound();
  return (
    <Auth
      loadingLogo={`/static/mark.svg?v=${await originalUI().version("mark.svg")}`}
    />
  );
}
