"use client";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type SyntheticEvent,
} from "react";
import { useAppearance } from "../home/controls";
import "./auth.css";

type Mode = "login" | "register";
const registrationUsernamePattern = String.raw`\s*[\p{L}\p{N}_.\-]{2,32}\s*`;
const moon = "M20 14.4A8.4 8.4 0 019.6 4a8.5 8.5 0 1010.4 10.4z";
const sun =
  "M12 8a4 4 0 100 8 4 4 0 000-8z M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M19 5l-1.5 1.5m-11 11L5 19";
function Icon({ path }: { path: string }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}
function Appearance() {
  const dark = useAppearance();
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    const update = (event: Event) => {
      if (
        event instanceof StorageEvent &&
        event.key !== "fumiao-appearance" &&
        event.key !== null
      )
        return;
      setChanged(true);
    };
    window.addEventListener("storage", update);
    window.addEventListener("fumiao-theme", update);
    return () => {
      window.removeEventListener("storage", update);
      window.removeEventListener("fumiao-theme", update);
    };
  }, []);
  return (
    <button
      className="appearance icon-button"
      data-act="theme"
      aria-label="切换外观"
      aria-pressed={dark}
      title={
        changed
          ? dark
            ? "切换到浅色"
            : "切换到深色"
          : dark
            ? "浅色模式"
            : "深色模式"
      }
      onClick={() => window.setFumiaoTheme?.(dark ? "light" : "dark")}
    >
      <span className="light-icon">
        <Icon path={moon} />
      </span>
      <span className="dark-icon">
        <Icon path={sun} />
      </span>
    </button>
  );
}
class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
async function request(
  path: string,
  body?: Record<string, string>,
  workspace?: string | null,
) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(workspace ? { "X-Workspace-Id": workspace } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: { detail?: unknown } = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new RequestError(
      typeof data.detail === "string"
        ? data.detail
        : "请求未完成，请检查输入后重试",
      response.status,
    );
  return data;
}
/** Login/register replace only the anonymous entry, using the authoritative session API. */
export default function Auth({ loadingLogo }: { loadingLogo: string }) {
  const [locationState, setLocationState] = useState({
    mode: "login" as Mode,
    retired: false,
    revision: 0,
  });
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState("");
  const [usernameError, setUsernameError] = useState(false);
  const [note, setNote] = useState("");
  const [toast, setToast] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const revision = useRef(0);
  const lastHash = useRef<string | null>(null);
  const busyRevision = useRef<number | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const focusNext = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const registering = locationState.mode === "register";
  useEffect(() => {
    try {
      sessionStorage.removeItem("fm-invite");
    } catch {}
    const read = () => {
      const retired = new URLSearchParams(location.hash.slice(1)).has("invite");
      if (lastHash.current === location.hash && !retired) return;
      const mode = location.hash === "#register" ? "register" : "login";
      if (retired)
        history.replaceState(null, "", location.pathname + location.search);
      lastHash.current = location.hash;
      setLocationState({ mode, retired, revision: ++revision.current });
      setUsernameError(false);
      setNote(retired ? "邀请链接已停用，请向管理员获取邀请码后注册。" : "");
      busyRevision.current = null;
      setBusy(false);
      setReady(true);
    };
    read();
    window.addEventListener("hashchange", read);
    window.addEventListener("popstate", read);
    return () => {
      window.removeEventListener("hashchange", read);
      window.removeEventListener("popstate", read);
      clearTimeout(toastTimer.current);
    };
  }, []);
  useEffect(() => {
    if (focusNext.current) {
      form.current?.querySelector<HTMLInputElement>('[name="user"]')?.focus();
      focusNext.current = false;
    }
  }, [locationState.revision]);
  const switchMode = (event: React.MouseEvent) => {
    event.preventDefault();
    const mode = registering ? "login" : "register";
    const nextHash = "#" + mode;
    history.pushState(null, "", nextHash);
    lastHash.current = nextHash;
    focusNext.current = true;
    setLocationState({ mode, retired: false, revision: ++revision.current });
    setUsernameError(false);
    busyRevision.current = null;
    setBusy(false);
    setNote("");
  };
  const checkUsername = (event: SyntheticEvent<HTMLInputElement>) =>
    setUsernameError(event.currentTarget.validity.patternMismatch);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const version = revision.current;
    if (busyRevision.current === version) return;
    busyRevision.current = version;
    setBusy(true);
    setNote("");
    const fields = new FormData(event.currentTarget);
    const value = (key: string) => String(fields.get(key) ?? "");
    try {
      await request(
        registering ? "/api/register" : "/api/login",
        {
          name: value("user").trim(),
          password: value("pw"),
          ...(registering
            ? { nickname: value("nickname").trim(), code: value("code").trim() }
            : {}),
        },
        new URLSearchParams(location.search).get("workspace"),
      );
      history.replaceState(null, "", location.pathname);
      try {
        await request("/api/state");
        // Resolve the authenticated workspace through the normal Studio entry.
        location.replace(location.pathname);
      } catch (error) {
        if (!(error instanceof RequestError && error.status === 401)) {
          setToast((error as Error).message);
          setToastVisible(true);
          clearTimeout(toastTimer.current);
          toastTimer.current = setTimeout(() => setToastVisible(false), 4200);
        }
      }
    } catch (error) {
      if (revision.current === version) setNote((error as Error).message);
    } finally {
      if (busyRevision.current === version) {
        busyRevision.current = null;
        setBusy(false);
      }
    }
  };
  return (
    <>
      <div id="app">
        <noscript>
          <main className="loading-screen auth-noscript">
            <h1>登录工作台</h1>
            <p>请启用 JavaScript 后重新加载页面，以登录或注册弗淼 AIGC 工作台。</p>
            <a href="/">返回首页</a>
          </main>
        </noscript>
        {!ready ? (
          <div
            className="loading-screen"
            role="status"
            aria-label="弗淼 AIGC 正在加载"
            aria-busy="true"
          >
            <div className="loading-brand">
              <img src={loadingLogo} width="48" height="48" alt="" />
              <span>
                弗淼 <b>AIGC</b>
              </span>
            </div>
            <div className="loading-track" aria-hidden="true">
              <span />
            </div>
          </div>
        ) : (
          <div className="auth">
            <header className="auth-top">
              <Appearance />
            </header>
            {"\n    "}
            <main className="auth-body">
              <section className="auth-wrap">
                {"\n      "}
                <div className="auth-art">
                  <a
                    className="auth-home"
                    href="/"
                    title="网站首页"
                    aria-label="弗淼 AIGC 网站首页"
                  >
                    <span className="brand">
                      <img src="/static/mark.svg" alt="" />
                      <span>
                        弗淼 <b>AIGC</b>
                      </span>
                    </span>
                  </a>
                  {"\n        "}
                  <svg
                    className="ribbon"
                    viewBox="0 0 480 450"
                    preserveAspectRatio="xMidYMid slice"
                    aria-hidden="true"
                  >
                    {"\n          "}
                    <defs>
                      <linearGradient id="auth-thread">
                        <stop className="ribbon-start" />
                        <stop offset=".46" className="ribbon-middle" />
                        <stop offset="1" className="ribbon-end" />
                      </linearGradient>
                    </defs>
                    {"\n          "}
                    <g stroke="url(#auth-thread)" strokeWidth="1.7" fill="none">
                      {Array.from({ length: 54 }, (_, i) => (
                        <path
                          key={i}
                          d={`M-80 ${255 + i * 3.6} C 80 ${166 + i * 4.7}, 130 ${390 - i * 3.2}, 246 ${230 - i * 2.1} S 410 ${70 + i * 3.5}, 565 ${90 + i * 3.7}`}
                        />
                      ))}
                    </g>
                    {"\n        "}
                  </svg>
                  {"\n      "}
                </div>
                {"\n      "}
                <form
                  ref={form}
                  key={locationState.revision}
                  className={`auth-form ${registering ? "auth-register" : ""}`}
                  onSubmit={submit}
                >
                  {"\n      "}
                  <h1>{registering ? "注册账户" : "登录工作台"}</h1>
                  {"\n      "}
                  <label className="formlabel">
                    用户名
                    <input
                      required
                      name="user"
                      autoComplete="username"
                      minLength={registering ? undefined : 1}
                      maxLength={32}
                      pattern={
                        registering ? registrationUsernamePattern : undefined
                      }
                      aria-invalid={
                        registering && usernameError ? true : undefined
                      }
                      aria-describedby={
                        registering && usernameError
                          ? "register-username-error"
                          : undefined
                      }
                      value={username}
                      onChange={(event) => {
                        setUsername(event.target.value);
                        if (usernameError) checkUsername(event);
                      }}
                      onBlur={registering ? checkUsername : undefined}
                      onInvalid={registering ? checkUsername : undefined}
                      {...(registering
                        ? { placeholder: "2–32 位中英文、数字或 _ . -" }
                        : {})}
                    />
                  </label>
                  {registering && (
                    <div
                      className="authnote"
                      id="register-username-error"
                      role="alert"
                    >
                      {usernameError &&
                        "用户名仅支持 2–32 位中英文、数字或 _ . -，不能含空格"}
                    </div>
                  )}
                  {"\n      "}
                  {registering && (
                    <label className="formlabel">
                      昵称
                      <input
                        required
                        name="nickname"
                        autoComplete="nickname"
                        maxLength={40}
                        placeholder="在工作台显示的名字"
                      />
                    </label>
                  )}
                  {"\n      "}
                  <label className="formlabel">
                    密码
                    <input
                      required
                      name="pw"
                      type="password"
                      minLength={registering ? 10 : 1}
                      maxLength={200}
                      autoComplete={
                        registering ? "new-password" : "current-password"
                      }
                      placeholder={registering ? "至少 10 位" : ""}
                    />
                  </label>
                  {"\n      "}
                  {registering && (
                    <label className="formlabel">
                      邀请码
                      <input
                        required
                        name="code"
                        autoComplete="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                        maxLength={64}
                        placeholder="请填写邀请码"
                      />
                    </label>
                  )}
                  {"\n      "}
                  <div className="authnote" role="alert">
                    {note}
                  </div>
                  {"\n      "}
                  <button className="primary" type="submit" disabled={busy}>
                    {busy
                      ? registering
                        ? "正在注册…"
                        : "正在登录…"
                      : registering
                        ? "注册并登录"
                        : "登录"}
                  </button>
                  {"\n      "}
                  <p className="auth-switch">
                    {registering ? "已有账户？" : "还没有账户？"}
                    <a
                      href={registering ? "#login" : "#register"}
                      id="auth-switch"
                      onClick={switchMode}
                    >
                      {registering ? "登录" : "注册"}
                    </a>
                  </p>
                  {"\n    "}
                </form>
              </section>
            </main>
          </div>
        )}
      </div>
      <div
        role="status"
        id="toast"
        className={toastVisible ? "visible" : undefined}
      >
        {toast}
      </div>
      <dialog id="modal">
        <div id="dialog-body" />
        <button id="close-modal" type="button" aria-label="关闭对话框">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </dialog>
      <div id="popover" hidden />
    </>
  );
}
