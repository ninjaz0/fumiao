import { useRef, useState, type FormEvent } from "react";
import type { AdminSave, AdminOpen, AdminConfirm } from "./settings-admin";
import { openDialogFor } from "./AssetDialog";
import { Icon } from "./Icon";
import { Avatar } from "./Navigation";
import { PasswordDialog } from "./SettingsProfile";

import { displayName, type StudioState } from "./state";

export function Members({
  state,
  open,
  confirm,
  request,
  refresh,
  notify,
}: AdminSave & {
  state: StudioState;
  open: AdminOpen;
  confirm: AdminConfirm;
}) {
  return (
    <div className="management-view">
      <div className="page-heading">
        <h2>成员管理</h2>
        <div className="team-add-actions">
          <button
            className="primary"
            data-act="add-member"
            onClick={(event) =>
              open(
                <AddMember
                  request={request}
                  refresh={refresh}
                  notify={notify}
                />,
                event.currentTarget,
              )
            }
          >
            <Icon name="plus" />
            添加成员
          </button>
        </div>
      </div>
      <div className="list-surface">
        {state.users?.map((member) => (
          <div key={member.id} className="member-row">
            <Avatar member={member} current={false} />
            <div className="member-identity">
              <span className="member-name">{displayName(member)}</span>
              <small>{member.name + (member.active ? "" : "　已停用")}</small>
            </div>
            {member.role === "member" && (
              <div className="member-actions">
                <button
                  className="quiet-button"
                  data-act="member-password"
                  data-id={member.id}
                  onClick={(event) =>
                    open(
                      <PasswordDialog
                        member={member}
                        request={request}
                        notify={notify}
                      />,
                      event.currentTarget,
                    )
                  }
                >
                  修改密码
                </button>
                <button
                  className="quiet-button danger"
                  data-act="delete-member"
                  data-id={member.id}
                  onClick={(event) =>
                    confirm(
                      "删除 " + displayName(member) + "？",
                      "该成员无法再登录，作品保留。其接入实例会断开，受影响任务重新排队。",
                      async () => {
                        await request(
                          "/api/users/" + member.id,
                          undefined,
                          "DELETE",
                        );
                      },
                      event.currentTarget,
                    )
                  }
                >
                  删除
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AddMember({ request, refresh, notify }: AdminSave) {
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    pending.current = true;
    setSaving(true);
    try {
      await request("/api/users", {
        name: String(fields.get("username")).trim(),
        nickname: String(fields.get("nickname")).trim(),
        password: fields.get("password"),
      });
      openDialogFor(form)?.close();
      await refresh();
      notify("成员已添加");
    } catch (error) {
      notify((error as Error).message);
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <>
      <h2 id="modal-heading">添加成员</h2>
      <form id="add-member-form" onSubmit={submit}>
        <label className="formlabel">
          用户名
          <input
            name="username"
            minLength={2}
            maxLength={32}
            autoComplete="off"
            required
          />
        </label>
        <label className="formlabel">
          {"昵称 "}
          <small>选填</small>
          <input name="nickname" maxLength={40} autoComplete="off" />
        </label>
        <label className="formlabel">
          初始密码
          <input
            type="password"
            name="password"
            minLength={10}
            maxLength={200}
            placeholder="至少 10 位"
            autoComplete="new-password"
            required
          />
        </label>
        <button className="primary" type="submit" disabled={saving}>
          添加
        </button>
      </form>
    </>
  );
}
