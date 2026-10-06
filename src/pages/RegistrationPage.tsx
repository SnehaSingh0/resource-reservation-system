import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthFooter } from "../components/AuthFooter";
import { AuthBrand } from "../components/AuthBrand";
import { AuthField } from "../components/AuthField";

export function RegistrationPage() {
  const navigate = useNavigate();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate("/login");
  }

  return (
    <main className="auth-page">
      <section
        className="auth-card registration-card"
        aria-labelledby="register-title"
      >
        <AuthBrand />
        <p className="auth-eyebrow">TEAM PORTAL</p>
        <h1 id="register-title">Create Your Account</h1>
        <p className="auth-subtitle">Create an account to get started</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <AuthField
            autoComplete="name"
            icon="user"
            label="Full Name"
            name="fullName"
            placeholder="Full Name"
          />
          <AuthField
            autoComplete="email"
            icon="email"
            label="Email address"
            name="email"
            placeholder="Email address"
            type="email"
          />
          <AuthField
            autoComplete="new-password"
            icon="lock"
            label="Password"
            name="password"
            placeholder="Password"
            type="password"
          />
          <AuthField
            autoComplete="new-password"
            icon="lock"
            label="Confirm Password"
            name="confirmPassword"
            placeholder="Confirm Password"
            type="password"
          />
          <button className="auth-submit" type="submit">
            Register
          </button>
        </form>

        <p className="auth-switch">
          Already have an account? <Link to="/login">Login</Link>
        </p>
      </section>
      <AuthFooter />
    </main>
  );
}
