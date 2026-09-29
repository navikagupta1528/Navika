import type { Metadata } from "next";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = { title: "Register" };

export default function RegisterPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">
        Create your account
      </h1>
      <p className="mt-1 mb-6 text-sm text-slate-500">
        Track your bus, get arrival alerts, and let the driver know you are
        waiting.
      </p>
      <RegisterForm />
    </div>
  );
}
