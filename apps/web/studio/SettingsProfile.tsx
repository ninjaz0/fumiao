import {
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import type { AdminRequest } from "./settings-admin";
import { api } from "./api";
import { openDialogFor } from "./AssetDialog";

import { Icon } from "./Icon";
import { Avatar } from "./Navigation";
import { displayName, type Member, type StudioState } from "./state";

const imageAccept =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,image/heic-sequence,image/heif-sequence,image/avif,image/tiff,image/bmp,image/gif,.jpg,.jpeg,.png,.webp,.heic,.heif,.avif,.tif,.tiff,.bmp,.gif";

type Notify = (message: string) => void;
type ProfileWrite = (member: Member) => Promise<void>;

export function Profile({
  state,
  draft,
  avatar,
  password,
  saved,
  notify,
}: {
  state: StudioState;
  draft: RefObject<string | null>;
  avatar: (button: HTMLButtonElement) => void;
  password: (button: HTMLButtonElement) => void;
  saved: ProfileWrite;
  notify: Notify;
}) {
  const initialName = useRef(draft.current ?? displayName(state.me));
  const [name, setName] = useState(initialName.current);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useLayoutEffect(() => {
    draft.current ??= initialName.current;
  }, [draft]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const member = await api<Member>(
        String(state.workspace_id),
        "/api/me",
        { nickname: name.trim() },
        "PATCH",
      );
      draft.current = member.nickname ?? displayName(member);
      setMessage("已保存");
      await saved(member);
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-section profile-section">
      <h2>个人资料</h2>
      <div className="ledger-card ledger-profile-identity">
        <Avatar member={state.me} />
        <div>
          <strong>{displayName(state.me)}</strong>
          <small>{state.me.role === "admin" ? "管理员" : "成员"}</small>
        </div>
        <button
          className="profile-secondary"
          data-act="avatar-picker"
          onClick={(event) => avatar(event.currentTarget)}
        >
          更改头像
        </button>
      </div>
      <div className="ledger-card">
        <form id="profile-form" onSubmit={submit}>
          <div className="profile-field-row profile-name-row">
            <label htmlFor="nickname" className="profile-field-label">
              昵称
            </label>
            <div className="profile-input-action">
              <input
                id="nickname"
                name="nickname"
                defaultValue={initialName.current}
                maxLength={40}
                required
                autoComplete="nickname"
                onInput={(event) => {
                  draft.current = event.currentTarget.value;
                  setName(draft.current);
                  setMessage("");
                }}
              />
              <button
                className="profile-save"
                type="submit"
                disabled={
                  busy || !name.trim() || name.trim() === displayName(state.me)
                }
              >
                保存
              </button>
            </div>
          </div>
          <div className="profile-save-status">
            <span className="form-message" role="status">
              {message}
            </span>
          </div>
        </form>
        <div className="profile-field-row">
          <span className="profile-field-label">用户名</span>
          <span className="profile-readonly">{state.me.name}</span>
        </div>
        <div className="profile-field-row profile-password-row">
          <span className="profile-field-label">密码</span>
          <div>
            <button
              className="profile-secondary"
              data-act="own-password"
              onClick={(event) => password(event.currentTarget)}
            >
              更改密码
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AvatarPicker({
  state,
  saved,
  notify,
}: {
  state: StudioState;
  saved: ProfileWrite;
  notify: Notify;
}) {
  const file = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const [uploading, setUploading] = useState(false);

  async function change(element: HTMLElement, avatar: string | File) {
    if (busy.current) return;
    busy.current = true;
    const raw = avatar instanceof File;
    if (raw) setUploading(true);
    try {
      const member = await api<Member>(
        String(state.workspace_id),
        raw ? "/api/me/avatar" : "/api/me",
        raw ? avatar : { avatar },
        raw ? "PUT" : "PATCH",
      );
      openDialogFor(element)?.close();
      notify("头像已更新");
      await saved(member);
    } catch (error) {
      notify((error as Error).message);
    } finally {
      busy.current = false;
      setUploading(false);
    }
  }

  return (
    <>
      <h2 id="modal-heading">更改头像</h2>
      <div className="avatar-library" role="group" aria-label="头像库">
        {state.avatars.map((avatar) => (
          <button
            key={avatar.id}
            type="button"
            data-act="choose-avatar"
            data-key={avatar.id}
            aria-label={avatar.label}
            aria-pressed={state.me.avatar === avatar.id}
            onClick={(event) => void change(event.currentTarget, avatar.id)}
          >
            <img src={avatar.url} alt="" />
          </button>
        ))}
      </div>
      <div className="avatar-upload-row">
        <button
          className="quiet-button"
          id="avatar-upload"
          disabled={uploading}
          onClick={() => file.current?.click()}
        >
          {uploading ? (
            "上传中"
          ) : (
            <>
              <Icon name="picture" />
              上传头像
            </>
          )}
        </button>
        <span className="muted">支持 HEIC 等常见图片，最大 5 MB</span>
        <input
          ref={file}
          className="hide"
          id="avatar-file"
          type="file"
          accept={imageAccept}
          onChange={(event) => {
            const input = event.currentTarget;
            if (input.files?.[0]) void change(input, input.files[0]);
          }}
        />
      </div>
    </>
  );
}

export function PasswordDialog({
  member,
  request,
  notify,
}: {
  member?: Member;
  request: AdminRequest;
  notify: Notify;
}) {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    if (fields.get("password") !== fields.get("confirm")) {
      notify("两次输入的密码不一致");
      return;
    }
    pending.current = true;
    setBusy(true);
    try {
      await request(
        member ? `/api/users/${member.id}/password` : "/api/me/password",
        {
          ...(!member && { current_password: fields.get("current") }),
          password: fields.get("password"),
        },
      );
      openDialogFor(form)?.close();
      notify(member ? "密码已修改，原登录会话已退出" : "密码已更新");
    } catch (error) {
      notify((error as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <h2 id="modal-heading">{member ? "修改密码" : "更改密码"}</h2>
      {member && <p>{displayName(member)}</p>}
      <form id="password-form" onSubmit={submit}>
        {!member && (
          <label className="formlabel">
            当前密码
            <input
              type="password"
              name="current"
              autoComplete="current-password"
              required
              maxLength={200}
            />
          </label>
        )}
        <label className="formlabel">
          新密码
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
        <label className="formlabel">
          确认新密码
          <input
            type="password"
            name="confirm"
            minLength={10}
            maxLength={200}
            autoComplete="new-password"
            required
          />
        </label>
        <button className="primary" type="submit" disabled={busy}>
          保存
        </button>
      </form>
    </>
  );
}
