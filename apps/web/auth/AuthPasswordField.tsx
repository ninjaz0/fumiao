"use client";
import { useId, useState } from "react";
import styles from "./AuthPassword.module.css";
import "./auth-mobile.css";

const eye =
  "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z M12 9a3 3 0 100 6 3 3 0 000-6z";
const eyeOff =
  "M10.6 5.2A10.8 10.8 0 0112 5c6.4 0 10 7 10 7a17.6 17.6 0 01-2.8 3.8 M6.6 6.7C3.9 8.5 2 12 2 12s3.6 7 10 7a10.6 10.6 0 005.4-1.5 M9.9 9.9a3 3 0 004.2 4.2 M3 3l18 18";

export function AuthPasswordField({ registering }: { registering: boolean }) {
  const inputId = useId();
  const [visible, setVisible] = useState(false);
  const [lastRegistering, setLastRegistering] = useState(registering);
  if (lastRegistering !== registering) {
    setLastRegistering(registering);
    setVisible(false);
  }
  const label = visible ? "隐藏密码" : "显示密码";
  return (
    <div className="formlabel">
      <label htmlFor={inputId}>密码</label>
      <div className={styles.control}>
        <input
          id={inputId}
          className={styles.input}
          required
          name="pw"
          type={visible ? "text" : "password"}
          minLength={registering ? 10 : 1}
          maxLength={200}
          autoComplete={registering ? "new-password" : "current-password"}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder={registering ? "至少 10 位" : ""}
        />
        <button
          type="button"
          className={`icon-button ${styles.toggle}`}
          data-act="toggle-password"
          aria-label={label}
          aria-pressed={visible}
          aria-controls={inputId}
          title={label}
          onClick={() => setVisible((current) => !current)}
        >
          <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
            <path className="fm-state-change" key={label} d={visible ? eyeOff : eye} />
          </svg>
        </button>
      </div>
    </div>
  );
}
