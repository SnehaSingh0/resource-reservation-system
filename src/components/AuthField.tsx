import { useState } from "react";

type AuthFieldProps = {
  autoComplete: string;
  icon: "email" | "lock" | "user";
  label: string;
  name: string;
  placeholder: string;
  passwordToggle?: boolean;
  type?: "email" | "password" | "text";
};

function FieldIcon({ icon }: { icon: AuthFieldProps["icon"] }) {
  if (icon === "email") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <rect x="3" y="5" width="14" height="10" rx="1.5" />
        <path d="m4 6 6 5 6-5" />
      </svg>
    );
  }

  if (icon === "user") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="6.5" r="2.5" />
        <path d="M4.5 16a5.5 5.5 0 0 1 11 0" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="4" y="9" width="12" height="8" rx="1.5" />
      <path d="M7 9V6a3 3 0 0 1 6 0v3m-3 3v2" />
    </svg>
  );
}

export function AuthField({
  autoComplete,
  icon,
  label,
  name,
  placeholder,
  passwordToggle = false,
  type = "text",
}: AuthFieldProps) {
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const inputType =
    passwordToggle && isPasswordVisible ? "text" : type;

  return (
    <div className="auth-field-group">
      <label className="auth-field-label" htmlFor={name}>
        {label}
      </label>
      <div className="auth-field">
        <FieldIcon icon={icon} />
        <input
          id={name}
          type={inputType}
          name={name}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required
        />
        {passwordToggle && (
          <button
            className="password-toggle"
            type="button"
            aria-label={isPasswordVisible ? "Hide password" : "Show password"}
            aria-pressed={isPasswordVisible}
            onClick={() => setIsPasswordVisible((visible) => !visible)}
          >
            {isPasswordVisible ? "Hide" : "Show"}
          </button>
        )}
      </div>
    </div>
  );
}
