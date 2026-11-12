import type { Metadata } from "next";

import { RoleLogin } from "@/components/auth/role-login";

export const metadata: Metadata = { title: "Student sign in" };

export default function LoginPage() {
  return <RoleLogin role="STUDENT" />;
}
