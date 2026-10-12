import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AuthFooter } from "../components/AuthFooter";
import { AuthBrand } from "../components/AuthBrand";
import { AuthField } from "../components/AuthField";

export function RegistrationPage() {
  const navigate = useNavigate();
  const { register } = useAuth();
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const formData = new FormData(event.currentTarget);
    const fullName = String(formData.get("fullName") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    if (!fullName || !email || !password || !confirmPassword) {
      setErrorMessage("Please complete every field before registering.");
      return;
    }

    setErrorMessage("");
    setIsSubmitting(true);

    try {
      await register({ fullName, email, password, confirmPassword });
      navigate("/login");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not create your account.");
    } finally {
      setIsSubmitting(false);
    }
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
          {errorMessage && (
            <p className="auth-error" role="alert">
              {errorMessage}
            </p>
          )}
          <button className="auth-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Registering..." : "Register"}
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
