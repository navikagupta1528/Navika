import type { Metadata } from "next";

import { RoleLogin } from "@/components/auth/role-login";

export const metadata: Metadata = {
  title: "Administrator sign in",
  // Not linked from the student/parent/driver screens, and not worth indexing.
  robots: { index: false, follow: false },
};

export default function AdminLoginPage() {
  return <RoleLogin role="ADMIN" />;
}
