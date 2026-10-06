import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthFooter } from "../components/AuthFooter";
import { AuthBrand } from "../components/AuthBrand";
import { AuthField } from "../components/AuthField";

export function LoginPage() {
  const navigate = useNavigate();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate("/dashboard");
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="login-title">
        <AuthBrand />
        <p className="auth-eyebrow">TEAM PORTAL</p>
        <h1 id="login-title">Employee Login</h1>
        <p className="auth-subtitle">Welcome back. Sign in to continue.</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <AuthField
            autoComplete="email"
            icon="email"
            label="Email address"
            name="email"
            placeholder="name@company.com"
            type="email"
          />
          <AuthField
            autoComplete="current-password"
            icon="lock"
            label="Password"
            name="password"
            placeholder="Enter your password"
            passwordToggle
            type="password"
          />
          <button className="auth-submit" type="submit">
            Login
          </button>
        </form>

        <p className="auth-switch">
          Don&apos;t have an account? <Link to="/register">Register</Link>
        </p>
      </section>
      <AuthFooter />
    </main>
  );
}
