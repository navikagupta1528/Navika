import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">
        Sign in to Navika
      </h1>
      <p className="mt-1 mb-6 text-sm text-slate-500">
        Use the email your college registered for you.
      </p>
      <LoginForm />
    </div>
  );
}
