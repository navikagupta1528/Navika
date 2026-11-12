import type { Metadata } from "next";

import { RoleLogin } from "@/components/auth/role-login";

export const metadata: Metadata = { title: "Parent sign in" };

export default function ParentLoginPage() {
  return <RoleLogin role="PARENT" />;
}
