import { headers } from "next/headers";
import { originalUI } from "../../../packages/web-compat/src/ui";
import { initializeHomepage } from "../home/bootstrap";
import { homepageMember } from "../home/session";
export const metadata = {
  title: "弗淼 AIGC · 多模型创作工作台",
  description:
    "弗淼 AIGC 是面向个人与团队的多模型创作工作台：在同一个网站里完成分镜、素材、视频与图片生成、旁白和成片。",
};
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f8f9fa",
};
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const requestHeaders = await headers();
  const home = requestHeaders.get("x-fumiao-home") === "1";
  const auth = requestHeaders.get("x-fumiao-auth") === "1";
  const canvas = requestHeaders.get("x-fumiao-canvas") === "1";
  const editor = requestHeaders.get("x-fumiao-canvas-editor") === "1";
  const studio = requestHeaders.get("x-fumiao-studio") === "1";
  const canvasPage = canvas || editor;
  const syncThemeColor = canvasPage || studio;
  const ui = originalUI();
  const member = home && (await homepageMember());
  return (
    <html
      lang="zh-CN"
      data-session={home ? (member ? "member" : "guest") : undefined}
      suppressHydrationWarning
    >
      <head>
        <link
          rel="icon"
          href={`/static/mark.svg?v=${await ui.version("mark.svg")}`}
        />
        {syncThemeColor && (
          <noscript
            dangerouslySetInnerHTML={{
              __html: `<meta name="theme-color" content="${canvasPage ? "#f5f5f5" : "#f8f9fa"}">`,
            }}
          />
        )}
        {(home || auth || syncThemeColor) && (
          <script
            nonce={requestHeaders.get("x-nonce") || undefined}
            dangerouslySetInnerHTML={{
              __html: `(${initializeHomepage.toString()})(${JSON.stringify({ homepage: home, syncThemeColor })});`,
            }}
          />
        )}
        {canvasPage && (
          <link
            rel="stylesheet"
            href={`/static/canvas.css?v=${await ui.version("canvas.css")}`}
          />
        )}
        {(home || auth || studio) && (
          <>
            {(auth || studio) && (
              <link
                rel="stylesheet"
                href={`/static/chat.css?v=${await ui.version("chat.css")}`}
                data-chat-style=""
              />
            )}
            <link
              rel="stylesheet"
              href={`/static/${home ? "home" : "studio"}.css?v=${await ui.version(home ? "home.css" : "studio.css")}`}
            />
          </>
        )}
      </head>
      <body>{children}</body>
    </html>
  );
}
