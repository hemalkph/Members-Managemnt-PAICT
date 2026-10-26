import type { Profile } from "@/lib/database.types";

type ProfileFields = Pick<Profile, "full_name" | "phone" | "whatsapp" | "nic" | "date_of_birth">;

/** Labels of the profile fields a member still has to fill in. */
export function missingProfileFields(p: ProfileFields): string[] {
  const missing: string[] = [];
  if ((p.full_name ?? "").trim().length < 2) missing.push("Full name");
  if (!p.phone) missing.push("Phone number");
  if (!p.whatsapp) missing.push("WhatsApp number");
  if (!p.nic || !p.date_of_birth) missing.push("NIC");
  return missing;
}

export function isProfileComplete(p: ProfileFields): boolean {
  return missingProfileFields(p).length === 0;
}
