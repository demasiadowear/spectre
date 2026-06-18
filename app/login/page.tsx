import { Suspense } from "react";
import { redirect } from "next/navigation";
import LoginForm from "@/components/auth/LoginForm";
import { AUTH_DISABLED } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  // No password configured → there's nothing to log into. Go straight in.
  if (AUTH_DISABLED) redirect("/pipeline");

  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
