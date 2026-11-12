import type { Metadata } from "next";

import { RoleLogin } from "@/components/auth/role-login";

export const metadata: Metadata = { title: "Driver sign in" };

export default function DriverLoginPage() {
  return <RoleLogin role="DRIVER" />;
}
