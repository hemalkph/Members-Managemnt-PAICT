import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Set a new password" };

export default async function ResetPasswordPage() {
  const profile = await requireUser();

  return (
    <Card className="bg-card/85 w-full max-w-sm backdrop-blur-md">
      <CardHeader>
        <CardTitle className="text-xl">Set a new password</CardTitle>
        <CardDescription>For {profile.email}</CardDescription>
      </CardHeader>
      <CardContent>
        <ResetPasswordForm redirectTo={profile.is_admin ? "/admin" : "/dashboard"} />
      </CardContent>
    </Card>
  );
}
