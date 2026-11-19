import { headers } from "next/headers";
import { notFound } from "next/navigation";
import CanvasList from "../../canvas/CanvasList";
import { originalUI } from "../../../../packages/web-compat/src/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "画布 · 弗淼 AIGC", description: null };
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // The canvas pre-paint script sets the theme color from local appearance.
  themeColor: null,
};

export default async function Page() {
  if ((await headers()).get("x-fumiao-canvas") !== "1") notFound();
  return (
    <CanvasList
      loadingLogo={`/static/mark.svg?v=${await originalUI().version("mark.svg")}`}
    />
  );
}
