import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ownPasswordAllowed, requireUser } from "@/lib/auth";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Set a new password" };

export default async function ResetPasswordPage() {
  const profile = await requireUser();
  const home = profile.is_admin ? "/admin" : "/dashboard";

  if (!(await ownPasswordAllowed())) {
    return (
      <Card className="bg-card/85 w-full max-w-sm backdrop-blur-md">
        <CardHeader>
          <CardTitle className="text-xl">Password changes</CardTitle>
          <CardDescription>
            Passwords are reset by a main admin. Ask the Owner or Manager to set a new password for you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href={home} className="text-primary text-sm font-medium hover:underline">
            Back to the app
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card/85 w-full max-w-sm backdrop-blur-md">
      <CardHeader>
        <CardTitle className="text-xl">Set a new password</CardTitle>
        <CardDescription>For {profile.email}</CardDescription>
      </CardHeader>
      <CardContent>
        <ResetPasswordForm redirectTo={home} />
      </CardContent>
    </Card>
  );
}
