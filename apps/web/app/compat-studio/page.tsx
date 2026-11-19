import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { originalUI } from "../../../../packages/web-compat/src/ui";
import Studio from "../../studio/Studio";

export const dynamic = "force-dynamic";
export const metadata = { title: "弗淼 AIGC 工作台", description: null };
export const viewport = { themeColor: null };

export default async function Page() {
  if ((await headers()).get("x-fumiao-studio") !== "1") notFound();
  return (
    <Studio
      loadingLogo={`/static/mark.svg?v=${await originalUI().version("mark.svg")}`}
    />
  );
}
