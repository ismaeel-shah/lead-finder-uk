import { redirect } from "next/navigation";
import { appPassword } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  if (!appPassword()) redirect("/");
  return (
    <main className="bg-glow relative flex min-h-screen items-center justify-center bg-no-repeat p-4">
      <div className="bg-dots pointer-events-none absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_at_top,black,transparent_60%)]" />
      <LoginForm />
    </main>
  );
}
