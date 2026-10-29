import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { pageAccess } from "@/lib/page-access";

export default async function Home() {
  const profile = await requireUser();
  redirect(pageAccess(profile, "overview") !== "none" ? "/admin" : "/dashboard");
}
