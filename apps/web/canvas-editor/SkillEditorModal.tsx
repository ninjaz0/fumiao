import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Plus, Trash2, Upload } from "lucide-react";

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

const SAMPLE_SKILL_MD = `---
name: 短剧分镜导演规范
slug: short-drama-director
description: 保持角色外观连贯与强情绪钩子开场
---

编写分镜时遵守以下规则：
1. 前 3 秒给出强视觉冲突或人物特写镜头。
2. 每个镜头明确标注景别、运镜方向和光线色调。
3. 旁白精炼口语化，5 秒镜头不超过 12 个汉字。`;

export function SkillEditorModal({ workspace }: { workspace: number }) {
  const [skills, setSkills] = useState<WorkspaceSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<WorkspaceSkill | "new" | null>(null);
  const [rawMd, setRawMd] = useState(SAMPLE_SKILL_MD);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const zipRef = useRef<HTMLInputElement>(null);

  const req = useCallback(
    async (path: string, body?: unknown, method?: string) => {
      const res = await fetch(path, {
        method: method || (body === undefined ? "GET" : "POST"),
        credentials: "same-origin",
        headers: {
          "X-Workspace-Id": String(workspace),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok)
        throw new Error(typeof json.detail === "string" ? json.detail : "请求失败");
      return json;
    },
    [workspace],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await req("/api/skills");
      setSkills(res.skills);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [req]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveSkill = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (editing === "new") {
        await req("/api/skills", { raw_md: rawMd, enabled: true }, "POST");
        setNotice("已导入新技能包，后续对话会自动按快照注入");
      } else if (editing) {
        await req(
          `/api/skills/${editing.id}`,
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
      await req(
        `/api/skills/${skill.id}`,
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
      const json = await res.json();
      if (!res.ok)
        throw new Error(typeof json.detail === "string" ? json.detail : "ZIP 导入失败");
      setNotice(`已从 ZIP 导入技能「${json.name}」`);
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
      await req(`/api/skills/${skill.id}`, undefined, "DELETE");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fm-skills-modal">
      <div className="fm-skills-toolbar">
        <span>支持标准 YAML Frontmatter + Markdown `SKILL.md` 及 `.zip` 技能包（最大 64 KiB）</span>
        <div className="fm-skills-actions">
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
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="fm-pack-notice" role="status">
          {notice}
        </p>
      )}

      {editing ? (
        <div className="fm-skill-editor">
          <textarea
            rows={14}
            aria-label="SKILL.md 内容"
            value={rawMd}
            onChange={(e) => setRawMd(e.target.value)}
          />
          <div className="dialog-actions">
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
        <p>正在加载工作区技能…</p>
      ) : skills.length === 0 ? (
        <p className="fm-series-muted">
          尚未配置工作区技能。导入 `SKILL.md` 后，对话与分镜 Agent 将自动遵循技能规范并在每轮冻结快照。
        </p>
      ) : (
        <ul className="fm-skill-list">
          {skills.map((s) => (
            <li key={s.id} className="fm-skill-card">
              <div>
                <strong>
                  <BookOpen size={14} /> {s.name} <small>({s.slug})</small>
                </strong>
                {s.description && <p>{s.description}</p>}
              </div>
              <div className="fm-skill-card-actions">
                <label>
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
                    const fm = [
                      "---",
                      `name: ${s.name}`,
                      `slug: ${s.slug}`,
                      ...(s.description ? [`description: ${s.description}`] : []),
                      "---",
                      "",
                      s.body_md,
                    ].join("\n");
                    setRawMd(fm);
                    setEditing(s);
                  }}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`删除技能 ${s.name}`}
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
    </div>
  );
}
