import type { Metadata } from "next";

import { AuthShell } from "../login/page";

export const metadata: Metadata = { title: "Create account" };

export default function SignupPage() {
  return <AuthShell mode="signup" />;
}
