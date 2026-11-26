const NOT_FOUND_STYLES = `
html:has(.fm-not-found),
body:has(.fm-not-found) {
  margin: 0;
  padding: 0;
}
.fm-not-found {
  --fm-bg: #f8f9fa;
  --fm-surface: #ffffff;
  --fm-text: #09090b;
  --fm-secondary: #52525b;
  --fm-muted: #71717a;
  --fm-line: #e4e4e7;
  --fm-blue: #3686ad;
  --fm-blue-hover: #2d7396;
  --fm-accent-soft: rgba(54, 134, 173, 0.12);
  --fm-btn-fg: #ffffff;
  --fm-shadow: 0 1px 3px rgba(9, 9, 11, 0.06);
  min-height: 100dvh;
  box-sizing: border-box;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--fm-bg);
  color: var(--fm-text);
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .fm-not-found {
    --fm-bg: #111111;
    --fm-surface: #1e1e1e;
    --fm-text: #f4f5f7;
    --fm-secondary: #a1a8b3;
    --fm-muted: #959daa;
    --fm-line: rgba(255, 255, 255, 0.09);
    --fm-blue: #68a8db;
    --fm-blue-hover: #7bb5e3;
    --fm-accent-soft: rgba(104, 168, 219, 0.15);
    --fm-btn-fg: #0b141c;
    --fm-shadow: 0 8px 24px rgba(0, 0, 0, 0.36);
  }
}
[data-theme="dark"] .fm-not-found {
  --fm-bg: #111111;
  --fm-surface: #1e1e1e;
  --fm-text: #f4f5f7;
  --fm-secondary: #a1a8b3;
  --fm-muted: #959daa;
  --fm-line: rgba(255, 255, 255, 0.09);
  --fm-blue: #68a8db;
  --fm-blue-hover: #7bb5e3;
  --fm-accent-soft: rgba(104, 168, 219, 0.15);
  --fm-btn-fg: #0b141c;
  --fm-shadow: 0 8px 24px rgba(0, 0, 0, 0.36);
}
.fm-not-found-card {
  width: 100%;
  max-width: 420px;
  box-sizing: border-box;
  padding: 28px 26px;
  border-radius: 12px;
  border: 1px solid var(--fm-line);
  background: var(--fm-surface);
  box-shadow: var(--fm-shadow);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.fm-not-found-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.fm-not-found-brand {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  font-size: 14px;
  font-weight: 600;
  color: var(--fm-text);
}
.fm-not-found-code {
  display: inline-flex;
  align-items: center;
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--fm-accent-soft);
  color: var(--fm-blue);
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.fm-not-found-card h1 {
  margin: 2px 0 0;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--fm-text);
}
.fm-not-found-card p {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--fm-secondary);
}
.fm-not-found-actions {
  margin-top: 6px;
  display: flex;
  align-items: center;
}
.fm-not-found-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  padding: 0 16px;
  border-radius: 8px;
  background: var(--fm-blue);
  color: var(--fm-btn-fg);
  font-size: 13.5px;
  font-weight: 600;
  text-decoration: none;
  transition: background-color 120ms ease;
}
.fm-not-found-btn:hover {
  background: var(--fm-blue-hover);
}
.fm-not-found-btn:focus-visible {
  outline: 2px solid var(--fm-blue);
  outline-offset: 2px;
}
`;

export default function NotFound() {
  return (
    <main className="fm-not-found">
      <style>{NOT_FOUND_STYLES}</style>
      <section className="fm-not-found-card" aria-labelledby="fm-404-title">
        <div className="fm-not-found-head">
          <span className="fm-not-found-brand">
            <img src="/static/mark.svg" width={28} height={28} alt="" />
            <span>弗淼 AIGC</span>
          </span>
          <span className="fm-not-found-code">404</span>
        </div>
        <h1 id="fm-404-title">页面不存在或已被移除</h1>
        <p>请检查访问地址是否正确，或返回工作台继续创作。</p>
        <div className="fm-not-found-actions">
          <a className="fm-not-found-btn" href="/studio">
            返回工作台
          </a>
        </div>
      </section>
    </main>
  );
}
