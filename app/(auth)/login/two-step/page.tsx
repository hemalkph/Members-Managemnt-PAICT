import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheckIcon } from "lucide-react";
import BlurText from "@/components/reactbits/blur-text";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { getAuthSession } from "@/lib/auth";
import { TwoStepLoginForm } from "./two-step-form";

export const metadata: Metadata = { title: "Two-step login" };

export default async function TwoStepLoginPage() {
  const session = await getAuthSession();
  if (!session) redirect("/auth/signout?reason=expired"); // stale cookie: clear it (see requireUser)
  if (!session.hasTwoStep || session.twoStepVerified) redirect("/");

  return (
    <Card className="bg-card/85 w-full max-w-sm backdrop-blur-md">
      <CardHeader className="text-center">
        <div className="bg-primary/10 text-primary mx-auto mb-2 flex size-12 items-center justify-center rounded-full">
          <ShieldCheckIcon className="size-6" />
        </div>
        <BlurText
          as="h1"
          text="Enter your code"
          className="justify-center text-2xl font-semibold tracking-tight [&>span]:justify-center"
        />
        <CardDescription>
          Open your authenticator app and enter the 6-digit code for Team Work Tracker ({session.user.email}).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <TwoStepLoginForm />
      </CardContent>
    </Card>
  );
}
