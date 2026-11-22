import type { Viewport } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { originalUI } from "@fumiao/web-compat/ui";
import CanvasEditor from "../../canvas-editor/CanvasEditor";

export const dynamic = "force-dynamic";
export const metadata = { title: "画布 · 弗淼 AIGC", description: null };
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: null, // The shared canvas bootstrap supplies the theme color.
};

export default async function Page() {
  if ((await headers()).get("x-fumiao-canvas-editor") !== "1") notFound();
  return (
    <CanvasEditor
      loadingLogo={`/static/mark.svg?v=${await originalUI().version("mark.svg")}`}
    />
  );
}
