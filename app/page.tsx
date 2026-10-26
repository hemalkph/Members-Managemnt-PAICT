import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";

export default async function Home() {
  const profile = await requireUser();
  redirect(profile.is_admin ? "/admin" : "/dashboard");
}
