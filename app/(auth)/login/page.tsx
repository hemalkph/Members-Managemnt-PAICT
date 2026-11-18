import type { Metadata } from "next";
import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import BlurText from "@/components/reactbits/blur-text";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { getAuthSession } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Log in" };

const ERRORS: Record<string, string> = {
  inactive: "Your account is deactivated. Please contact an admin.",
  expired: "Your login has ended. Please sign in again.",
  idle: "You were logged out after 15 minutes of inactivity. Please sign in again.",
  link: "That link is invalid or has expired. Please try again.",
  reset: "Passwords are reset by a main admin. Ask the Owner or Manager to set a new password for you.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  const message = typeof error === "string" ? ERRORS[error] : undefined;
  const signedIn = message ? Boolean(await getAuthSession()) : false;

  return (
    <Card className="bg-card/85 w-full max-w-sm backdrop-blur-md">
      <CardHeader className="text-center">
        <BrandLogo className="mx-auto mb-2 h-14 drop-shadow-sm" priority />
        <BlurText
          as="h1"
          text="Welcome back"
          className="justify-center text-2xl font-semibold tracking-tight [&>span]:justify-center"
        />
        <CardDescription>Log in to record and track your team work.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <LoginForm initialError={message} />
        {signedIn && (
          <p className="text-muted-foreground text-center text-xs">
            Already signed in?{" "}
            <Link href="/" className="text-primary font-medium hover:underline">
              Back to the app
            </Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
