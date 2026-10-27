import type { Metadata } from "next";
import { BrandLogo } from "@/components/brand-logo";
import BlurText from "@/components/reactbits/blur-text";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Log in" };

const ERRORS: Record<string, string> = {
  inactive: "Your account is deactivated. Please contact an admin.",
  expired: "Your login has ended. Please sign in again.",
  link: "That link is invalid or has expired. Please try again.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  const message = typeof error === "string" ? ERRORS[error] : undefined;

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
      <CardContent>
        <LoginForm initialError={message} />
      </CardContent>
    </Card>
  );
}
