import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <Card className="bg-card/85 w-full max-w-sm backdrop-blur-md">
      <CardHeader>
        <CardTitle className="text-xl">Forgot your password?</CardTitle>
        <CardDescription>Enter your email and we&apos;ll send you a link to set a new one.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ForgotPasswordForm />
        <Link
          href="/login"
          className="text-muted-foreground hover:text-foreground inline-flex items-center justify-center gap-1 text-sm"
        >
          <ArrowLeftIcon className="size-4" /> Back to log in
        </Link>
      </CardContent>
    </Card>
  );
}
