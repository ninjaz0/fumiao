import { useEffect, useRef, useState } from "react";
import type { AdminRequest } from "./settings-admin";

export function OpenAISettings({
  configured,
  request,
}: {
  configured: boolean;
  request: AdminRequest;
}) {
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");

  async function check() {
    setTesting(true);
    setMessage("正在连接");
    try {
      await request("/api/settings/openai/check", {});
      setMessage("连接正常");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="settings-section openai-settings">
      <h2>OpenAI</h2>
      <div className="ledger-card">
        <div className="setting-row">
          <span>连接状态</span>
          <span>{configured ? "已配置" : "未配置"}</span>
        </div>
        <div className="setting-row">
          <span>模型</span>
          <span>gpt-image-2.6</span>
        </div>
        <form
          id="openai-settings-form"
          onSubmit={(event) => event.preventDefault()}
        >
          <div className="openai-actions">
            <button
              className="profile-secondary"
              type="button"
              id="openai-check"
              disabled={!configured || testing}
              onClick={() => void check()}
            >
              测试连接
            </button>
            <a
              className="quiet-button"
              href="https://platform.openai.com/usage"
              target="_blank"
              rel="noopener noreferrer"
            >
              查看用量 ↗
            </a>
          </div>
          <p className="form-message" role="status">
            {message}
          </p>
        </form>
      </div>
    </section>
  );
}

const providers = [
  ["deepseek", "DeepSeek"],
  ["openai", "OpenAI"],
] as const;
type Provider = (typeof providers)[number];
type ChatConfig = { providers: Record<Provider[0], { configured: boolean }> };

export function ChatSettings({
  request,
  notify,
}: {
  request: AdminRequest;
  notify: (message: string) => void;
}) {
  const [config, setConfig] = useState<ChatConfig>();

  useEffect(() => {
    let active = true;
    void request("/api/admin/chat").then(
      (value) => {
        if (active) setConfig(value as ChatConfig);
      },
      (error: Error) => {
        if (active) notify(error.message);
      },
    );
    return () => {
      active = false;
    };
  }, [request, notify]);

  return (
    <section className="settings-section fm-chat-service">
      <h2>对话服务</h2>
      {providers.map((provider) => (
        <ChatProvider
          key={provider[0]}
          provider={provider}
          configured={config?.providers[provider[0]].configured}
          request={request}
        />
      ))}
    </section>
  );
}

function ChatProvider({
  provider: [id, label],
  configured,
  request,
}: {
  provider: Provider;
  configured?: boolean;
  request: AdminRequest;
}) {
  const secret = useRef<HTMLInputElement>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const status = saved || configured;

  async function perform(test: boolean) {
    const input = secret.current!;
    const key = input.value.trim();
    setBusy(true);
    setMessage("");
    try {
      if (!test && !key) throw new Error("请输入密钥");
      const path = "/api/admin/chat/" + id;
      if (test) {
        await request(path + "/test", {}, "POST");
      } else {
        await request(path, { key }, "PUT");
        input.value = "";
        setSaved(true);
      }
      setMessage(test ? "连接正常" : "已保存");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="ledger-card"
      data-chat-provider={id}
      onSubmit={(event) => {
        event.preventDefault();
        void perform(false);
      }}
    >
      <header>
        <h3>{label}</h3>
        <span className="muted" data-chat-status="">
          {status === undefined ? "载入中…" : status ? "已配置" : "未配置"}
        </span>
      </header>
      <div className="service-secret">
        <input
          ref={secret}
          type="password"
          name="secret"
          autoComplete="new-password"
          placeholder="输入新密钥以替换"
          aria-label={`${label} API 密钥`}
        />
        <button type="submit" className="profile-secondary" disabled={busy}>
          保存
        </button>
        <button
          type="button"
          className="quiet-button"
          data-chat-test=""
          disabled={busy}
          onClick={() => void perform(true)}
        >
          测试连接
        </button>
      </div>
      <p className="form-message" role="status">
        {message}
      </p>
    </form>
  );
}
