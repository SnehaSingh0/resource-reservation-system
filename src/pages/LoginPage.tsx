import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AuthFooter } from "../components/AuthFooter";
import { AuthBrand } from "../components/AuthBrand";
import { AuthField } from "../components/AuthField";

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const formData = new FormData(event.currentTarget);
    const email = formData.get("email");
    const password = formData.get("password");
    if (typeof email !== "string" || typeof password !== "string") {
      setErrorMessage("Enter your email address and password.");
      return;
    }

    setErrorMessage("");
    setIsSubmitting(true);

    try {
      const user = await login(email, password);
      navigate(user.role === "ADMIN" ? "/admin" : "/resources");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Could not connect to the server. Check that the backend is running and try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
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
          {errorMessage && (
            <p className="auth-error" role="alert">
              {errorMessage}
            </p>
          )}
          <button className="auth-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Signing in..." : "Login"}
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
