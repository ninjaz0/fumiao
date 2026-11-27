import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Plus, Trash2, Upload } from "lucide-react";
import { api, errorDetail } from "./api";
import { serializeSkillMarkdown } from "./skill-markdown";

type WorkspaceSkill = {
  id: string;
  slug: string;
  name: string;
  description: string;
  frontmatter: Record<string, unknown>;
  body_md: string;
  enabled: boolean;
  revision: number;
  updated: number;
};

const SAMPLE_SKILL_MD = [
  "---",
  "name: 短剧分镜导演规范",
  "slug: short-drama-director",
  "description: 保持角色外观连贯与强情绪钩子开场",
  "---",
  "",
  "编写分镜时遵守以下规则：",
  "1. 前 3 秒给出强视觉冲突或人物特写镜头。",
  "2. 每个镜头明确标注景别、运镜方向和光线色调。",
  "3. 旁白精炼口语化，5 秒镜头不超过 12 个汉字。",
].join("\n");

export function SkillEditorCard({ workspace }: { workspace: number }) {
  const [skills, setSkills] = useState<WorkspaceSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<WorkspaceSkill | "new" | null>(null);
  const [rawMd, setRawMd] = useState(SAMPLE_SKILL_MD);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const zipRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api<{ skills: WorkspaceSkill[] }>(
        String(workspace),
        "/api/skills",
      );
      setSkills(res.skills || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveSkill = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (editing === "new") {
        await api(
          String(workspace),
          "/api/skills",
          { raw_md: rawMd, enabled: true },
          "POST",
        );
        setNotice("已导入新技能包，启用后将自动注入工作区对话与外部 MCP 上下文");
      } else if (editing) {
        await api(
          String(workspace),
          "/api/skills/" + encodeURIComponent(editing.id),
          { expected_revision: editing.revision, raw_md: rawMd },
          "PUT",
        );
        setNotice("已保存技能更新");
      }
      setEditing(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async (skill: WorkspaceSkill) => {
    setBusy(true);
    setError("");
    try {
      await api(
        String(workspace),
        "/api/skills/" + encodeURIComponent(skill.id),
        { expected_revision: skill.revision, enabled: !skill.enabled },
        "PUT",
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const uploadZip = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const buf = await file.arrayBuffer();
      const res = await fetch("/api/skills/import-zip", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "X-Workspace-Id": String(workspace),
          "Content-Type": "application/zip",
        },
        body: buf,
      });
      const json = (await res.json().catch(() => ({}))) as {
        name?: string;
        detail?: unknown;
      };
      if (!res.ok) {
        throw new Error(
          json.detail ? errorDetail(json.detail) : "ZIP 导入失败",
        );
      }
      setNotice("已从 ZIP 导入技能「" + String(json.name || "") + "」");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeSkill = async (skill: WorkspaceSkill) => {
    setBusy(true);
    setError("");
    try {
      await api(
        String(workspace),
        "/api/skills/" + encodeURIComponent(skill.id),
        undefined,
        "DELETE",
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="ledger-card"
      style={{
        minWidth: 0,
        maxWidth: "100%",
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <div style={{ flex: "1 1 260px", minWidth: 0 }}>
          <h3 style={{ margin: 0 }}>工作区技能（SKILL.md）</h3>
          <p className="console-description" style={{ margin: "4px 0 0" }}>
            支持标准 YAML Frontmatter 与 Markdown 格式的 <code>SKILL.md</code>
            （最大 64 KiB）及 <code>.zip</code> 技能包（最大 256 KiB），启用后将自动注入工作区对话与外部 MCP 上下文。
          </p>
        </div>
        <div style={{ display: "inline-flex", flexWrap: "wrap", gap: 8 }}>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => zipRef.current?.click()}
          >
            <Upload size={14} />
            导入 ZIP
          </button>
          <input
            ref={zipRef}
            type="file"
            hidden
            accept=".zip,application/zip"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.currentTarget.value = "";
              void uploadZip(f);
            }}
          />
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => {
              setRawMd(SAMPLE_SKILL_MD);
              setEditing("new");
            }}
          >
            <Plus size={14} />
            新建 SKILL.md
          </button>
        </div>
      </div>

      {error && (
        <p className="error" role="alert" style={{ overflowWrap: "anywhere" }}>
          {error}
        </p>
      )}
      {notice && (
        <p
          className="console-description"
          role="status"
          style={{ margin: "0 0 10px", color: "var(--blue)" }}
        >
          {notice}
        </p>
      )}

      {editing ? (
        <div style={{ display: "grid", gap: 10, minWidth: 0 }}>
          <textarea
            rows={14}
            aria-label="SKILL.md 内容"
            value={rawMd}
            style={{
              width: "100%",
              boxSizing: "border-box",
              fontFamily:
                "var(--ledger-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
              fontSize: 12,
            }}
            onChange={(e) => setRawMd(e.target.value)}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button
              type="button"
              className="secondary"
              onClick={() => setEditing(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy || !rawMd.trim()}
              onClick={() => void saveSkill()}
            >
              {busy ? "保存中…" : "保存技能"}
            </button>
          </div>
        </div>
      ) : loading ? (
        <p className="console-description" style={{ margin: 0 }}>
          正在加载工作区技能…
        </p>
      ) : skills.length === 0 ? (
        <p className="console-description" style={{ margin: 0 }}>
          尚未配置工作区技能。新建或导入 <code>SKILL.md</code>{" "}
          技能包后，启用后将自动注入工作区对话与外部 MCP 上下文。
        </p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "grid",
            gap: 8,
          }}
        >
          {skills.map((s) => (
            <li
              key={s.id}
              style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid var(--line, rgba(128,128,128,0.22))",
                fontSize: 13,
              }}
            >
              <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                <strong
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    flexWrap: "wrap",
                  }}
                >
                  <BookOpen size={14} />
                  <span>{s.name}</span>
                  <code>{s.slug}</code>
                </strong>
                {s.description && (
                  <p
                    style={{
                      margin: "4px 0 0",
                      fontSize: 12,
                      color: "var(--secondary)",
                    }}
                  >
                    {s.description}
                  </p>
                )}
              </div>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 12,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    disabled={busy}
                    onChange={() => void toggleEnabled(s)}
                  />
                  启用
                </label>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    setRawMd(serializeSkillMarkdown(s));
                    setEditing(s);
                  }}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="secondary danger"
                  aria-label={"删除技能 " + s.name}
                  disabled={busy}
                  onClick={() => void removeSkill(s)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
