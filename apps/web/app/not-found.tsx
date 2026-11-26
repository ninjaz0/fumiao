import { headers } from "next/headers";
import { originalUI } from "@fumiao/web-compat/ui";
import "./not-found.css";

function syncNotFoundTheme() {
  const storageKey = "fumiao-appearance";
  const apply = (value: string | null) => {
    if (value === "dark" || value === "light") {
      document.documentElement.dataset.theme = value;
    } else {
      delete document.documentElement.dataset.theme;
    }
  };
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === "dark" || saved === "light") apply(saved);
  } catch {}
  window.addEventListener("storage", (event) => {
    if (event.key === storageKey || event.key === null) apply(event.newValue);
  });
}

export default async function NotFound() {
  const requestHeaders = await headers();
  const nonce = requestHeaders.get("x-nonce") || undefined;
  const logo = `/static/mark.svg?v=${await originalUI().version("mark.svg")}`;

  return (
    <div className="not-found-shell">
      <script
        nonce={nonce}
        dangerouslySetInnerHTML={{
          __html: `(${syncNotFoundTheme.toString()})();`,
        }}
      />
      <a className="nf-skip" href="#main">
        跳到主要内容
      </a>
      <header className="nf-top">
        <div className="nf-wrap nf-top-row">
          <a className="nf-brand" href="/" aria-label="弗淼 AIGC 首页">
            <img src={logo} width="28" height="28" alt="" />
            <span>
              弗淼 <b>AIGC</b>
            </span>
          </a>
        </div>
      </header>
      <main id="main" className="nf-main" tabIndex={-1}>
        <section className="nf-card" aria-labelledby="nf-title">
          <svg
            className="nf-ribbon"
            viewBox="0 0 480 260"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
            focusable="false"
          >
            <defs>
              <linearGradient id="nf-thread">
                <stop offset="0" className="nf-thread-a" />
                <stop offset="0.5" className="nf-thread-b" />
                <stop offset="1" className="nf-thread-c" />
              </linearGradient>
            </defs>
            <g stroke="url(#nf-thread)" fill="none" strokeWidth="1.2">
              {Array.from({ length: 34 }, (_, i) => (
                <path
                  key={i}
                  d={`M-40 ${145 + i * 2.3} C 75 ${78 + i * 3}, 145 ${225 - i * 2}, 255 ${128 - i * 1.3} S 405 ${38 + i * 2.2}, 530 ${56 + i * 2.4}`}
                />
              ))}
            </g>
          </svg>
          <div className="nf-content">
            <p className="nf-badge">
              <span className="nf-code">404</span>
              <span className="nf-badge-sep" aria-hidden="true">
                ·
              </span>
              <span>未找到页面</span>
            </p>
            <h1 id="nf-title" className="nf-title">
              页面不存在
            </h1>
            <p className="nf-lead">
              你访问的页面不存在或链接已失效。如需登录、注册或继续创作，请进入工作台或返回首页。
            </p>
            <nav className="nf-actions" aria-label="页面导航">
              <a className="nf-button nf-button-primary" href="/studio">
                进入工作台
                <svg
                  className="nf-icon"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path d="M5 12h14m-6-6 6 6-6 6" />
                </svg>
              </a>
              <a className="nf-button nf-button-secondary" href="/">
                返回首页
              </a>
            </nav>
          </div>
        </section>
      </main>
    </div>
  );
}
