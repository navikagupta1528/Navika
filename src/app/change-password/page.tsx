import { requireSession, getCurrentUser } from "@/lib/dal";
import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { CompleteProfileForm } from "@/components/auth/complete-profile-form";

export default async function ChangePasswordPage() {
  await requireSession();
  const user = await getCurrentUser();
  const session = await requireSession();

  const needsProfile =
    !user?.name ||
    user.name.startsWith("Student ") ||
    user.name.startsWith("Parent of ") ||
    !user?.phone;

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">
        {needsProfile ? "Complete your profile" : "Set your password"}
      </h1>
      <p className="mt-1 mb-6 text-sm text-slate-500">
        {needsProfile
          ? "Fill in your details to get started."
          : "You need to set a new password before continuing."}
      </p>
      {needsProfile ? <CompleteProfileForm role={session.role} /> : <ChangePasswordForm />}
    </div>
  );
}
